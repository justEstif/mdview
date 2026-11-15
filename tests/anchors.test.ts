import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Markdown } from "@earendil-works/pi-tui";
import { markdownTheme } from "../src/theme";
import { buildAnchorMap, githubSlug } from "../src/anchors";

const fixture = readFileSync(import.meta.dir + "/fixtures/anchor-links.md", "utf8");

/** Render like the viewer does, then strip escapes (see Viewer.renderedPlain). */
function renderedPlain(text: string): string[] {
  const strip = (l: string) =>
    l.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
  return new Markdown(text, 1, 1, markdownTheme).render(80).map(strip);
}

describe("githubSlug", () => {
  test("lowercases and hyphenates spaces", () => {
    expect(githubSlug("Sources")).toBe("sources");
    expect(githubSlug("Getting Started")).toBe("getting-started");
  });
  test("strips punctuation, keeps letters, digits, hyphens", () => {
    expect(githubSlug("What's New?")).toBe("whats-new");
    expect(githubSlug("A - B")).toBe("a---b");
  });
});

describe("buildAnchorMap", () => {
  const plain = renderedPlain(fixture);
  const map = buildAnchorMap(fixture.split("\n"), plain);

  test("heading slug resolves to the rendered heading line", () => {
    const line = map.get("sources");
    expect(line).toBeDefined();
    expect(plain[line!]).toContain("Sources");
  });

  test("duplicate headings get GitHub-style -1 suffix", () => {
    expect(map.has("whats-new")).toBe(true);
    expect(map.has("whats-new-1")).toBe(true);
  });

  test("explicit <a id=\"...\"> anchor resolves to its rendered line", () => {
    const line = map.get("explicit-target");
    expect(line).toBeDefined();
    expect(plain[line!]).toContain("explicit-target");
  });

  test("unknown anchors are absent", () => {
    expect(map.has("nope")).toBe(false);
  });
});
