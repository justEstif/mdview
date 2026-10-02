import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface MdviewConfig {
  /** Max rendered content width (glow: width). Content is centered when narrower. */
  maxWidth?: number;
  /** Center content horizontally when maxWidth is set (default: true) */
  center?: boolean;
  /** Horizontal padding in cells (glow: margins) */
  paddingX?: number;
  /** Vertical padding in lines */
  paddingY?: number;
  /** Show the status bar (default: true) */
  statusBar?: boolean;
}

const CONFIG_PATH = join(homedir(), ".config", "mdview", "config.json");

export function loadConfig(): MdviewConfig {
  const defaults: Required<Pick<MdviewConfig, "center" | "paddingX" | "paddingY" | "statusBar">> = {
    center: true,
    paddingX: 1,
    paddingY: 1,
    statusBar: true,
  };
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return { ...defaults, ...raw };
  } catch {
    return { ...defaults };
  }
}
