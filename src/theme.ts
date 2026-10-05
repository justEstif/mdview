import type { MarkdownTheme } from "@earendil-works/pi-tui";
import { render, toAnsi, DEFAULT_THEME } from "grok-mermaid";

// Default theme: Dracula (https://draculatheme.com) mapped to ANSI 256.
// purple 141 · cyan 117 · green 84 · orange 215 · pink 213 · yellow 228 ·
// comment 61 · current-line 236 · foreground 231
const fg = (code: number) => (s: string) => `\x1b[38;5;${code}m${s}\x1b[39m`;
const style = (...codes: string[]) => (s: string) => `\x1b[${codes.join(";")}m${s}\x1b[0m`;
const chip = (s: string) => `\x1b[48;5;236m\x1b[38;5;215m${s}\x1b[0m`;

export const markdownTheme: MarkdownTheme = {
  heading: (s) => style("1")(fg(141)(s)), // bold purple
  link: fg(117), // cyan
  linkUrl: fg(61), // comment
  code: chip, // orange on current-line background
  codeBlock: (s) => s,
  codeBlockBorder: fg(61),
  quote: fg(246), // light gray, readable
  quoteBorder: fg(141), // purple
  hr: fg(61),
  listBullet: fg(213), // pink
  bold: style("1"),
  italic: style("3"),
  strikethrough: style("9"),
  underline: style("4"),
  // Render mermaid blocks as Unicode box-drawing diagrams (same approach as pi).
  // Unsupported/invalid diagrams fall back to plain code block text.
  highlightCode: (code: string, lang?: string): string[] => {
    if (lang !== "mermaid") return code.split("\n").map((l) => l);
    const art = render(code);
    if (!art) return code.split("\n").map((l) => l);
    return toAnsi(art, DEFAULT_THEME);
  },
};
