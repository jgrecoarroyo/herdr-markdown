// Markdown: open the .md files an agent just printed, rendered, inside Herdr.
//
// Two roles, one mod:
// - Opened as its overlay (cmd-shift-o → mod.open:markdown): a picker of the Markdown
//   files mentioned in the focused terminal's recent output, newest first. One match
//   opens straight away. Enter opens it in a new tab, cmd-Enter in a split beside the
//   terminal; type to filter, or type/paste a path.
// - As a pane (props: { file, on }): the file rendered, reloaded when it changes, with
//   Source/Preview, links to other .md files followed in place (Back), web links in the
//   browser.
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Editor, EditorState, TextView } from "gpui-base";
import { focused, panes, hc, exec, run, theme, settings, props, closeOverlay, home, appHome, readTextFile, watchFolder, nextCommand, window } from "herdr";
import * as fs from "fs/promises";
import { mentions, existing } from "./paths.js";
import { icon as drawIcon, writeIcons } from "./icons.js";
import { blocks, loadLocal, loadWeb, pruneOld } from "./pictures.js";

const DATA = () => `${appHome()}/data/markdown-viewer`;
const mac = () => window()?.platform === "macos";
const base = (p) => p.slice(p.lastIndexOf("/") + 1);
const dir = (p) => p.slice(0, p.lastIndexOf("/")) || "/";
const pretty = (p) => { const h = home(); return p === h || p.startsWith(h + "/") ? "~" + p.slice(h.length) : p; };

const openLink = (url) => exec(mac() ? "open" : "xdg-open", [url]).catch(() => null);
const reveal = (path) => exec(mac() ? "open" : "xdg-open", mac() ? ["-R", path] : [dir(path)]).catch(() => null);

// Opens a file outside Herdr. With the Markdown Router as macOS's default app for .md (router/), the
// default would send it straight back here, so this uses the app the router took over from.
async function openElsewhere(file) {
  if (!mac()) return exec("xdg-open", [file]).catch(() => null);
  const id = (await readTextFile(`${DATA()}/fallback`).catch(() => null))?.trim() ?? "";
  return exec("open", /^[\w.-]+$/.test(id) ? ["-b", id, file] : [file]).catch(() => null);
}

export default class Markdown extends View {
  init(_props, cx) {
    const p = props() ?? {};
    cx.spawn(async (cx) => { await writeIcons().catch(() => null); cx.notify(); });
    if (p.file) this.viewer = new Viewer(p.file, p.on ?? null, cx);
    else this.picker = new Picker(p.overlay, cx);
  }
  render(cx) { return (this.viewer ?? this.picker).render(cx); }
}

// Opens a file: a new tab named after it, or a split beside the pane that had focus.
function open(file, on, split, pane) {
  const p = { file, ...(on ? { on } : {}) };
  if (split && pane) run("pane.split", { direction: "right", pane, mod: "markdown-viewer", props: p });
  else run("tab.new", { mod: "markdown-viewer", props: p, name: base(file) });
}

