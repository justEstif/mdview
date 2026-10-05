import { Key, matchesKey, type Component } from "@earendil-works/pi-tui";
import { Input } from "@earendil-works/pi-tui/dist/components/input";
import { clip, visibleWidth } from "./ui";

/** One row above the bar. */
export interface BarItem {
  value: string;
  /** Plain label; fuzzy-highlighted by BarStack when `styled` is absent. */
  label: string;
  /** Right-aligned dim text (line number, file count, …). */
  description?: string;
  /** Pre-styled label (search rows); used as-is. */
  styled?: string;
}

export interface BarStackOpts {
  /** Prefix on the bar input, e.g. "/" or "o". */
  prefix: string;
  placeholder?: string;
  /** Rows visible above the bar (default 8). */
  maxRows?: number;
  /** Pad blank lines above so the bar sits on the terminal's last row. */
  fillHeight?: () => number;
  /** Shown when `source` yields nothing (empty directory). */
  emptyRows?: (query: string) => string[];
  /** Filtered rows for the current query. */
  source: (query: string) => BarItem[];
  onPick: (value: string) => void;
  onCancel: () => void;
  /** Right side of the bar line; receives the total row count and query. */
  hint?: (count: number, query: string) => string;
}

/** Highlight matched fuzzy chars (Dracula pink). */
const hl = (s: string) => `\x1b[38;5;213m${s}\x1b[39m`;

function fuzzyStyled(text: string, query: string): string | null {
  if (!query) return text;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  const hits: number[] = [];
  let j = 0;
  for (let i = 0; i < t.length && j < q.length; i++) {
    if (t[i] === q[j]) {
      hits.push(i);
      j++;
    }
  }
  if (j < q.length) return null;
  let out = "";
  let prev = 0;
  for (const h of hits) {
    out += text.slice(prev, h) + hl(text[h]!);
    prev = h + 1;
  }
  return out + text.slice(prev);
}

/** Rows for fuzzy-filtered items (picker mode): filter + labels, BarStack highlights. */
export function fuzzyRows<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
): { value: T; label: string }[] {
  return items
    .filter((item) => fuzzyStyled(getText(item), query) !== null)
    .map((item) => ({ value: item, label: getText(item) }));
}

/** Input on the bar, results stacked upward — the one UI for search and picker. */
export class BarStack implements Component {
  private input = new Input();
  private query = "";
  private sel = 0;
  private start = 0;
  private rows: BarItem[] = [];
  private readonly opts: BarStackOpts & { maxRows: number };

  constructor(opts: BarStackOpts) {
    this.opts = { ...opts, maxRows: opts.maxRows ?? 8 };
    this.refilter();
  }

  private refilter(): void {
    this.rows = this.opts.source(this.query);
    this.sel = Math.min(this.sel, Math.max(0, this.rows.length - 1));
    this.clampWindow();
  }

  private clampWindow(): void {
    if (this.sel < this.start) this.start = this.sel;
    else if (this.sel >= this.start + this.opts.maxRows) this.start = this.sel - this.opts.maxRows + 1;
    this.start = Math.max(0, Math.min(this.start, Math.max(0, this.rows.length - this.opts.maxRows)));
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.up) || matchesKey(data, "ctrl+p")) {
      this.sel = Math.max(0, this.sel - 1);
      this.clampWindow();
      return;
    }
    if (matchesKey(data, Key.down) || matchesKey(data, "ctrl+n")) {
      this.sel = Math.min(this.rows.length - 1, this.sel + 1);
      this.clampWindow();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const item = this.rows[this.sel];
      if (item) this.opts.onPick(item.value);
      return;
    }
    if (matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c")) {
      this.opts.onCancel();
      return;
    }
    this.input.handleInput(data);
    const query = this.input.getValue();
    if (query !== this.query) {
      this.query = query;
      this.sel = 0;
      this.start = 0;
      this.refilter();
    }
  }

  private barLine(width: number): string {
    const value = this.input.getValue();
    const left =
      value.length > 0
        ? ` ${this.opts.prefix} ${clip(this.input.render(Math.max(1, width - 4))[0] ?? "", width - 4)}`
        : ` ${this.opts.prefix} ${this.opts.placeholder ?? ""}`;
    const right = ` ${this.opts.hint?.(this.rows.length, this.query) ?? ""} `;
    const pad = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
    return (
      "\x1b[48;5;236m\x1b[38;5;250m" + clip(left + " ".repeat(pad) + right, width) + "\x1b[0m"
    );
  }

  render(width: number): string[] {
    const rows: BarItem[] = this.rows.length
      ? this.rows.slice(this.start, this.start + this.opts.maxRows)
      : (this.opts.emptyRows?.(this.query) ?? []).map((r): BarItem => ({ value: r, label: r, styled: ` ${r}` }));
    const lines: string[] = [];

    const fill = this.opts.fillHeight?.() ?? 0;
    const rowsSpace = Math.max(0, fill - 1);
    if (rows.length > rowsSpace && rowsSpace > 0) rows.length = rowsSpace;

    const shown = rows.map((item, i) => {
      const selected = this.start + i === this.sel;
      const label = item.styled ?? fuzzyStyled(item.label, this.query) ?? item.label;
      const desc = item.description ?? "";
      const marker = selected ? "▸ " : "  ";
      const body = ` ${marker}${label}`;
      const pad = Math.max(1, width - visibleWidth(body) - visibleWidth(desc) - (desc ? 1 : 0));
      const line = body + " ".repeat(pad) + (desc ? `\x1b[38;5;61m${desc}\x1b[39m` : "");
      return selected ? `\x1b[7m${clip(line, width)}\x1b[27m` : clip(line, width);
    });

    if (fill > 0) {
      const blanks = Math.max(0, fill - 1 - shown.length);
      lines.push(...Array.from({ length: blanks }, () => ""));
    }
    lines.push(...shown, this.barLine(width));
    return lines;
  }

  invalidate(): void {
    this.input.invalidate();
  }
}
