import { styleText } from "node:util";
import { truncateToWidth } from "@earendil-works/pi-tui";

/** Shared mdview palette + box drawing. One place for all UI styling. */

export const ui = {
  accent: (s: string) => styleText("blueBright", s),
  dim: (s: string) => styleText("gray", s),
  border: (s: string) => `\x1b[38;5;240m${s}\x1b[39m`,
  fg: (code: number) => (s: string) => `\x1b[38;5;${code}m${s}\x1b[39m`,
};

/** Apply palette overrides from config (ANSI 256 codes). */
export function applyPalette(opts: { accentColor?: number; dimColor?: number }): void {
  if (opts.accentColor !== undefined) ui.accent = ui.fg(opts.accentColor);
  if (opts.dimColor !== undefined) ui.dim = ui.fg(opts.dimColor);
}

/** Visible width of a string (ANSI escapes stripped). */
export const visibleWidth = (s: string): number =>
  s.replace(/\x1b\[[0-9;]*m/g, "").length;

/** Clip a styled string to a visible width, keeping escape codes intact. */
export const clip = (s: string, w: number): string => {
  const vis = visibleWidth(s);
  return vis > w ? s.slice(0, Math.max(0, s.length - (vis - w))) : s;
};

/** Render a bordered box around rows of already-styled content.
 *  Rows are padded/aligned to the widest row. */
export function box(rows: string[]): string[] {
  const w = Math.max(...rows.map(visibleWidth));
  const top = ui.border("┌" + "─".repeat(w) + "┐");
  const bottom = ui.border("└" + "─".repeat(w) + "┘");
  const middle = rows.map((r) => ui.border("│") + r + " ".repeat(w - visibleWidth(r)) + ui.border("│"));
  return [top, ...middle, bottom];
}

export type OverlayPosition = "topRight" | "bottomRight" | "bottom" | "center";

/** Overlay `boxLines` onto rendered screen lines at `position`.
 *  `reserveBottom` lines at the bottom (e.g. status bar) are kept visible. */
export function overlayAt(
  lines: string[],
  boxLines: string[],
  position: OverlayPosition,
  reserveBottom = 0,
): string[] {
  const height = lines.length;
  const boxH = boxLines.length;
  const boxW = visibleWidth(boxLines[0] ?? "");

  let startRow: number;
  let leftPad: (base: string) => string;
  const cutLeft = (base: string) => {
    const target = Math.max(0, visibleWidth(base) - boxW);
    return truncateToWidth(base, target);
  };
  const centerBase = (base: string) => {
    const w = visibleWidth(base);
    const pad = Math.max(0, Math.floor((w - boxW) / 2));
    return truncateToWidth(base, pad) + " ".repeat(Math.max(0, pad - w));
  };

  switch (position) {
    case "topRight":
      startRow = 0;
      leftPad = cutLeft;
      break;
    case "bottomRight":
      startRow = Math.max(0, height - reserveBottom - boxH);
      leftPad = cutLeft;
      break;
    case "bottom":
      startRow = Math.max(0, height - reserveBottom - boxH);
      leftPad = centerBase;
      break;
    case "center":
      startRow = Math.max(0, Math.floor((height - boxH) / 2));
      leftPad = centerBase;
      break;
  }

  const out = [...lines];
  for (let i = 0; i < boxH; i++) {
    const row = startRow + i;
    if (row < 0 || row >= height) continue;
    out[row] = leftPad(out[row]!) + boxLines[i]!;
  }
  return out;
}
