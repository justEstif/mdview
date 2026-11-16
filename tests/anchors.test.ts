import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Markdown, type Component } from "@earendil-works/pi-tui";
import { markdownTheme } from "../src/theme";
import { buildAnchorMap, githubSlug } from "../src/anchors";
import { AnchoredScrollView } from "../src/viewer";

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

  test("heading slug resolves to the exact rendered heading line", () => {
    const line = map.get("sources");
    expect(line).toBeDefined();
    expect(line).toBe(plain.findIndex((l) => l.trim() === "Sources"));
    expect(plain[line!]!.trim()).toBe("Sources");
  });

  test("link text equal to a heading title does not shadow the heading", () => {
    const doc = "# Top\nSee [Intro](#intro) below.\n# Intro";
    const plain2 = renderedPlain(doc);
    const map2 = buildAnchorMap(doc.split("\n"), plain2);
    const line = map2.get("intro");
    expect(line).toBeDefined();
    expect(line).toBe(plain2.findIndex((l) => l.trim() === "Intro"));
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

describe("buildAnchorMap edge cases", () => {
  test("CRLF sources still produce heading anchors", () => {
    const doc = "# Top\r\n\r\n## Sources\r\n\r\nText\r\n";
    const plain = renderedPlain(doc.replace(/\r/g, ""));
    const map = buildAnchorMap(doc.split("\n"), plain);
    expect(map.has("top")).toBe(true);
    expect(map.has("sources")).toBe(true);
  });

  test("standalone link line equal to heading title does not shadow the heading", () => {
    const doc = "# Top\n[Intro](#intro)\n\n# Intro";
    const styled = new Markdown(doc, 1, 1, markdownTheme).render(80);
    const strip = (l: string) =>
      l.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
    const plain = styled.map(strip);
    const map = buildAnchorMap(doc.split("\n"), plain, styled);
    const line = map.get("intro");
    expect(line).toBeDefined();
    // The heading is the LAST "Intro" line; the link line comes first.
    const lastIntro = plain.reduce((acc, l, i) => (l.trim() === "Intro" ? i : acc), -1);
    expect(line).toBe(lastIntro);
    expect(line).toBeGreaterThan(0);
  });
});

describe("AnchoredScrollView", () => {
  const lines = (n: number): Component => ({
    render: () => Array.from({ length: n }, () => "x"),
    invalidate: () => {},
  });

  test("pending jump applies after updateLayout refreshes content height", () => {
    const sv = new AnchoredScrollView(lines(200), { primary: true, follow: "none" });
    // Old short file: 5 content lines, 10-line viewport.
    sv.updateLayout(5, 10, () => {});
    // showFile() -> scrollToStart + jump attempt against stale bounds.
    sv.scrollToStart();
    sv.pendingJump = 50;
    sv.scrollTo(50); // clamps to 0 against stale contentHeight
    expect(sv.scrollTop).toBe(0);
    // Next layout pass with the long file's real height applies the jump.
    sv.updateLayout(200, 10, () => {});
    expect(sv.scrollTop).toBe(50);
    expect(sv.pendingJump).toBeNull();
  });

  test("no pending jump leaves scroll position alone in layout", () => {
    const sv = new AnchoredScrollView(lines(200), { primary: true, follow: "none" });
    sv.updateLayout(200, 10, () => {});
    sv.scrollBy(7);
    sv.updateLayout(200, 10, () => {});
    expect(sv.scrollTop).toBe(7);
  });
});
