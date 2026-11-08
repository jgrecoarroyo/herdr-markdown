// Finding the Markdown files a terminal mentions: the paths in its recent text,
// newest (lowest on screen) first, kept only if the file is really there.
import { exec } from "herdr";

// A path-ish run of characters ending in .md / .markdown / .mdx. Stops at spaces,
// quotes, brackets, box-drawing and the marks agents put around paths.
const TOKEN = /[^\s`'"<>()\[\]{}|│⎿●✻*,;]+?\.(?:md|markdown|mdx)(?![\w-])/giu;

function tokens(text) {
  const out = [];
  for (const m of text.matchAll(TOKEN)) {
    let p = m[0];
    if (/^[a-z][\w+.-]*:\/\//i.test(p) && !p.startsWith("file://")) continue; // a web link, not a file
    p = p.replace(/^file:\/\//, "").replace(/^@/, "");
    try { p = decodeURIComponent(p); } catch {}
    if (p.length > 1) out.push(p);
  }
  return out;
}

// Agents wrap long lines themselves (the rest indented on the next line) and
// terminals wrap them too, so a path can be cut in two: each line's last word is
// also tried joined to the next line's first. Wrong joins don't exist on disk.
export function mentions(text) {
  const lines = text.split("\n"), seen = new Set(), out = [];
  const add = (list) => { for (const p of list) if (!seen.has(p)) { seen.add(p); out.push(p); } };
  for (let i = lines.length - 1; i >= 0; i--) {
    const next = lines[i + 1];
    if (next !== undefined) {
      const tail = lines[i].match(/\S+$/)?.[0], head = next.match(/^\s*(\S+)/)?.[1];
      if (tail && head) add(tokens(tail + head));
    }
    add(tokens(lines[i]).reverse());
  }
  return out;
}

// The ones that exist, as absolute paths (relative ones are from the terminal's
// folder, ~ is home), in the same order, each once. Runs where the terminal is.
export async function existing(candidates, cwd, on) {
  if (!candidates.length) return [];
  const script = 'cd "$1" 2>/dev/null; shift; for p; do case $p in "~/"*) p="$HOME/${p#??}";; esac; ' +
    '[ -f "$p" ] && printf "%s/%s\\n" "$(cd "$(dirname "$p")" && pwd)" "$(basename "$p")"; done';
  const r = await exec("sh", ["-c", script, "sh", cwd || "/", ...candidates.slice(0, 80)], { on });
  return [...new Set(r.stdout.split("\n").filter(Boolean))];
}
