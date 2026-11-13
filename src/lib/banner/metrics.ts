"use no memo";

/**
 * Text width estimation without a layout engine.
 *
 * The banner engine places every box itself, so it has to know roughly how
 * wide a string will be before any renderer sees it (to right-align numbers,
 * shrink a long name, or decide whether a brand mark still fits). The tables
 * are the advance widths of the vendored Mona Sans static files, read through
 * the renderer on 2026-11-13, in 1/1000 em.
 *
 * Estimates ignore kerning, which is almost always negative, so they err on
 * the wide side: measured on 18 real strings the sum is between -0.5% and +3%
 * of the true width (+9% for all-caps text). Callers size boxes with
 * `textBox()`, which adds the missing safety margin.
 */

export type FontWeight = 400 | 500 | 600 | 700;

export interface TextStyle {
  /** Font size in px. */
  size: number;
  weight?: FontWeight;
  /** Mona Sans Mono: every glyph has the same advance. */
  mono?: boolean;
}

/** Advance widths for U+0020..U+007E, Mona Sans Regular. */
const REGULAR = [
  241, 262, 383, 641, 648, 836, 768, 183, 335, 349, 301, 589, 223, 389, 214,
  394, 637, 375, 547, 573, 617, 581, 636, 530, 603, 636, 226, 234, 601, 589,
  590, 532, 906, 708, 689, 769, 737, 617, 610, 790, 763, 259, 387, 671, 562,
  869, 755, 806, 659, 821, 700, 639, 624, 723, 699, 993, 705, 665, 610, 352,
  383, 352, 587, 452, 243, 598, 600, 568, 600, 563, 331, 595, 586, 231, 232,
  547, 235, 916, 585, 594, 600, 600, 357, 504, 356, 586, 522, 734, 554, 521,
  482, 388, 268, 401, 587,
] as const;

/** Advance widths for U+0020..U+007E, Mona Sans SemiBold. */
const SEMIBOLD = [
  236, 277, 413, 655, 653, 842, 761, 197, 348, 358, 299, 587, 242, 398, 235,
  420, 638, 403, 562, 584, 629, 591, 647, 547, 610, 647, 242, 249, 595, 587,
  588, 546, 893, 729, 695, 767, 737, 620, 611, 784, 769, 278, 399, 694, 568,
  887, 762, 801, 668, 826, 710, 647, 629, 725, 725, 1009, 736, 694, 615, 360,
  404, 360, 586, 456, 270, 611, 613, 576, 614, 575, 355, 606, 603, 253, 252,
  579, 257, 929, 601, 598, 613, 613, 374, 516, 379, 601, 550, 774, 588, 547,
  495, 400, 279, 410, 586,
] as const;

/** Punctuation outside ASCII that banners print themselves: [regular, semibold]. */
const PUNCTUATION: Record<string, readonly [number, number]> = {
  "·": [204, 211],
  "•": [294, 294],
  "–": [500, 521],
  "—": [665, 690],
  "…": [660, 722],
  "‘": [223, 242],
  "’": [232, 246],
  "“": [387, 437],
  "”": [387, 437],
  "×": [587, 585],
  "→": [732, 731],
  "©": [864, 855],
};

/** Every glyph of Mona Sans Mono. */
const MONO_ADVANCE = 618;
/** Latin letters the tables do not list (ø, ß, æ, …) and unknown scripts. */
const DEFAULT_ADVANCE = 640;
/** CJK ideographs, kana, hangul and full-width forms fill the em square. */
const WIDE_ADVANCE = 1000;
/** Emoji are drawn as 1 em images with a little side bearing. */
const EMOJI_ADVANCE = 1100;

type Range = readonly [from: number, to: number];