class Picker {
  constructor(overlay, cx) {
    const f = focused();
    this.overlay = overlay; this.pane = f?.pane ?? null;
    this.terminal = f?.terminal ?? null;
    // Relative paths are from the pane's folder (where the agent works), as Changes finds it.
    this.cwd = (f?.pane && panes().find((p) => p.pane === f.pane)?.cwd) || f?.cwd || null;
    this.on = this.terminal?.includes("/") ? this.terminal.split("/")[0] : null;
    this.files = null; this.at = 0; this.filter = "";
    this.input = InputState.new({ placeholder: "Filter, or type a path…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; cx.notify(); });
    this.input.on("submit", (e, cx) => this.choose(this.shown()[this.at], Boolean(e?.secondary), cx));
    this.input.focus();
    cx.spawn(async (cx) => {
      try {
        if (!this.terminal) throw new Error("No terminal has focus");
        const r = await hc(["read", this.terminal, "--json", "--lines", "400"]);
        if (r.code !== 0) throw new Error((r.stderr || "Cannot read the terminal").trim());
        this.files = await existing(mentions(JSON.parse(r.stdout).text ?? ""), this.cwd, this.on);
        // One file mentioned: no need to choose.
        if (this.files.length === 1) return this.choose(this.files[0], false, cx);
      } catch (e) { this.error = String(e?.message ?? e); this.files = []; }
      cx.notify();
    });
  }

  shown() {
    const q = this.filter.trim().toLowerCase();
    return (this.files ?? []).filter((f) => !q || pretty(f).toLowerCase().includes(q));
  }

  choose(file, split, cx) {
    const typed = this.filter.trim();
    if (!file && typed) {
      // Nothing listed matches: try what was typed as a path.
      cx.spawn(async (cx) => {
        const [found] = await existing([typed], this.cwd, this.on).catch(() => []);
        if (found) { open(found, this.on, split, this.pane); closeOverlay(this.overlay); }
        else { this.error = `No file at ${typed}`; cx.notify(); }
      });
      return;
    }
    if (!file) return;
    open(file, this.on, split, this.pane);
    closeOverlay(this.overlay);
  }

  render(cx) {
    const t = theme(), list = this.shown();
    if (this.at >= list.length) this.at = Math.max(0, list.length - 1);
    const row = (f, i) => h_flex().id(`md-${i}`).h(44).px(12).gap(10).flex_none().items_center().rounded(7).cursor_pointer()
      .bg(i === this.at ? t.selected : t.popover).hover((s) => s.bg(i === this.at ? t.selected : t.hover))
      .on_click((e, cx) => this.choose(f, Boolean(e?.modifiers?.platform || e?.modifiers?.control), cx))
      .child(drawIcon("file").size(16).flex_none().text_color(t.muted))
      .child(v_flex().flex_1().min_w(0)
        .child(div().text_size(13).font_semibold().truncate().child(base(f)))
        .child(div().text_size(11).text_color(t.dim).truncate().child(pretty(dir(f)))))
      .child(div().id(`md-split-${i}`).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim)
        .hover((s) => s.bg(t.raised).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); this.choose(f, true, cx); })
        .child(drawIcon("split").size(14)));
    const note = this.error ?? (this.files === null ? "Reading the terminal…"
      : !this.files.length ? "No Markdown files in this terminal's recent output. Type a path."
      : !list.length ? "No match. Enter tries it as a path." : null);
    return v_flex().id("md-picker").size_full().bg(t.popover).text_color(t.foreground).text_size(13)
      .on_key_down((e, cx) => {
        const n = list.length;
        if (e.key === "escape") { closeOverlay(this.overlay); return; }
        if (e.key === "down" && n) this.at = (this.at + 1) % n;
        else if (e.key === "up" && n) this.at = (this.at + n - 1) % n;
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(h_flex().h(46).flex_none().px(14).gap(10).items_center().border_b(1).border_color(t.border)
        .child(drawIcon("file").size(16).text_color(t.accent))
        .child(div().flex_1().min_w(0).h_full().flex().items_center().child(Input.new(this.input).w_full().text_size(14).text_color(t.foreground))))
      .child(v_flex().id("md-list").h(330).flex_none().overflow_y_scrollbar().p(6).gap(1)
        .children(list.map(row))
        .when(Boolean(note), (e) => e.child(div().px(12).py(16).text_size(12).text_color(this.error ? t.ansi1 : t.dim).child(note))))
      .child(h_flex().h(30).flex_none().px(14).gap(14).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child("↵ new tab").child(`${mac() ? "⌘" : "ctrl "}↵ split beside`).child("↑↓ choose").child("esc close"));
  }
}

// Front matter isn't part of what a reader sees.
const body = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, "");

class Viewer {
  constructor(file, on, cx) {
    this.file = file; this.on = on; this.history = []; this.text = null; this.error = null;
    this.source = localStorage.getItem("source") === "1"; this.editor = null; this.gen = 0;
    this.parts = []; this.pictures = {};
    pruneOld();
    this.load(cx);
    this.listen(cx);
    cx.timer.every(on ? 3000 : 15000, (cx) => this.reload(cx)); // a remote file can't be watched; a local one is, this is the backstop
  }

