import { dirname, relative, resolve } from "node:path";
import { readFileSync } from "node:fs";
import {
  Image,
  Key,
  Markdown,
  ScrollView,
  VStack,
  getCapabilities,
  matchesKey,
  truncateToWidth,
  type Component,
  type OverlayAnchor,
  type TUI,
} from "@earendil-works/pi-tui";
import { markdownTheme } from "./theme";
import { BarStack, type BarItem } from "./barstack";
import { ui, visibleWidth } from "./ui";
import type { MdviewConfig } from "./config";

export type ViewportTui = TUI & {
  setFocus: (c: Component | null) => void;
  setLayoutRoot: (c: Component | undefined) => void;
  scrollBy: (n: number) => void;
  scrollToTop: () => void;
  scrollToBottom: () => void;
  openSearch: () => void;
};

export const asViewport = (tui: TUI): ViewportTui => tui as ViewportTui;

export interface ViewerState {
  /** Ordered list of markdown files being viewed */
  files: string[];
  /** Current file index */
  index: number;
  /** Map of file -> file contents */
  contents: Map<string, string>;
}

/** A standalone image line: `![alt](path "title")` */
const IMG_LINE = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/;

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

type Segment =
  | { type: "md"; text: string; component: Markdown }
  | { type: "img"; component: Image | Markdown };

/** Scrollable markdown body with inline image support (kitty/iterm2).
 *  Falls back to plain markdown (alt text link) when the terminal can't show
 *  images or the file can't be read. */
class MarkdownBody implements Component {
  private segments: Segment[] = [];

  constructor(
    text: string,
    private readonly cfg: MdviewConfig,
    /** Directory to resolve relative image paths against */
    private readonly baseDir: string,
  ) {
    this.setText(text);
  }

  setText(text: string): void {
    this.segments = [];
    const caps = getCapabilities();
    const lines = text.split("\n");
    let buf: string[] = [];
    const flush = () => {
      if (buf.length === 0) return;
      this.segments.push({ type: "md", text: buf.join("\n"), component: this.makeMarkdown(buf.join("\n")) });
      buf = [];
    };
    for (const line of lines) {
      const m = line.match(IMG_LINE);
      if (m && caps.images && !m[2]!.startsWith("http")) {
        flush();
        this.segments.push({ type: "img", component: this.makeImage(m[1] ?? "", m[2]!) ?? this.makeMarkdown(line) });
      } else {
        buf.push(line);
      }
    }
    flush();
  }

  private makeMarkdown(text: string): Markdown {
    return new Markdown(text, this.cfg.paddingX ?? 1, this.cfg.paddingY ?? 1, markdownTheme);
  }

  /** Returns undefined when the image can't be loaded. */
  private makeImage(alt: string, src: string): Image | undefined {
    const full = resolve(this.baseDir, src);
    let data: Buffer;
    try {
      data = readFileSync(full);
    } catch {
      return undefined;
    }
    const ext = full.slice(full.lastIndexOf(".") + 1).toLowerCase();
    const mimeType = MIME_BY_EXT[ext];
    if (!mimeType) return undefined;
    return new Image(data.toString("base64"), mimeType, { fallbackColor: ui.dim }, {
      filename: alt || src,
    });
  }

  render(width: number): string[] {
    const contentWidth =
      this.cfg.maxWidth !== undefined ? Math.max(1, Math.min(width, this.cfg.maxWidth)) : width;
    const lines: string[] = [];
    for (const seg of this.segments) {
      lines.push(...seg.component.render(contentWidth));
    }
    if (contentWidth < width && this.cfg.center !== false) {
      const pad = Math.floor((width - contentWidth) / 2);
      return lines.map((line) => " ".repeat(pad) + line);
    }
    return lines;
  }

  invalidate(): void {
    for (const seg of this.segments) seg.component.invalidate();
  }
}

/** Pinned two-tier status bar: tab strip + position on line 1, key hints on line 2. */
class StatusBar implements Component {
  /** Toggled by `?`: show the keymap line in place of the tab strip. */
  showKeys = false;

  constructor(
    private readonly state: ViewerState,
    private readonly scrollInfo: () => { top: number; contentHeight: number; viewportHeight: number },
  ) {}