/** Joiners, direction marks, variation selectors, skin tones, tag characters. */
const ZERO_WIDTH: readonly Range[] = [
  [0x200b, 0x200f],
  [0x2060, 0x2060],
  [0xfe00, 0xfe0f],
  [0x1f3fb, 0x1f3ff],
  [0xe0020, 0xe007f],
];
/** Hangul, CJK ideographs and punctuation, kana, full-width forms. */
const WIDE: readonly Range[] = [
  [0x1100, 0x11ff],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa960, 0xa97f],
  [0xac00, 0xd7ff],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x3ffff],
];
const COMBINING_MARK = /\p{M}/u;
const EMOJI = /\p{Extended_Pictographic}/u;
const REGIONAL_INDICATOR = /\p{Regional_Indicator}/u;

function within(code: number, ranges: readonly Range[]): boolean {
  return ranges.some(([from, to]) => code >= from && code <= to);
}

function isZeroWidth(char: string, code: number): boolean {
  return within(code, ZERO_WIDTH) || COMBINING_MARK.test(char);
}

function blend(regular: number, semibold: number, weight: FontWeight): number {
  if (weight <= 400) return regular;
  if (weight >= 600)
    return semibold + ((semibold - regular) * (weight - 600)) / 200;
  return regular + ((semibold - regular) * (weight - 400)) / 200;
}

function advance(char: string, weight: FontWeight): number {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) {
    const index = code - 0x20;
    return blend(REGULAR[index] ?? 0, SEMIBOLD[index] ?? 0, weight);
  }
  if (code < 0x20) return 0;
  if (code === 0xa0) return blend(REGULAR[0], SEMIBOLD[0], weight);
  const known = PUNCTUATION[char];
  if (known) return blend(known[0], known[1], weight);
  if (isZeroWidth(char, code)) return 0;
  if (within(code, WIDE)) return WIDE_ADVANCE;
  // A flag is two regional indicators drawn as one glyph.
  if (REGIONAL_INDICATOR.test(char)) return EMOJI_ADVANCE / 2;
  if (EMOJI.test(char)) return EMOJI_ADVANCE;
  // Accented Latin letters are as wide as their base letter.
  const base = char.normalize("NFD").codePointAt(0) ?? 0;
  if (base !== code && base >= 0x41 && base <= 0x7a) {
    const index = base - 0x20;
    return blend(REGULAR[index] ?? 0, SEMIBOLD[index] ?? 0, weight);
  }
  return DEFAULT_ADVANCE;
}

/** Estimated advance width of `text` in px (a float, never negative). */
export function textWidth(text: string, style: TextStyle): number {
  const weight = style.weight ?? 400;
  let units = 0;
  for (const char of text) {
    units += style.mono ? advanceMono(char) : advance(char, weight);
  }
  return (units * style.size) / 1000;
}

function advanceMono(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x20 || isZeroWidth(char, code)) return 0;
  if (within(code, WIDE)) return WIDE_ADVANCE;
  if (REGIONAL_INDICATOR.test(char)) return EMOJI_ADVANCE / 2;
  if (code > 0x2000 && EMOJI.test(char)) return EMOJI_ADVANCE;
  return MONO_ADVANCE;
}

/**
 * Width to give a box that must show `text` without an ellipsis: the estimate
 * plus 2% and 2 px, rounded up. The margin covers positive kerning pairs and
 * sub-pixel differences between the browser and the image renderer.
 */
export function textBox(text: string, style: TextStyle): number {
  if (!text) return 0;
  return Math.ceil(textWidth(text, style) * 1.02) + 2;
}

/**
 * Largest whole font size between `min` and `max` at which `text` fits
 * `maxWidth`. Returns `min` when even that is too wide (the caller then relies
 * on the ellipsis).
 */
export function fitFontSize(
  text: string,
  maxWidth: number,
  max: number,
  min: number,
  style: Omit<TextStyle, "size"> = {},
): number {
  const perPx = textWidth(text, { ...style, size: 1000 }) / 1000;
  if (perPx <= 0) return max;
  const size = Math.floor((maxWidth - 2) / (perPx * 1.02));
  return Math.max(min, Math.min(max, size));
}
