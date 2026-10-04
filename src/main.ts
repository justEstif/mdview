#!/usr/bin/env bun
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  ProcessTerminal,
  TuiAltScreen,
  type Component,
  type SelectItem,
  type TUI,
} from "@earendil-works/pi-tui";
import { Viewer, asViewport, type ViewerState } from "./viewer";
import { FilePicker } from "./picker";
import { loadConfig } from "./config";
import { applyPalette } from "./ui";

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
  applyPalette(cfg);

  const quit = () => tui.stop();

  // Gather files
  let files: string[] = [];
  let stdinContent: string | null = null;
  if (args.length === 0 && process.stdin.isTTY) {
    // No args in a TTY: browse cwd
    files = collectMarkdownFiles(process.cwd());
    if (files.length === 0) {
      console.error("mdview: no markdown files found in current directory");
      process.exit(1);
    }
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

  let viewer: Viewer | null = null;

  const showViewer = (startFile?: string) => {
    if (startFile !== undefined) {
      const idx = state.files.indexOf(startFile);
      if (idx >= 0) state.index = idx;
    }
    viewer = new Viewer({ tui, state, cfg, onQuit: quit, onOpenFile: showPicker });
    tui.setLayoutRoot(viewer.layoutRoot);
    tui.setFocus(viewer);
    tui.scrollToTop();
    tui.requestRender();
  };

  const showPicker = (_current?: string) => {
    const items: SelectItem[] = state.files.map((f) => ({
      value: f,
      label: f,
    }));
    const picker = new FilePicker({
      tui,
      files: items,
      position: cfg.pickerPosition,
      onPick: (value) => showViewer(value),
      onCancel: () => (viewer ? showViewer() : quit()),
    });
    tui.setLayoutRoot(picker);
    tui.setFocus(picker);
    tui.scrollToTop();
    tui.requestRender();
  };

  // Start with the picker when browsing a directory; viewer otherwise
  if (stdinContent === null && args.length > 0 && statSync(resolve(args[0]!)).isDirectory()) {
    showPicker();
  } else if (stdinContent === null && args.length === 0 && files.length > 1) {
    showPicker();
  } else {
    showViewer();
  }

  tui.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
