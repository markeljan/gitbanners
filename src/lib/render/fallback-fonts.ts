import type { BannerFont } from "./fonts";

/**
 * Fallback fonts for text the vendored Mona Sans files cannot draw (CJK,
 * Cyrillic, Greek, Arabic, …).
 *
 * Google Fonts can return a font that holds exactly the requested glyphs
 * (`&text=`), typically 2-6 KB, so we fetch one tiny subset per script instead
 * of shipping megabytes of Noto. Pure Latin text never touches the network.
 *
 * Privacy note: the non-Latin characters of the rendered text are sent to
 * fonts.googleapis.com in the query string. This is disclosed on /privacy.
 */

const TIMEOUT_MS = 2500;
const MAX_ENTRIES = 400;
const cache = new Map<string, Promise<ArrayBuffer | null>>();

function remember(
  key: string,
  make: () => Promise<ArrayBuffer>,
): Promise<ArrayBuffer | null> {
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
): Promise<ArrayBuffer | null> {
  return remember(`${family}|${weight}|${chars}`, async () => {
    const api = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&text=${encodeURIComponent(chars)}`;
    const css = await (
      await fetch(api, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    ).text();
    const url = css.match(
      /src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype|woff2?)'\)/,
    )?.[1];
    if (!url?.startsWith("https://fonts.gstatic.com/")) {
      throw new Error(`no font url for ${family}`);
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`font ${res.status}`);
    return res.arrayBuffer();
  });
}

/**
 * What the vendored Mona Sans files already cover: whitespace, Basic Latin
 * through Latin Extended-A, Latin Extended Additional (Vietnamese), common
 * punctuation, the euro and trademark signs and the four basic arrows.
 */
const COVERED = /[\t\n\r -ſḀ-ỿ‐-‧‰-›€™←-↓]/u;

/** Emoji are drawn by the engine itself (Twemoji), never from a text font. */
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[‍️⃣]/u;

/**
 * Script → Noto family. Order matters: kana and hangul are matched before the
 * shared Han block, and Han goes to Noto Sans SC (asking the JP font for a
 * Simplified Chinese character returns a font without it).
 */
const SCRIPTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[぀-ヿㇰ-ㇿｦ-ﾟ]/u, "Noto Sans JP"],
  [/[가-힯ᄀ-ᇿ㄰-㆏]/u, "Noto Sans KR"],
  [/[⺀-⿟　-〿㐀-䶿一-鿿豈-﫿＀-￯]/u, "Noto Sans SC"],
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
  [/[←-⇿⌀-⏿①-⓿─-➿⬀-⯿]/u, "Noto Sans Symbols 2"],
];

/** Greek, Cyrillic, Latin Extended-B, IPA and everything else. */
const DEFAULT_FAMILY = "Noto Sans";

/** Upper bound on distinct uncovered characters we will ask fonts for. */
const MAX_CHARS = 400;

/**
 * Fonts for every character of `text` the base fonts cannot draw.
 * Pass all user-supplied strings of the banner (name, bio, descriptions…).
 * Resolves to `[]` without any network access for plain Latin text, and never
 * rejects: a script whose font cannot be fetched is simply left out.
 */
export async function fallbackFontsFor(
  text: string,
  weights: ReadonlyArray<400 | 700> = [400, 700],
): Promise<BannerFont[]> {
  const byFamily = new Map<string, string[]>();
  let count = 0;
  for (const ch of new Set(text)) {
    if (COVERED.test(ch) || EMOJI.test(ch)) continue;
    if (++count > MAX_CHARS) break;
    const family = SCRIPTS.find(([re]) => re.test(ch))?.[1] ?? DEFAULT_FAMILY;
    const chars = byFamily.get(family);
    if (chars) chars.push(ch);
    else byFamily.set(family, [ch]);
  }
  if (byFamily.size === 0) return [];

  const jobs: Promise<BannerFont | null>[] = [];
  for (const [family, chars] of byFamily) {
    const key = chars.sort().join("");
    for (const weight of weights) {
      jobs.push(
        googleFontSubset(family, weight, key).then((data) =>
          data
            ? {
                name: `fallback ${family}`,
                data,
                weight,
                style: "normal" as const,
              }
            : null,
        ),
      );
    }
  }
  const fonts = await Promise.all(jobs);
  return fonts.filter((font): font is BannerFont => font !== null);
}
