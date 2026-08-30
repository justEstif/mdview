import {
  Key,
  Markdown,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";
import { markdownTheme } from "./theme";

export type ViewportTui = TUI & {
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

export class Viewer implements Component {
  private state: ViewerState;
  private markdown: Markdown;
  private tui: ViewportTui;
  private onQuit: () => void;
  private onOpenFile: (file: string) => void;
  private pendingG = false;

  constructor(opts: {
    tui: TUI;
    state: ViewerState;
    onQuit: () => void;
    onOpenFile: (file: string) => void;
  }) {
    this.tui = asViewport(opts.tui);
    this.state = opts.state;
    this.onQuit = opts.onQuit;
    this.onOpenFile = opts.onOpenFile;
    this.markdown = new Markdown(
      this.currentContent(),
      1, // paddingX
      1, // paddingY
      markdownTheme,
    );
  }

  private currentContent(): string {
    return this.state.contents.get(this.state.files[this.state.index]!) ?? "";
  }

  showFile(index: number): void {
    if (index < 0 || index >= this.state.files.length) return;
    this.state.index = index;
    this.markdown.setText(this.currentContent());
    this.tui.scrollToTop();
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
        this.tui.scrollToTop();
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
    else if (data === "G") this.tui.scrollToBottom();
    else if (data === "g") this.pendingG = true;
    else if (matchesKey(data, "space")) viewport.scrollBy(20);
    else if (data === "n") this.nextFile();
    else if (data === "p") this.prevFile();
    else if (data === "o") this.onOpenFile(this.state.files[this.state.index]!);
    else if (data === "q" || matchesKey(data, "ctrl+c") || matchesKey(data, "esc"))
      this.onQuit();
    else return;

    this.tui.requestRender();
  }

  render(width: number): string[] {
    const lines = this.markdown.render(width);

    // Footer: filename, index, hints
    const file = this.state.files[this.state.index]!;
    const label =
      this.state.files.length > 1
        ? `[${this.state.index + 1}/${this.state.files.length}] `
        : "";
    const hints = "j/k scroll  gg/G top/bottom  h/l files  / search  o open  q quit";
    const left = ` ${label}${file} `;
    const right = ` ${hints} `;
    const pad = Math.max(0, width - visibleWidth(left) - visibleWidth(right));
    const footer = "\x1b[48;5;236m\x1b[38;5;250m" + truncateToWidth(left + " ".repeat(pad) + right, width) + "\x1b[0m";

    return [...lines, footer];
  }

  invalidate(): void {
    this.markdown.invalidate();
  }
}