  /** Scan-friendly label: cwd-relative path, tail-truncated for tabs. */
  private label(file: string, max = 24): string {
    if (file === "(stdin)") return file;
    const rel = relative(process.cwd(), file);
    const l = rel.startsWith("..") ? file : rel;
    return l.length > max ? "…" + l.slice(l.length - max + 1) : l;
  }

  private position(): string {
    const { top, contentHeight, viewportHeight } = this.scrollInfo();
    if (contentHeight <= viewportHeight) return "0%";
    if (top >= contentHeight - viewportHeight) return "100%";
    return `${Math.max(0, Math.round((top / (contentHeight - viewportHeight)) * 100))}%`;
  }

  private tabStrip(): string {
    const { files, index } = this.state;
    if (files.length <= 1) return ` ${this.label(files[index]!, 40)} `;
    const tab = (i: number) => {
      const name = this.label(files[i]!);
      const body = `${i === index ? " ▸ " : "   "}${name}`;
      return i === index ? `\x1b[7m${body}\x1b[27m` : body;
    };
    const wide = files.length > 4;
    const idxs = wide
      ? [index - 1, index, index + 1].filter((i) => i >= 0 && i < files.length)
      : files.map((_, i) => i);
    let strip = idxs.map(tab).join(" │ ");
    if (wide) {
      if (index > 1) strip = ` … │ ${strip}`;
      if (index < files.length - 2) strip += ` │ … `;
    }
    return ` ${strip} `;
  }

  private tier(width: number, left: string, right: string, bg: number, fg: number): string {
    const pad = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
    const line = left + " ".repeat(pad) + right;
    return `\x1b[48;5;${bg}m\x1b[38;5;${fg}m` + truncateToWidth(line, width) + "\x1b[0m";
  }

  render(width: number): string[] {
    const keys =
      " jk↓↑ scroll · du·10 · ggG ends · hl/np files · o pick · / find · q quit ";
    if (this.showKeys) {
      return [this.tier(width, keys, " ? close ", 236, 250)];
    }
    const { files, index } = this.state;
    const pos = this.position();
    const count = files.length > 4 ? `${index + 1}/${files.length} · ` : "";
    return [this.tier(width, this.tabStrip(), ` ${count}${pos} │ ? help `, 236, 250)];
  }

  invalidate(): void {}
}

export class Viewer implements Component {
  private state: ViewerState;
  private body: MarkdownBody;
  private scrollView: ScrollView;
  private root: VStack;
  private tui: ViewportTui;
  private cfg: MdviewConfig;
  private onQuit: () => void;
  private onOpenFile: (file: string) => void;
  private pendingG = false;

  constructor(opts: {
    tui: TUI;
    state: ViewerState;
    cfg: MdviewConfig;
    onQuit: () => void;
    onOpenFile: (file: string) => void;
  }) {
    this.tui = asViewport(opts.tui);
    this.state = opts.state;
    this.cfg = opts.cfg;
    this.onQuit = opts.onQuit;
    this.onOpenFile = opts.onOpenFile;
    this.body = new MarkdownBody(this.currentContent(), this.cfg, this.currentBaseDir());
    // The primary ScrollView is what TuiAltScreen.scrollBy() actually scrolls.
    this.scrollView = new ScrollView(this.body, { primary: true, follow: "none" });
    const status: StatusBar = new StatusBar(this.state, () => ({
      top: this.scrollView.scrollTop,
      viewportHeight: this.scrollView.viewportHeight,
      contentHeight: this.lastContentHeight,
    }));
    this.status = status;
    this.root = new VStack(
      [
        { component: this.scrollView, basis: 0, grow: 1 },
        ...(this.cfg.statusBar === false
          ? []
          : [{ component: status as Component, basis: 1, shrink: 0, grow: 0 }]),
      ],
      { gap: 0 },
    );
  }

  private status!: StatusBar;

  private searchOverlay: ReturnType<ViewportTui["showOverlay"]> | null = null;
  private lastWidth = 80;
  private plainCache: { key: string; lines: string[] } | null = null;

  /** Rendered body lines with styling stripped — what `/` searches. */
  private renderedPlain(): string[] {
    const key = `${this.state.index}:${this.lastWidth}`;
    if (this.plainCache?.key === key) return this.plainCache.lines;
    const strip = (l: string) =>
      l.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
    const lines = this.body.render(this.lastWidth).map(strip);
    this.plainCache = { key, lines };
    return lines;
  }

