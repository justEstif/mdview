# mdview

A fast markdown terminal viewer built with
[@earendil-works/pi-tui](https://github.com/earendil-works/pi-mono/tree/main/packages/tui).
A lean, keyboard-driven alternative to [glow](https://github.com/charmbracelet/glow).

## Usage

```sh
mdview README.md     # view a file
mdview docs/         # browse a directory (fuzzy picker)
cat notes.md | mdview  # read from stdin
mdview               # no args in a TTY: browse cwd
```

Install from a release binary (linux/darwin, x64/arm64) or from source with Bun:

```sh
bun install -g .
```

## mdview vs glow

|                    | mdview                      | glow                       |
| ------------------ | --------------------------- | -------------------------- |
| Runtime            | Bun (single-file compile)   | Go binary                  |
| Size               | ~1k LoC, no styling deps    | large, bubbles/charm stack |
| Images in terminal | kitty/iterm2 inline         | none                       |
| Mermaid diagrams   | rendered as box-drawing art | not rendered               |
| File picker        | built-in fuzzy filter       | via `glow` + fzf manually  |
| Keymap reference   | `?` overlay, configurable   | none                       |
| Config format      | JSON5 with comments         | YAML                       |
| Word wrap / paging | pi-tui alt screen           | gum/style                  |
| Themes             | ANSI 256, palette overrides | built-in + custom styles   |

## Keys

| Key                          | Action                                |
| ---------------------------- | ------------------------------------- |
| `j`/`k`, arrows, mouse wheel | scroll                                |
| `d`/`u`, PgDn-ish            | scroll 10 lines                       |
| space                        | scroll 20 lines                       |
| `gg` / `G`                   | top / bottom                          |
| `h`/`l`, `n`/`p`             | prev / next file                      |
| `/`                          | search (built into pi-tui alt screen) |
| `o`                          | open file picker                      |
| `q`, `Esc`, `Ctrl+C`         | quit                                  |

## Images

Standalone image lines are rendered inline via the terminal's graphics protocol
(kitty graphics or iTerm2, auto-detected — Ghostty, kitty, WezTerm, Warp, etc.):

```markdown
![alt text](path/to/image.png)
```

- Paths resolve relative to the markdown file.
- Supports png, jpg, gif, webp, bmp, svg.
- Terminals without graphics support (or missing files) fall back to the alt text.

## Configuration

`~/.config/mdview/config.json` — JSON5, so comments and unquoted keys work (all keys optional, defaults in [`src/config.default.json`](src/config.default.json)):

```json5
{
  // "maxWidth": 100,
  // "center": true,
  // "paddingX": 1,
  // "paddingY": 1,
  // "statusBar": true,
  // "accentColor": 75,
  // "dimColor": 245,
}
```

- `accentColor` / `dimColor`: ANSI 256 codes overriding the picker/help palette.

The file picker is always centered; the `?` keymap box is always bottom-left.

## Status

v0.2.0: files, directory browsing with fuzzy picker, stdin, inline images,
mermaid rendering, pinned status bar, `?` keymap overlay, JSON5 config.

Ideas for later: GitHub URL fetching, TOC jump (`t`), light/dark theme
detection via OSC 11, `imageMaxWidthCells` config.
