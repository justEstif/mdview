import {
  Container,
  Key,
  SelectList,
  matchesKey,
  type Component,
  type SelectItem,
  type TUI,
} from "@earendil-works/pi-tui";

export class FilePicker implements Component {
  private container: Container;
  private list: SelectList;

  constructor(opts: {
    tui: TUI;
    files: SelectItem[];
    onPick: (value: string) => void;
    onCancel: () => void;
  }) {
    this.container = new Container();
    const dim = (s: string) => `\x1b[38;5;245m${s}\x1b[39m`;
    const accent = (s: string) => `\x1b[38;5;75m${s}\x1b[39m`;

    this.container.addChild({
      render: (w) => [accent(` ${"mdview"} — pick a file`), dim(" ")].map((l) =>
        l.length > w ? l.slice(0, w) : l,
      ),
      invalidate: () => {},
    });

    this.list = new SelectList(opts.files, Math.min(opts.files.length, 20), {
      selectedPrefix: (t) => accent(t),
      selectedText: (t) => accent(t),
      description: (t) => dim(t),
      scrollInfo: (t) => dim(t),
      noMatch: (t) => dim(t),
    });
    this.list.onSelect = (item) => opts.onPick(item.value);
    this.list.onCancel = () => opts.onCancel();
    this.container.addChild(this.list);

    this.container.addChild({
      render: () => [dim(" ↑↓ navigate • enter open • q quit")],
      invalidate: () => {},
    });

    // q to quit from picker
    const origHandle = this.list.handleInput?.bind(this.list);
    this.list.handleInput = (data: string) => {
      if (data === "q" || matchesKey(data, Key.escape)) {
        opts.onCancel();
        return;
      }
      origHandle?.(data);
    };
  }

  handleInput(data: string): void {
    this.list.handleInput?.(data);
  }

  render(width: number): string[] {
    return this.container.render(width);
  }

  invalidate(): void {
    this.container.invalidate();
  }
}
