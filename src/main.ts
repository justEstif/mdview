#!/usr/bin/env bun
import { readdirSync, readFileSync, statSync, watch } from "node:fs";
import { resolve } from "node:path";
import {
  ProcessTerminal,
  TuiAltScreen,
  type Component,
  type OverlayOptions,
  type SelectItem,
  type TUI,
} from "@earendil-works/pi-tui";
import { Viewer, asViewport, type ViewerState } from "./viewer";
import { BarStack, fuzzyRows } from "./barstack";
import { loadConfig } from "./config";
import { applyPalette, applyScheme } from "./ui";
import { setMarkdownScheme } from "./theme";

const MD_EXT = /\.(md|markdown|mdx)$/i;

function collectMarkdownFiles(target: string): string[] {
  const st = statSync(target);
  if (st.isFile()) return [target];
  // Directory: recursive scan for markdown files
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (MD_EXT.test(entry.name)) out.push(full);
    }
  };
  walk(target);
  return out;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("-h") || args.includes("--help")) {
    console.log(`mdview — markdown viewer

Usage:
  mdview <file.md>          view one or more markdown files
  mdview <dir>              browse a directory for markdown files
  cat foo.md | mdview       read markdown from stdin`);
    process.exit(0);
  }

  const terminal = new ProcessTerminal();
  const tui = asViewport(new TuiAltScreen(terminal));

  const cfg = await loadConfig();

  // Detect the terminal's background color (OSC 11) once and pick a readable
  // palette. Explicit config colors win: applyPalette runs after detection.
  try {
    const colors = await tui.queryTerminalColors({ timeoutMs: 200 });
    const bg = colors.background;
    if (bg) {
      const luma = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b;
      const scheme = luma > 128 ? "light" : "dark";
      applyScheme(scheme);
      setMarkdownScheme(scheme);
    }
  } catch {
    // Terminal didn't answer; keep the dark defaults.
  }
  applyPalette(cfg);

  const quit = () => tui.stop();

  // Gather files
  let files: string[] = [];
  let stdinContent: string | null = null;
  if (args.length === 0 && process.stdin.isTTY) {
    // No args in a TTY: browse cwd. Zero files still opens the picker
    // (in-TUI empty state) instead of exiting.
    files = collectMarkdownFiles(process.cwd());
  } else {
    const paths = args.filter((a) => !a.startsWith("-"));
    if (paths.length === 0) {
      stdinContent = await readStdin();
    } else {
      try {
        files = paths.flatMap((p) => collectMarkdownFiles(resolve(p)));
      } catch (err) {
        console.error(`mdview: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
      if (files.length === 0) {
        console.error("mdview: no markdown files found");
        process.exit(1);
      }
    }
  }

  const state: ViewerState = {
    files,
    index: 0,
    contents: new Map(),
  };
  for (const f of files) state.contents.set(f, readFileSync(f, "utf8"));
  if (stdinContent !== null) {
    state.files = ["(stdin)"];
    state.index = 0;
    state.contents.set("(stdin)", stdinContent);
  }

  // No args in a TTY: full-screen picker as the layout root; the viewer
  // swaps in once a file is picked. Zero files opens the empty state.
  const startPicker = stdinContent === null && args.length === 0;
  const barPicker = (files: string[], onPick: (f: string) => void, onCancel: () => void, fullscreen: boolean) =>
    new BarStack({
      prefix: fullscreen ? "/" : "o",
      placeholder: "search…",
      maxRows: fullscreen ? Math.max(1, terminal.rows - 3) : 8,
      ...(fullscreen ? { fillHeight: () => terminal.rows } : {}),
      emptyRows: () => [
        "",
        "no markdown files in this directory",
        "",
        "try a docs folder, a file argument",
        "\u0028mdview notes.md\u0029, or pipe \u0028cat x.md | mdview\u0029",
      ],
      source: (query) =>
        fuzzyRows(files, query, (f) => f).map((r) => ({
          value: r.value,
          label: r.label.replace(process.cwd() + "/", ""),
        })),
      onPick,
      onCancel,
      hint: (n, q) =>
        !q
          ? "enter open · esc quit"
          : `${n} ${n === 1 ? "file" : "files"} · enter open · esc ${fullscreen ? "quit" : "back"}`,
    });

  if (startPicker && files.length === 0) {
    const empty = barPicker([], () => {}, quit, true);
    tui.setLayoutRoot(empty);
    tui.setFocus(empty);
    tui.start();
    return;
  }

  let viewer: Viewer;
  let pickerOverlay: ReturnType<typeof tui.showOverlay> | null = null;

  const hidePicker = () => {
    pickerOverlay?.hide();
    pickerOverlay = null;
  };

  const showViewer = (startFile?: string) => {
    if (startFile !== undefined) {
      const idx = state.files.indexOf(startFile);
      if (idx >= 0) viewer.showFile(idx);
    }
    tui.setFocus(viewer);
    tui.requestRender();
  };

  const showPicker = () => {
    hidePicker();
    const picker = barPicker(
      state.files,
      (value) => {
        hidePicker();
        showViewer(value);
      },
      () => {
        hidePicker();
        showViewer();
      },
      false,
    );
    pickerOverlay = tui.showOverlay(picker, { anchor: "bottom-left" });
  };

  const onEdit = async (file: string) => {
    const editor = cfg.editor ?? process.env.EDITOR ?? "vi";
    tui.stop();
    try {
      await Bun.spawn([editor, file], { stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exited;
    } catch {
      // Editor failed to launch; restarting the TUI still restores the view.
    }
    try {
      state.contents.set(file, readFileSync(file, "utf8"));
    } catch {
      // keep the previous content
    }
    viewer.reload();
    tui.start();
  };

  viewer = new Viewer({ tui, state, cfg, onQuit: quit, onOpenFile: showPicker, onEdit });
  tui.setFocus(viewer);

  // Watch mode: reload the viewed file when it changes on disk.
  // 120 ms debounce absorbs editor save bursts (atomic rename etc.).
  const reloadTimers = new Map<string, Timer>();
  for (const f of state.files) {
    if (f === "(stdin)") continue;
    watch(f, { persistent: false }, () => {
      const pending = reloadTimers.get(f);
      if (pending) clearTimeout(pending);
      reloadTimers.set(
        f,
        setTimeout(() => {
          reloadTimers.delete(f);
          try {
            state.contents.set(f, readFileSync(f, "utf8"));
          } catch {
            return; // file vanished mid-write; keep showing the last version
          }
          if (state.files[state.index] === f) viewer.reload();
        }, 120),
      );
    });
  }

  if (startPicker) {
    const picker = barPicker(
      state.files,
      (value) => {
        tui.setLayoutRoot(viewer.layoutRoot);
        showViewer(value);
      },
      quit,
      true,
    );
    tui.setLayoutRoot(picker);
    tui.setFocus(picker);
  } else {
    tui.setLayoutRoot(viewer.layoutRoot);
  }

  // Start with the overlay picker when viewing a directory argument
  if (stdinContent === null && args.length > 0 && statSync(resolve(args[0]!)).isDirectory()) {
    showPicker();
  }

  tui.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
