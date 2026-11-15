/**
 * Pure anchor resolution for internal document links (issue #6).
 *
 * Two anchor kinds are supported, both mapped to an index into the
 * viewer's rendered plain lines (what `ScrollView.scrollTo` targets):
 *
 *  1. Explicit HTML anchors — `<a id="...">` — detected on the rendered
 *     lines, since the markdown renderer passes raw inline HTML through.
 *  2. GitHub-style heading slugs — raw `## Some Heading` lines slugified
 *     (`githubSlug`) and located on the rendered lines the same way the
 *     TOC scan does. Duplicate headings get the `-1`, `-2`, ... suffix.
 *
 * No fuzzy text fallback: an anchor is either in the map or it is not.
 */

const ANCHOR_ID_RE = /<a\s[^>]*\bid\s*=\s*["']([^"']+)["']/gi;
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/;

/** GitHub-style heading slug: lowercase, drop punctuation, spaces to hyphens. */
export function githubSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

/** First occurrence wins; later collisions get GitHub's `-1`, `-2` suffix. */
function put(map: Map<string, number>, slug: string, line: number): void {
  if (!slug) return;
  let key = slug;
  let n = 0;
  while (map.has(key)) key = `${slug}-${++n}`;
  map.set(key, line);
}

/**
 * Build anchor id → rendered-line index.
 *
 * @param rawLines      the raw markdown source lines
 * @param renderedPlain the rendered lines with styling stripped (Viewer.renderedPlain)
 */
export function buildAnchorMap(rawLines: string[], renderedPlain: string[]): Map<string, number> {
  const map = new Map<string, number>();

  ANCHOR_ID_RE.lastIndex = 0;
  for (let i = 0; i < renderedPlain.length; i++) {
    for (const m of renderedPlain[i]!.matchAll(ANCHOR_ID_RE)) put(map, m[1]!, i);
  }

  let from = 0;
  for (const line of rawLines) {
    const m = line.match(HEADING_RE);
    if (!m) continue;
    const title = m[2]!.replace(/[`*_[\]]/g, "").trim();
    if (!title) continue;
    // Require an exact heading line: a rendered heading is the styled title
    // alone on its line, whereas link text with the same words appears inside
    // a sentence (`See [Intro](#intro) below.` renders as "See Intro below.").
    const idx = renderedPlain.findIndex((l, i) => i >= from && l.trim() === title);
    if (idx < 0) continue;
    put(map, githubSlug(title), idx);
    from = idx + 1;
  }
  return map;
}
