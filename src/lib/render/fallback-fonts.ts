import { type BannerFont, baseCoverage } from "./fonts";
import { fontCoverage } from "./sfnt";

/**
 * Fallback fonts for text the vendored Mona Sans files cannot draw (CJK,
 * Cyrillic, Greek, Arabic, symbols, …).
 *
 * Google Fonts can return a font that holds exactly the requested glyphs
 * (`&text=`), typically 2-6 KB, so we fetch one tiny subset per script instead
 * of shipping megabytes of Noto. Text the base fonts cover never touches the
 * network.
 *
 * Google answers `&text=` with a font even when the family lacks some of the
 * characters, so every subset's character map is read back. A character its
 * first family lacks is asked of a few broad families next, and a character
 * no font covers at all is removed from the text before rendering: the
 * renderer would otherwise draw the `.notdef` glyph for it.
 *
 * Privacy note: the uncovered characters of the rendered text are sent to
 * fonts.googleapis.com in the query string. This is disclosed on /privacy.
 */

const TIMEOUT_MS = 2500;
const MAX_ENTRIES = 400;

type Subset = { data: ArrayBuffer; covers: ReadonlySet<number> };
const cache = new Map<string, Promise<Subset | null>>();

function remember(
  key: string,
  make: () => Promise<Subset>,
): Promise<Subset | null> {
  const hit = cache.get(key);
  if (hit) {
    // LRU bump
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const pending = make().catch(() => null);
  cache.set(key, pending);
  // Never keep a failure: the next render should try again.
  pending.then((value) => {
    if (value === null) cache.delete(key);
  });
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return pending;
}

function googleFontSubset(
  family: string,
  weight: 400 | 700,
  chars: string,
): Promise<Subset | null> {
  return remember(`${family}|${weight}|${chars}`, async () => {
    const api = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&text=${encodeURIComponent(chars)}`;
    const css = await (
      await fetch(api, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    ).text();
    const url = css.match(
      /src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/,
    )?.[1];
    if (!url?.startsWith("https://fonts.gstatic.com/")) {
      throw new Error(`no font url for ${family}`);
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`font ${res.status}`);
    const data = await res.arrayBuffer();
    return { data, covers: fontCoverage(data) };
  });
}

/**
 * Whether Takumi draws this grapheme as an emoji image (Twemoji) rather than
 * as text. Mirrors `extractEmojis` in `@takumi-rs/helpers/emoji`: a pictograph
 * is an emoji only with emoji presentation (its default, U+FE0F, a ZWJ
 * sequence or a skin tone). Text-default pictographs such as ❤ ♥ ✔ ⛓ 🖥
 * without U+FE0F are text and need a font.
 */
const PICTOGRAPH = /^\p{Extended_Pictographic}/u;
const EMOJI_PRESENTATION = /^\p{Emoji_Presentation}/u;
const MODIFIED = /^\p{Emoji_Modifier_Base}\p{Emoji_Modifier}/u;
const FLAG = /^\p{Regional_Indicator}{1,2}$/u;
const KEYCAP = /^[#*0-9]️?⃣$/u;

export function drawnAsEmoji(grapheme: string): boolean {
  if (grapheme.includes("︎")) return false;
  if (FLAG.test(grapheme) || KEYCAP.test(grapheme)) return true;
  return (
    PICTOGRAPH.test(grapheme) &&
    (grapheme.includes("️") ||
      grapheme.includes("‍") ||
      EMOJI_PRESENTATION.test(grapheme) ||
      MODIFIED.test(grapheme))
  );
}

/**
 * Characters that take no glyph: line breaks and tabs (layout) and default
 * ignorable code points (joiners, variation selectors, bidi controls), which
 * the shaper hides.
 */
const INVISIBLE = /[\t\n\r]|\p{Default_Ignorable_Code_Point}/u;

/**
 * Script → Noto family. Order matters: kana and hangul are matched before the
 * shared Han block, and Han goes to Noto Sans SC (asking the JP font for a
 * Simplified Chinese character returns a font without it).
 */
const SCRIPTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[぀-ヿㇰ-ㇿｦ-ﾟ]/u, "Noto Sans JP"],
  [/[가-힯ᄀ-ᇿ㄰-㆏]/u, "Noto Sans KR"],
  [/[⺀-⿟　-〿㐀-䶿一-鿿豈-﫿＀-￯]/u, "Noto Sans SC"],
  [/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/u, "Noto Sans Arabic"],
  [/[֐-׿]/u, "Noto Sans Hebrew"],
  [/[฀-๿]/u, "Noto Sans Thai"],
  [/[ऀ-ॿ]/u, "Noto Sans Devanagari"],
  [/[ঀ-৿]/u, "Noto Sans Bengali"],
  [/[஀-௿]/u, "Noto Sans Tamil"],
  [/[ఀ-౿]/u, "Noto Sans Telugu"],
  [/[ಀ-೿]/u, "Noto Sans Kannada"],
  [/[ഀ-ൿ]/u, "Noto Sans Malayalam"],
  [/[∀-⋿⟀-⟯⦀-⫿]/u, "Noto Sans Math"],
  [
    /[←-⇿⌀-⏿①-⓿─-➿⬀-⯿\u{1F000}-\u{1FAFF}]|\p{Extended_Pictographic}/u,
    "Noto Sans Symbols 2",
  ],
];

/** Greek, Cyrillic, Latin Extended-B, IPA and everything else. */
const DEFAULT_FAMILY = "Noto Sans";

/**
 * Asked, all at once, for whatever the first family did not cover. Between
 * them they hold most symbols and text-style pictographs.
 */
const RESCUE = [
  "Noto Sans",
  "Noto Sans Symbols 2",
  "Noto Sans Symbols",
  "Noto Sans Math",
  "Noto Emoji",
] as const;

/**
 * Controls, surrogates, unassigned and private-use code points: no font has a
 * dependable glyph for them.
 */
const NO_GLYPH = /\p{Cc}|\p{Cs}|\p{Cn}|\p{Co}/u;

/** Upper bound on distinct uncovered characters we will ask fonts for. */
const MAX_CHARS = 400;

function graphemes(text: string): string[] {
  return Array.from(
    new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text),
    ({ segment }) => segment,
  );
}

function familyFor(char: string): string {
  return SCRIPTS.find(([re]) => re.test(char))?.[1] ?? DEFAULT_FAMILY;
}

type Fetched = { family: string; fonts: BannerFont[]; covers: Set<number> };

async function fetchFamily(
  family: string,
  codePoints: Iterable<number>,
  weights: ReadonlyArray<400 | 700>,
): Promise<Fetched> {
  const chars = String.fromCodePoint(...[...codePoints].sort((a, b) => a - b));
  const subsets = await Promise.all(
    weights.map((weight) =>
      googleFontSubset(family, weight, chars).then((subset) =>
        subset ? { weight, subset } : null,
      ),
    ),
  );
  const fonts: BannerFont[] = [];
  const covers = new Set<number>();
  for (const entry of subsets) {
    if (!entry) continue;
    fonts.push({
      name: `fallback ${family}`,
      data: entry.subset.data,
      weight: entry.weight,
      style: "normal",
    });
    for (const cp of entry.subset.covers) covers.add(cp);
  }
  return { family, fonts, covers };
}

export type TextFonts = {
  /** Per-render fonts to pass to the renderer, in fallback order. */
  fonts: BannerFont[];
  /** Code points of the text that no font can draw. */
  missing: ReadonlySet<number>;
};

/**
 * Fonts for every character of `text` the base fonts cannot draw, and the
 * characters nothing can draw (see `drawableText`).
 * Pass all user-supplied strings of the banner (name, bio, descriptions…).
 * Resolves without any network access for text the base fonts cover, and
 * never rejects: a font that cannot be fetched only adds to `missing`.
 */
export async function fontsForText(
  text: string,
  weights: ReadonlyArray<400 | 700> = [400, 700],
): Promise<TextFonts> {
  const base = await baseCoverage();
  const missing = new Set<number>();
  const byFamily = new Map<string, Set<number>>();
  const seen = new Set<number>();
  let asked = 0;

  for (const grapheme of graphemes(text)) {
    if (drawnAsEmoji(grapheme)) continue;
    for (const char of grapheme) {
      const cp = char.codePointAt(0) ?? 0;
      if (seen.has(cp)) continue;
      seen.add(cp);
      if (base.has(cp) || INVISIBLE.test(char)) continue;
      if (NO_GLYPH.test(char) || ++asked > MAX_CHARS) {
        missing.add(cp);
        continue;
      }
      const family = familyFor(char);
      const set = byFamily.get(family);
      if (set) set.add(cp);
      else byFamily.set(family, new Set([cp]));
    }
  }
  if (byFamily.size === 0) return { fonts: [], missing };

  const first = await Promise.all(
    [...byFamily].map(([family, cps]) => fetchFamily(family, cps, weights)),
  );
  const fonts = first.flatMap((result) => result.fonts);
  const leftover = new Map<string, number[]>();
  for (const { family, covers } of first) {
    for (const cp of byFamily.get(family) ?? []) {
      if (covers.has(cp)) continue;
      for (const rescue of RESCUE) {
        if (rescue === family) continue;
        const list = leftover.get(rescue);
        if (list) list.push(cp);
        else leftover.set(rescue, [cp]);
      }
      missing.add(cp);
    }
  }
  if (leftover.size === 0) return { fonts, missing };

  const second = await Promise.all(
    RESCUE.filter((family) => leftover.has(family)).map((family) =>
      fetchFamily(family, leftover.get(family) ?? [], weights),
    ),
  );
  // In RESCUE order: the first family that covers a character draws it.
  for (const result of second) {
    const takes = (leftover.get(result.family) ?? []).filter(
      (cp) => missing.has(cp) && result.covers.has(cp),
    );
    for (const cp of takes) missing.delete(cp);
    if (takes.length > 0) fonts.push(...result.fonts);
  }
  return { fonts, missing };
}

/**
 * `text` without the characters in `missing`, so the renderer never has to
 * draw a `.notdef` glyph. Graphemes drawn as emoji images are kept whole.
 */
export function drawableText(text: string, missing: ReadonlySet<number>) {
  if (missing.size === 0) return text;
  let out = "";
  for (const grapheme of graphemes(text)) {
    if (drawnAsEmoji(grapheme)) {
      out += grapheme;
      continue;
    }
    for (const char of grapheme) {
      if (!missing.has(char.codePointAt(0) ?? 0)) out += char;
    }
  }
  return out;
}
