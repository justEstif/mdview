import { dirname, resolve } from "node:path";
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
import { box, clip, ui, visibleWidth } from "./ui";
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

/** Pinned status bar: filename, file index, scroll position. */
class StatusBar implements Component {
  constructor(
    private readonly state: ViewerState,
    private readonly scrollInfo: () => { top: number; contentHeight: number; viewportHeight: number },
  ) {}

  render(width: number): string[] {
    const file = this.state.files[this.state.index]!;
    const label =
      this.state.files.length > 1
        ? `[${this.state.index + 1}/${this.state.files.length}] `
        : "";
    const { top, contentHeight, viewportHeight } = this.scrollInfo();
    let pos = "top";
    if (contentHeight > viewportHeight) {
      if (top <= 0) pos = "top";
      else if (top >= contentHeight - viewportHeight) pos = "end";
      else pos = `${Math.round((top / (contentHeight - viewportHeight)) * 100)}%`;
    }
    const left = ` ${label}${file} `;
    const right = ` ${pos} │ ? help `;
    const pad = Math.max(0, width - visibleWidth(left) - visibleWidth(right));
    const bar =
      "\x1b[48;5;236m\x1b[38;5;250m" +
      truncateToWidth(left + " ".repeat(pad) + right, width) +
      "\x1b[0m";
    return [bar];
  }

  invalidate(): void {}
}

/** Compact keybind help box, shown via tui.showOverlay (mini.clue style). */
class HelpOverlay implements Component {
  private groups: [string, [string, string][]][] = [
    ["navigate", [
      ["j/k ↑↓", "scroll line"],
      ["d/u", "scroll 10"],
      ["space", "scroll 20"],
      ["gg/G", "top / bottom"],
    ]],
    ["files", [
      ["h/l  n/p", "prev / next file"],
      ["o", "file picker"],
      ["/", "search (enter cycles, esc closes)"],
    ]],
    ["quit", [
      ["q  Esc  ⌃C", "quit"],
    ]],
  ];

  render(width: number): string[] {
    return clipToWidth(this.rows(), width);
  }

  rows(): string[] {
    const keyW = Math.max(
      ...this.groups.flatMap(([, es]) => es.map(([k]) => k.length)),
    );
    const labelW = Math.max(
      ...this.groups.flatMap(([, es]) => es.map(([, d]) => d.length)),
    );
    const rows: string[] = [];
    for (const [group, entries] of this.groups) {
      rows.push(` ${ui.accent(group)}`);
      for (const [key, desc] of entries) {
        rows.push(` ${ui.fg(110)(key.padEnd(keyW))}   ${desc}`);
      }
    }
    return box(rows);
  }

  get height(): number {
    return this.rows().length;
  }

  get width(): number {
    return visibleWidth(this.rows()[0] ?? "");
  }

  invalidate(): void {}
}

const clipToWidth = (lines: string[], w: number): string[] => lines.map((l) => clip(l, w));

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
  private showHelp = false;
  private help = new HelpOverlay();

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
    const status = new StatusBar(this.state, () => ({
      top: this.scrollView.scrollTop,
      viewportHeight: this.scrollView.viewportHeight,
      contentHeight: this.lastContentHeight,
    }));
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

    if (this.showHelp) {
      this.hideHelp();
      this.tui.requestRender();
      return;
    }

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
    else if (matchesKey(data, "space")) viewport.scrollBy(20);
    else if (data === "/") this.tui.openSearch();
    else if (data === "n") this.nextFile();
    else if (data === "p") this.prevFile();
    else if (data === "o") this.onOpenFile(this.state.files[this.state.index]!);
    else if (data === "?") this.showHelp ? this.hideHelp() : this.revealHelp();
    else if (data === "q" || matchesKey(data, "ctrl+c") || matchesKey(data, "esc")) {
      if (this.showHelp) this.hideHelp();
      else this.quitNow();
    }
    else return;

    this.tui.requestRender();
  }

  private revealHelp(): void {
    this.showHelp = true;
    // 1-row offset keeps the pinned status bar visible
    const offsetY = this.cfg.statusBar === false ? 0 : -1;
    this.tui.showOverlay(this.help, { anchor: "bottom-left", nonCapturing: true, offsetY });
  }

  private hideHelp(): void {
    this.showHelp = false;
    this.tui.hideOverlay();
  }

  render(width: number): string[] {
    const lines = this.body.render(width);
    this.lastContentHeight = lines.length;
    return this.root.render(width);
  }

  invalidate(): void {
    this.body.invalidate();
  }
}