  /** `/` — results stack above a bar-anchored input; enter jumps to the line. */
  private openBarSearch(): void {
    this.searchOverlay?.hide();
    const yellow = (s: string) => `\x1b[38;5;228m${s}\x1b[39m`;
    const stack = new BarStack({
      prefix: "/",
      placeholder: "find…",
      maxRows: 8,
      source: (query): BarItem[] => {
        const q = query.toLowerCase();
        if (!q) return [];
        const plain = this.renderedPlain();
        const out: BarItem[] = [];
        for (let i = 0; i < plain.length && out.length < 50; i++) {
          const text = plain[i]!.trim();
          if (!text) continue;
          const at = text.toLowerCase().indexOf(q);
          if (at < 0) continue;
          out.push({
            value: String(i),
            label: text.slice(0, 80),
            description: String(i + 1),
            styled: text.slice(0, at) + yellow(text.slice(at, at + q.length)) + text.slice(at + q.length),
          });
        }
        return out;
      },
      onPick: (value) => {
        this.searchOverlay?.hide();
        this.searchOverlay = null;
        this.scrollView.scrollTo(Number(value));
        this.tui.requestRender();
      },
      onCancel: () => {
        this.searchOverlay?.hide();
        this.searchOverlay = null;
        this.tui.requestRender();
      },
      hint: (n, q) =>
        !q ? "enter jump · esc back"
        : n ? `${n} lines · enter jump · esc back`
        : "no matches · esc back",
    });
    this.searchOverlay = this.tui.showOverlay(stack, { anchor: "bottom-left" });
  }

  private toggleKeys(): void {
    this.status.showKeys = !this.status.showKeys;
  }

  /** Content height from the last body render, for the status bar percentage. */
  private lastContentHeight = 0;

  /** Quit, hiding the transient scrollbar first so the exit snapshot is clean. */
  private quitNow(): void {
    this.scrollView.setScrollbar("hidden");
    this.onQuit();
  }

  private currentContent(): string {
    return this.state.contents.get(this.state.files[this.state.index]!) ?? "";
  }

  /** Directory of the current file, for resolving relative image paths. */
  private currentBaseDir(): string {
    const f = this.state.files[this.state.index]!;
    return f === "(stdin)" ? process.cwd() : dirname(f);
  }

  get layoutRoot(): Component {
    return this.root;
  }

  showFile(index: number): void {
    if (index < 0 || index >= this.state.files.length) return;
    this.state.index = index;
    this.body.setText(this.currentContent());
    this.scrollView.scrollToStart();
    this.tui.requestRender();
  }

  nextFile(): void {
    if (this.state.index < this.state.files.length - 1) this.showFile(this.state.index + 1);
  }

  prevFile(): void {
    if (this.state.index > 0) this.showFile(this.state.index - 1);
  }

  handleInput(data: string): void {
    const viewport = this.tui;

    if (this.pendingG) {
      this.pendingG = false;
      if (data === "g") {
        this.scrollView.scrollToStart();
        this.tui.requestRender();
        return;
      }
    }

    if (matchesKey(data, Key.down) || data === "j") viewport.scrollBy(1);
    else if (matchesKey(data, Key.up) || data === "k") viewport.scrollBy(-1);
    else if (matchesKey(data, "ctrl+d") || data === "d") viewport.scrollBy(10);
    else if (matchesKey(data, "ctrl+u") || data === "u") viewport.scrollBy(-10);
    else if (matchesKey(data, Key.right) || data === "l") this.nextFile();
    else if (matchesKey(data, Key.left) || data === "h") this.prevFile();
    else if (data === "G") this.scrollView.scrollToEnd();
    else if (data === "g") this.pendingG = true;
    else if (data === "/") this.openBarSearch();
    else if (data === "n") this.nextFile();
    else if (data === "p") this.prevFile();
    else if (data === "o") this.onOpenFile(this.state.files[this.state.index]!);
    else if (data === "?") this.toggleKeys();
    else if (data === "q" || matchesKey(data, "ctrl+c") || matchesKey(data, "esc")) {
      this.quitNow();
    }
    else return;

    this.tui.requestRender();
  }

  render(width: number): string[] {
    this.lastWidth = width;
    const lines = this.body.render(width);
    this.lastContentHeight = lines.length;
    return this.root.render(width);
  }

  invalidate(): void {
    this.body.invalidate();
  }
}