  // open.sh (the Markdown Router on macOS, while Herdr is in front) asks a viewer that's showing to
  // take the file: it writes data/markdown-viewer/request.json and runs `markdown-viewer.show`.
  // The one that takes it answers in data/markdown-viewer/ack; with no answer, open.sh splits a new one.
  listen(cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c !== "show") continue;
        try {
          const folder = DATA();
          const req = JSON.parse(await fs.readFile(`${folder}/request.json`, "utf8"));
          if (!req?.file || req.id === this.answered) continue;
          this.answered = req.id;
          await fs.writeFile(`${folder}/ack`, req.id);
          if (req.file !== this.file) { this.history.push(this.file); this.file = req.file; this.on = null; this.load(cx); }
          cx.notify();
        } catch {}
      }
    });
  }

  load(cx) {
    const gen = ++this.gen, file = this.file;
    this.text = null; this.error = null; this.editor?.release(); this.editor = null;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(file, { on: this.on });
        if (gen !== this.gen) return;
        if (text === null) this.error = "This file isn't there (anymore).";
        else this.set(text, cx);
      } catch (e) { if (gen === this.gen) this.error = String(e?.message ?? e); }
      cx.notify();
      if (!this.on && gen === this.gen) this.watch(gen, cx);
    });
  }

  set(text, cx) {
    this.text = text;
    this.parts = blocks(body(text), this.file);
    this.checkPictures(cx);
    if (this.editor) this.editor.set_value(text);
    else if (this.source) this.editor = this.makeEditor(text);
  }

  // Local images load by themselves, and are checked again in case they changed. A file on another
  // machine isn't here to copy from, so its images stay as a note.
  checkPictures(cx) {
    if (this.on || this.checking) return;
    const gen = this.gen, local = this.parts.flatMap((p) => p.images ?? []).filter((i) => !i.web);
    if (!local.length) return;
    this.checking = true;
    cx.spawn(async (cx) => {
      try {
        for (const { src } of local) {
          const found = await loadLocal(src).catch(() => ({ state: "failed", why: "could not be read" }));
          if (gen !== this.gen) return;
          if (JSON.stringify(found) !== JSON.stringify(this.pictures[src])) { this.pictures[src] = found; cx.notify(); }
        }
      } finally { this.checking = false; }
    });
  }

  // A web image downloads only here, after a click.
  fetchWeb(url, cx) {
    if (this.pictures[url]?.state === "loading") return;
    this.pictures[url] = { state: "loading" };
    cx.notify();
    cx.spawn(async (cx) => {
      this.pictures[url] = await loadWeb(url).catch(() => ({ state: "failed", why: "could not be downloaded" }));
      cx.notify();
    });
  }

  // As GitHub sizes one: its width attribute, else its own, never wider than the column.
  picture(key, item, t) {
    const found = this.pictures[item.src];
    const room = Math.max(160, Math.min(860, this.width ?? 860) - 56);
    if (found?.state === "ready") {
      const w = Math.min(item.width ?? found.width, room), h = Math.max(1, Math.round(found.height * w / found.width));
      return image(found.path).w(w).h(h).flex_none().rounded(6);
    }
    const host = item.web ? item.src.replace(/^https?:\/\//i, "").split("/")[0] : item.src.slice(item.src.lastIndexOf("/") + 1);
    const label = item.alt || host;
    const note = item.web
      ? (found?.state === "loading" ? "Loading…" : found?.state === "failed" ? `${host}: ${found.why}. Click to retry` : item.alt ? `${host}: click to load` : "Click to load")
      : this.on ? `On ${this.on}` : found?.state === "failed" ? `${host}: ${found.why}` : "Loading…";
    return h_flex().id(key).h(30).px(10).gap(8).flex_none().min_w(0).items_center().rounded(6).border_1().border_color(t.border).bg(t.raised)
      .text_size(12).text_color(t.muted).overflow_hidden().max_w(room)
      .when(Boolean(item.web), (e) => e.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => this.fetchWeb(item.src, cx)))
      .child(drawIcon("image").size(14).flex_none())
      .child(div().min_w(0).truncate().child(label))
      .child(div().flex_none().text_color(t.dim).child(note));
  }

  makeEditor(value) {
    const t = theme();
    return EditorState.new({ language: "markdown", value, readonly: true, soft_wrap: true, folding: false,
      font_family: settings().font_family, font_size: 13,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6, punctuation: t.muted } });
  }

  reload(cx) {
    const gen = this.gen, file = this.file;
    cx.spawn(async (cx) => {
      const text = await readTextFile(file, { on: this.on }).catch(() => undefined);
      if (gen !== this.gen || text === undefined) return;
      if (text === this.text) { this.checkPictures(cx); return; }
      if (text === null) this.error = "This file isn't there (anymore)."; else { this.error = null; this.set(text, cx); }
      cx.notify();
    });
  }

  watch(gen, cx) {
    const folder = dir(this.file);
    cx.spawn(async (cx) => {
      while (gen === this.gen) {
        try { await watchFolder(folder); } catch { return; }
        if (gen === this.gen) this.reload(cx);
      }
    });
  }

  // Links: another .md file opens here (Back returns); web links go to the browser;
  // any other local file is only shown in its folder, never opened (a link could point at
  // something that runs).
  link(url, cx) {
    if (/^(https?|mailto):/i.test(url)) { openLink(url); return; }
    if (/^[a-z][\w+.-]*:/i.test(url) && !url.startsWith("file:")) return;
    let path = url.replace(/^file:\/\//, "").split("#")[0];
    try { path = decodeURIComponent(path); } catch {}
    if (!path) return;
    if (path.startsWith("~/")) path = home() + path.slice(1);
    else if (!path.startsWith("/")) path = `${dir(this.file)}/${path}`;
    path = path.split("/").reduce((acc, part) => part === ".." ? acc.slice(0, -1) : part === "." || part === "" ? acc : [...acc, part], []).join("/");
    path = "/" + path;
    if (/\.(md|markdown|mdx)$/i.test(path)) { this.history.push(this.file); this.file = path; this.load(cx); cx.notify(); }
    else if (!this.on) reveal(path);
  }

  back(cx) {
    const prev = this.history.pop();
    if (prev) { this.file = prev; this.load(cx); cx.notify(); }
  }

  render(cx) {
    const t = theme(), stop = (_e, cx) => cx.stop_propagation();
    const button = (id, icon, title, on, action) => h_flex().id(id).h(26).px(8).gap(5).flex_none().items_center().rounded(6).text_size(12)
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop).on_click(action)
      .child(drawIcon(icon).size(14)).when(Boolean(title), (e) => e.child(title));
    const content = this.error ? div().p(20).text_color(t.ansi1).child(this.error)
      : this.text === null ? div().p(20).text_color(t.dim).child("Loading…")
      : this.source
        ? div().flex_1().min_h(0).p(6).when(Boolean(this.editor), (e) => e.child(Editor.new(this.editor).size_full()))
        : div().id("md-scroll").flex_1().min_h(0).overflow_y_scrollbar()
            .child(h_flex().w_full().justify_center()
              .child(v_flex().flex_1().min_w(0).max_w(860).overflow_hidden().px(28).py(24).text_size(14)
                .child(this.parts.length
                  ? v_flex().w_full().gap(12).children(this.parts.map((part, n) => part.images
                    ? h_flex().w_full().flex_wrap().gap(8).items_center().children(part.images.map((item, i) => this.picture(`md-image-${this.gen}-${n}-${i}`, item, t)))
                    : TextView.markdown(`md-${this.gen}-${n}`, part.text).selectable(true).on_link_click((url, cx) => this.link(url, cx))))
                  : div().text_color(t.dim).child("This file is empty."))));
    return v_flex().id("md-viewer").size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .child(h_flex().h(40).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .when(this.history.length > 0, (e) => e.child(button("md-back", "back", "Back", false, (_e, cx) => this.back(cx))))
        .child(drawIcon("file").size(14).flex_none().text_color(t.accent))
        .child(div().flex_none().text_size(13).font_semibold().child(base(this.file)))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child((this.on ? `${this.on}:` : "") + pretty(dir(this.file))))
        .child(button("md-mode", this.source ? "eye" : "code", this.source ? "Preview" : "Source", false, (_e, cx) => {
          this.source = !this.source;
          // Editor state can't be created while drawing, so it's made here (or in set(), on load).
          if (this.source && !this.editor && this.text !== null) this.editor = this.makeEditor(this.text);
          try { localStorage.setItem("source", this.source ? "1" : "0"); } catch {}
          cx.notify();
        }))
        .when(!this.on, (e) => e
          .child(button("md-reveal", "folder", null, false, () => { reveal(this.file); }))
          .child(button("md-external", "external", null, false, () => { openElsewhere(this.file); }))))
      .child(content);
  }
}
