/**
 * Finds image URLs in a README without parsing it into a tree, so every
 * position maps back to the original text and nothing else is rewritten.
 *
 * Image URLs are looked for where a README can put one: Markdown image
 * syntax, the `src` and `srcset` of `<img>`, the `srcset` of `<source>`, and
 * reference-style definitions. Fenced code, inline code and HTML comments are
 * skipped: a URL there is an example or a card someone switched off.
 */

export type UrlContext = "markdown" | "html" | "srcset" | "reference";

export interface FoundUrl {
  /** Offset of the first character of the URL in the text. */
  start: number;
  /** Offset just past the URL. */
  end: number;
  /** The URL exactly as written. */
  raw: string;
  context: UrlContext;
  /** `light` or `dark` when a `<source media>` asks for one colour scheme. */
  mode?: "light" | "dark";
}

type Range = readonly [number, number];

/** Ranges of fenced code blocks, by line. An unclosed fence runs to the end. */
function fencedRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const lines = /[^\n]*(?:\n|$)/g;
  let open: { char: string; size: number; start: number } | null = null;
  for (let match = lines.exec(text); match; match = lines.exec(text)) {
    if (match[0] === "") break;
    const line = match[0];
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/\r?\n$/, ""));
    if (!open) {
      // A backtick fence's info string may not contain a backtick.
      if (fence?.[1] && !(fence[1][0] === "`" && fence[2]?.includes("`"))) {
        open = {
          char: fence[1][0] ?? "`",
          size: fence[1].length,
          start: match.index,
        };
      }
    } else if (
      fence?.[1] &&
      fence[1][0] === open.char &&
      fence[1].length >= open.size &&
      fence[2]?.trim() === ""
    ) {
      ranges.push([open.start, match.index + line.length]);
      open = null;
    }
  }
  if (open) ranges.push([open.start, text.length]);
  return ranges;
}

function inside(ranges: readonly Range[], at: number): boolean {
  return ranges.some(([start, end]) => at >= start && at < end);
}

/** Inline code spans and HTML comments outside the fenced blocks. */
function inlineRanges(text: string, fenced: readonly Range[]): Range[] {
  const ranges: Range[] = [];
  const comments = /<!--[\s\S]*?(?:-->|$)/g;
  for (let m = comments.exec(text); m; m = comments.exec(text)) {
    if (!inside(fenced, m.index)) ranges.push([m.index, m.index + m[0].length]);
    if (m[0].length === 0) break;
  }
  const runs = /`+/g;
  for (let m = runs.exec(text); m; m = runs.exec(text)) {
    if (inside(fenced, m.index) || inside(ranges, m.index)) continue;
    const ticks = m[0];
    // The closing run has exactly as many backticks and comes before a blank line.
    const closing = new RegExp(`(?<!\`)${ticks}(?!\`)`, "g");
    closing.lastIndex = m.index + ticks.length;
    const close = closing.exec(text);
    if (!close) continue;
    const between = text.slice(m.index + ticks.length, close.index);
    if (/\n[ \t]*\n/.test(between)) continue;
    ranges.push([m.index, close.index + ticks.length]);
    runs.lastIndex = close.index + ticks.length;
  }
  return ranges;
}

