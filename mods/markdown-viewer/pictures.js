// Images in Markdown. Herdr's text view draws none, so they're cut out of the text and drawn between
// its runs, from a copy in the data folder (Herdr draws images only from real folders).
// Local images load by themselves. Web images download only when clicked, so opening a file never
// contacts a server it mentions.
// Reading an image's size is adapted from jankeesvw/herdr-issues (MIT, see LICENSE).
import * as fs from "fs/promises";
import { appHome, exec, home } from "herdr";

const RELATIVE = "data/markdown-viewer/images";
const MAX_BYTES = 20 * 1024 * 1024;
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg)$/i;

// Code first, so an image written inside code stays text.
const IMAGE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)|\[?!\[([^\]]*)\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)(?:\]\([^)]*\))?|<img\b([^>]*)>/g;

const folderOf = (path) => path.slice(0, path.lastIndexOf("/")) || "/";

// Where an image's source points: a web URL, an absolute local path, or null for anything else
// (data: and other schemes stay in the text).
function locate(src, file) {
  if (/^https?:\/\//i.test(src)) return { web: true, src };
  if (/^[a-z][\w+.-]*:/i.test(src) && !/^file:\/\//i.test(src)) return null;
  let path = src.replace(/^file:\/\//i, "").split(/[?#]/)[0];
  try { path = decodeURIComponent(path); } catch {}
  if (!path) return null;
  if (path.startsWith("~/")) path = home() + path.slice(1);
  else if (!path.startsWith("/")) path = `${folderOf(file)}/${path}`;
  const parts = path.split("/").reduce((acc, part) => part === ".." ? acc.slice(0, -1) : part === "." || part === "" ? acc : [...acc, part], []);
  return { web: false, src: "/" + parts.join("/") };
}

// The Markdown as text runs and groups of images. Images with only space between them (a row of
// badges) stay together in one group.
export function blocks(markdown, file) {
  const out = [];
  let last = 0, m;
  IMAGE.lastIndex = 0;
  while ((m = IMAGE.exec(markdown))) {
    if (m[1]) continue;
    const attrs = m[5] ?? "", raw = m[3] ?? m[4] ?? /\bsrc=["']([^"']+)["']/.exec(attrs)?.[1];
    const place = raw ? locate(raw, file) : null;
    if (!place) continue;
    const alt = m[2] ?? /\balt=["']([^"']*)["']/.exec(attrs)?.[1] ?? "";
    const width = Number(/\bwidth=["']?(\d+)/.exec(attrs)?.[1]) || null;
    const before = markdown.slice(last, m.index);
    if (before.trim()) out.push({ text: before });
    const group = !before.trim() && out[out.length - 1]?.images;
    if (group) group.push({ ...place, alt, width });
    else out.push({ images: [{ ...place, alt, width }] });
    last = m.index + m[0].length;
  }
  const rest = markdown.slice(last);
  if (rest.trim()) out.push({ text: rest });
  return out;
}

// Width and height from the file's own header.
function dimensions(b) {
  const u16 = (i) => (b[i] << 8) | b[i + 1], u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return { width: u32(16), height: u32(20) };
  if (ascii(0, 4) === "GIF8") return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff || b[i + 1] === 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: u16(i + 7), height: u16(i + 5) };
      i += 2 + u16(i + 2);
    }
    return null;
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    const kind = ascii(12, 16);
    if (kind === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (kind === "VP8 ") return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
    if (kind === "VP8L") {
      const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }
  const text = ascii(0, Math.min(b.length, 2000));
  if (/<svg\b/.test(text)) {
    const w = /<svg[^>]*\bwidth="([\d.]+)/.exec(text)?.[1], h = /<svg[^>]*\bheight="([\d.]+)/.exec(text)?.[1];
    if (w && h) return { width: Math.round(+w), height: Math.round(+h) };
    const box = /<svg[^>]*\bviewBox="[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(text);
    if (box) return { width: Math.round(+box[1]), height: Math.round(+box[2]) };
  }
  return null;
}

const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 2166136261).toString(16);
const failure = (why) => ({ state: "failed", why });

async function sized(relative) {
  const size = dimensions(await fs.readFile(`${appHome()}/${relative}`));
  return size?.width && size?.height ? { state: "ready", path: relative, ...size } : null;
}

// A local image: copied under a name made of its checksum and size, so a changed image shows as a
// new one. Only files with an image's extension and header: a Markdown file can't get anything
// else copied, and the copies are readable only by you.
export async function loadLocal(path) {
  if (!IMAGE_FILE.test(path)) return failure("not an image file");
  const sum = await exec("sh", ["-c", '[ -f "$1" ] && cksum < "$1"', "sh", path]);
  if (sum.code !== 0) return failure("not found");
  const [crc, bytes] = sum.stdout.trim().split(/\s+/);
  if (Number(bytes) > MAX_BYTES) return failure("larger than 20 MB");
  const relative = `${RELATIVE}/${crc}-${bytes}.${IMAGE_FILE.exec(path)[1].toLowerCase()}`;
  const copy = `${appHome()}/${relative}`;
  if (!await fs.exists(copy)) {
    const r = await exec("sh", ["-c", 'umask 077; mkdir -p "$(dirname "$2")" && cp "$1" "$2"', "sh", path, copy]);
    if (r.code !== 0) return failure("could not be read");
  }
  const ready = await sized(relative).catch(() => null);
  if (ready) return ready;
  await exec("rm", ["-f", copy]).catch(() => null);
  return failure("not a readable image");
}

// A web image, after a click. http and https only, redirects too, and at most 20 MB.
export async function loadWeb(url) {
  const name = `web-${hash(url)}`, temporary = `${appHome()}/${RELATIVE}/${name}.download`;
  const r = await exec("sh", ["-c",
    'umask 077; mkdir -p "$(dirname "$1")" && curl -sfL --proto =http,https --proto-redir =http,https --max-time 30 --max-filesize "$3" -o "$1" "$2" || { rm -f "$1"; exit 1; }',
    "sh", temporary, url, String(MAX_BYTES)]);
  if (r.code !== 0) return failure("could not be downloaded");
  const bytes = await fs.readFile(temporary);
  const isSvg = /<svg\b/.test(String.fromCharCode(...bytes.slice(0, 2000)));
  const relative = `${RELATIVE}/${name}.${isSvg ? "svg" : "png"}`;
  await exec("mv", ["-f", temporary, `${appHome()}/${relative}`]);
  const ready = await sized(relative).catch(() => null);
  if (ready) return ready;
  await exec("rm", ["-f", `${appHome()}/${relative}`]).catch(() => null);
  return failure("not a readable image");
}

// Copies not touched for a month go. Once per run.
let pruned = false;
export function pruneOld() {
  if (pruned) return;
  pruned = true;
  exec("find", [`${appHome()}/${RELATIVE}`, "-type", "f", "-mtime", "+30", "-delete"]).catch(() => null);
}
