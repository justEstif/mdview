import {
  Key,
  Markdown,
  ScrollView,
  VStack,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";
import { markdownTheme } from "./theme";
import type { MdviewConfig } from "./config";

export type ViewportTui = TUI & {
  setFocus: (c: Component | null) => void;
  setLayoutRoot: (c: Component | undefined) => void;
  scrollBy: (n: number) => void;
  scrollToTop: () => void;
  scrollToBottom: () => void;
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

/** Scrollable markdown body. Rendered inside the layout's primary ScrollView. */
class MarkdownBody implements Component {
  constructor(
    private readonly markdown: Markdown,
    private readonly cfg: MdviewConfig,
  ) {}

  render(width: number): string[] {
    const contentWidth =
      this.cfg.maxWidth !== undefined ? Math.max(1, Math.min(width, this.cfg.maxWidth)) : width;
    const lines = this.markdown.render(contentWidth);
    if (contentWidth < width && this.cfg.center !== false) {
      const pad = Math.floor((width - contentWidth) / 2);
      return lines.map((line) => " ".repeat(pad) + line);
    }
    return lines;
  }

  invalidate(): void {
    this.markdown.invalidate();
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

/** Full-screen keybind help, toggled with `?`. */
class HelpOverlay implements Component {
  private entries: [string, string][] = [
    ["j / k / arrows / wheel", "scroll one line"],
    ["d / u", "scroll 10 lines"],
    ["space", "scroll 20 lines"],
    ["gg / G", "jump to top / bottom"],
    ["h / l", "previous / next file"],
    ["n / p", "next / previous file"],
    ["o", "open file picker"],
    ["/", "search"],
    ["?", "toggle this help"],
    ["q / Esc / Ctrl+C", "quit"],
  ];

  render(width: number): string[] {
    const title = fgHelp(75)(" mdview — keybinds ");
    const lines = [title, ""];
    const keyW = Math.max(...this.entries.map(([k]) => visibleWidth(k)));
    for (const [key, desc] of this.entries) {
      const pad = " ".repeat(keyW - visibleWidth(key));
      lines.push(`  ${fgHelp(110)(key + pad)}  ${desc}`);
    }
    lines.push("", fgHelp(245)(" press any key to close "));
    return lines;
  }

  invalidate(): void {}
}

const fgHelp = (code: number) => (s: string) => `\x1b[38;5;${code}m${s}\x1b[39m`;

export class Viewer implements Component {
  private state: ViewerState;
  private markdown: Markdown;
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
    this.markdown = new Markdown(
      this.currentContent(),
      this.cfg.paddingX ?? 1,
      this.cfg.paddingY ?? 1,
      markdownTheme,
    );
    this.body = new MarkdownBody(this.markdown, this.cfg);
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

  get layoutRoot(): Component {
    return this.root;
  }

  showFile(index: number): void {
    if (index < 0 || index >= this.state.files.length) return;
    this.state.index = index;
    this.markdown.setText(this.currentContent());
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
      this.showHelp = false;
      this.tui.setLayoutRoot(this.root);
      if (data !== "?") {
        this.tui.requestRender();
        return;
      }
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
    else if (data === "n") this.nextFile();
    else if (data === "p") this.prevFile();
    else if (data === "o") this.onOpenFile(this.state.files[this.state.index]!);
    else if (data === "?") {
      this.showHelp = !this.showHelp;
      this.tui.setLayoutRoot(this.showHelp ? this.help : this.root);
    }
    else if (data === "q" || matchesKey(data, "ctrl+c") || matchesKey(data, "esc")) {
      if (this.showHelp) {
        this.showHelp = false;
        this.tui.setLayoutRoot(this.root);
      } else this.quitNow();
    }
    else return;

    this.tui.requestRender();
  }

  render(width: number): string[] {
    const lines = this.body.render(width);
    this.lastContentHeight = lines.length;
    // Status bar renders itself as part of the VStack root.
    return this.root.render(width);
  }

  invalidate(): void {
    this.markdown.invalidate();
  }
}