// ![alt](destination "title"): alt may hold one level of brackets, the
// destination is either <...> or a run without spaces and unbalanced parens.
const MARKDOWN_IMAGE =
  /!\[(?:[^[\]\\]|\\.|\[(?:[^[\]\\]|\\.)*\])*\]\([ \t]*\n?[ \t]*(<[^<>\n]*>|(?:[^\s()<>\\]|\\.|\((?:[^\s()\\]|\\.)*\))+)/g;
// [label]: destination, at the start of a line.
const REFERENCE =
  /^ {0,3}\[(?:[^[\]\\]|\\.)+\]:[ \t]*\n?[ \t]*(<[^<>\n]*>|\S+)/gm;
// An <img> or <source> tag, attributes allowed to span lines and to hold ">"
// inside quotes.
const TAG = /<(img|source)\b((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/gi;
// Unquoted values may hold "=" (browsers accept it, and URLs need it).
const ATTRIBUTE =
  /([^\s"'=<>/]+)(?:[ \t\r\n]*=[ \t\r\n]*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;

function destination(
  found: FoundUrl[],
  whole: RegExpExecArray,
  value: string,
  context: UrlContext,
): void {
  const at = whole.index + whole[0].length - value.length;
  const angled = value.startsWith("<");
  const raw = angled ? value.slice(1, -1) : value;
  const start = angled ? at + 1 : at;
  found.push({ start, end: start + raw.length, raw, context });
}

/** Candidates of a `srcset` value: "url 2x, url 1x". URLs may contain commas. */
function srcset(
  value: string,
  offset: number,
  mode: FoundUrl["mode"],
): FoundUrl[] {
  const found: FoundUrl[] = [];
  let i = 0;
  while (i < value.length) {
    while (i < value.length && /[\s,]/.test(value[i] ?? "")) i++;
    const start = i;
    while (i < value.length && !/\s/.test(value[i] ?? "")) i++;
    let end = i;
    let url = value.slice(start, end);
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
      end = start + url.length;
    } else {
      // Skip the descriptor up to the next comma.
      while (i < value.length && value[i] !== ",") i++;
    }
    if (url) {
      found.push({
        start: offset + start,
        end: offset + end,
        raw: url,
        context: "srcset",
        mode,
      });
    }
  }
  return found;
}

function tags(text: string, found: FoundUrl[]): void {
  for (let tag = TAG.exec(text); tag; tag = TAG.exec(text)) {
    const name = (tag[1] ?? "").toLowerCase();
    const body = tag[2] ?? "";
    const bodyStart = tag.index + 1 + (tag[1] ?? "").length;
    const attributes: { name: string; value: string; at: number }[] = [];
    ATTRIBUTE.lastIndex = 0;
    for (let a = ATTRIBUTE.exec(body); a; a = ATTRIBUTE.exec(body)) {
      const value = a[2] ?? a[3] ?? a[4];
      if (value === undefined) continue;
      // Offset of the value: after the opening quote when there is one.
      const quoted = a[4] === undefined ? 1 : 0;
      const at = bodyStart + a.index + a[0].length - value.length - quoted;
      attributes.push({ name: (a[1] ?? "").toLowerCase(), value, at });
    }
    const media = attributes.find((a) => a.name === "media")?.value ?? "";
    const scheme = /prefers-color-scheme\s*:\s*(light|dark)/i.exec(media)?.[1];
    const mode = scheme?.toLowerCase() as FoundUrl["mode"];
    for (const attribute of attributes) {
      if (attribute.name === "src" && name === "img") {
        const raw = attribute.value.trim();
        const lead = attribute.value.indexOf(raw);
        const start = attribute.at + lead;
        found.push({ start, end: start + raw.length, raw, context: "html" });
      } else if (attribute.name === "srcset") {
        found.push(...srcset(attribute.value, attribute.at, mode));
      }
    }
  }
}

/** Every image URL in `text`, in order of position. */
export function findImageUrls(text: string): FoundUrl[] {
  const fenced = fencedRanges(text);
  const skipped = [...fenced, ...inlineRanges(text, fenced)];
  const found: FoundUrl[] = [];
  for (const [pattern, context] of [
    [MARKDOWN_IMAGE, "markdown"],
    [REFERENCE, "reference"],
  ] as const) {
    pattern.lastIndex = 0;
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      if (m[1]) destination(found, m, m[1], context);
    }
  }
  TAG.lastIndex = 0;
  tags(text, found);

  const seen = new Set<number>();
  return found
    .filter((url) => !inside(skipped, url.start))
    .sort((a, b) => a.start - b.start)
    .filter((url) => {
      if (seen.has(url.start)) return false;
      seen.add(url.start);
      return true;
    });
}
