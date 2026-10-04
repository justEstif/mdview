import { homedir } from "node:os";
import { join } from "node:path";
import defaultsJson from "./config.default.json" with { type: "json" };

const defaults = defaultsJson as Required<
  Pick<MdviewConfig, "center" | "paddingX" | "paddingY" | "statusBar">
>;

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
  /** Palette overrides for ui.accent / ui.dim colors (ANSI 256 codes) */
  accentColor?: number;
  dimColor?: number;
}

const CONFIG_PATH = join(homedir(), ".config", "mdview", "config.json");

export async function loadConfig(): Promise<MdviewConfig> {
  try {
    const raw: unknown = Bun.JSON5.parse(await Bun.file(CONFIG_PATH).text());
    return { ...defaults, ...(raw as Partial<MdviewConfig>) };
  } catch {
    return { ...defaults };
  }
}
