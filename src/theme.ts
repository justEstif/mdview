import type { MarkdownTheme } from "@earendil-works/pi-tui";
import { render, toAnsi, DEFAULT_THEME } from "grok-mermaid";

// ANSI 256-color markdown theme (works on light and dark terminals)
const fg = (code: number) => (s: string) => `\x1b[38;5;${code}m${s}\x1b[39m`;
const style = (...codes: string[]) => (s: string) => `\x1b[${codes.join(";")}m${s}\x1b[0m`;

export const markdownTheme: MarkdownTheme = {
  heading: fg(75), // bright blue
  link: fg(110), // soft cyan-blue
  linkUrl: fg(245), // gray
  code: fg(214), // orange for inline code
  codeBlock: (s) => s,
  codeBlockBorder: fg(240),
  quote: fg(102), // gray-green
  quoteBorder: fg(60),
  hr: fg(238),
  listBullet: fg(208), // orange bullet
  bold: style("1"),
  italic: style("3"),
  strikethrough: style("9"),
  underline: style("4"),
  // Render mermaid blocks as Unicode box-drawing diagrams (same approach as pi).
  // Unsupported/invalid diagrams fall back to pi-tui's default code block.
  highlightCode: (code: string, lang?: string): string[] => {
    if (lang !== "mermaid") return code.split("\n").map(markdownTheme.codeBlock);
    const art = render(code);
    if (!art) return code.split("\n").map(markdownTheme.codeBlock);
    return toAnsi(art, DEFAULT_THEME);
  },
};
