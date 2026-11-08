// Herdr draws images only from real folders, and this mod's folder may be a link to its git clone,
// so the icons live here and are written to its data folder. An empty box stands in until they are.
import { div, svg } from "gpui-kit";
import { appHome } from "herdr";
import * as fs from "fs/promises";

const SVG = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  back: SVG(`<path d="m15 18-6-6 6-6"/>`),
  code: SVG(`<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>`),
  external: SVG(`<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>`),
  eye: SVG(`<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>`),
  file: SVG(`<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>`),
  folder: SVG(`<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>`),
  split: SVG(`<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>`),
};

let ready = false, written = null;

// Resolves once the icons are on disk; redraw after that.
export function writeIcons() {
  written ??= (async () => {
    const folder = `${appHome()}/data/markdown-viewer/icons`;
    await fs.mkdir(folder, { recursive: true });
    for (const [name, content] of Object.entries(ICONS)) await fs.writeFile(`${folder}/${name}.svg`, content);
    ready = true;
  })();
  return written;
}

export const icon = (name) => ready ? svg(`data/markdown-viewer/icons/${name}.svg`) : div();
