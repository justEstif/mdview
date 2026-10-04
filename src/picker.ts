import {
  Container,
  Key,
  SelectList,
  fuzzyFilter,
  matchesKey,
  type Component,
  type SelectItem,
  type TUI,
} from "@earendil-works/pi-tui";
import { Input } from "@earendil-works/pi-tui/dist/components/input";
import { clip, ui } from "./ui";

export class FilePicker implements Component {
  private container: Container;
  private input: Input;
  private list: SelectList;
  private files: SelectItem[];
  private query = "";
  private maxVisible: number;
  private onPick: (value: string) => void;
  private onCancel: () => void;

  constructor(opts: {
    tui: TUI;
    files: SelectItem[];
    onPick: (value: string) => void;
    onCancel: () => void;
  }) {
    this.files = opts.files;
    this.onPick = opts.onPick;
    this.onCancel = opts.onCancel;
    this.maxVisible = Math.min(opts.files.length, 20);

    this.container = new Container();
    this.container.addChild({
      render: (w) => [clip(ui.accent(" mdview — pick a file"), w)],
      invalidate: () => {},
    });

    this.input = new Input();
    this.container.addChild({
      render: (w) => [clip(`${ui.accent(" filter ")}${this.input.render(w - 8)[0] ?? ""}`, w)],
      invalidate: () => this.input.invalidate(),
    });

    this.list = this.makeList(this.files);
    this.container.addChild(this.list);
    this.container.addChild(this.footer);
  }

  private footer: Component = {
    render: () => [ui.dim(" type to filter • ↑↓ navigate • enter open • esc quit")],
    invalidate: () => {},
  };

  private makeList(items: SelectItem[]): SelectList {
    const list = new SelectList(items, this.maxVisible, {
      selectedPrefix: (t) => ui.accent(t),
      selectedText: (t) => ui.accent(t),
      description: (t) => ui.dim(t),
      scrollInfo: (t) => ui.dim(t),
      noMatch: (t) => ui.dim(t),
    });
    list.onSelect = (item) => this.onPick(item.value);
    list.onCancel = () => this.onCancel();
    return list;
  }

  handleInput(data: string): void {
    // Navigation/selection keys go to the list; everything else edits the filter.
    if (
      matchesKey(data, Key.up) ||
      matchesKey(data, Key.down) ||
      matchesKey(data, Key.enter) ||
      matchesKey(data, Key.escape)
    ) {
      this.list.handleInput(data);
      return;
    }
    this.input.handleInput(data);
    const query = this.input.getValue();
    if (query !== this.query) {
      this.query = query;
      const next = this.makeList(fuzzyFilter(this.files, query, (f) => f.label));
      const i = this.container.children.indexOf(this.list);
      this.container.children[i === -1 ? 2 : i] = next;
      this.list = next;
    }
  }

  render(width: number): string[] {
    return this.container.render(width);
  }

  invalidate(): void {
    this.container.invalidate();
  }
}
