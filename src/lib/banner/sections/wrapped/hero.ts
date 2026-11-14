"use no memo";

import { contrast } from "@/lib/banner/color";
import {
  type Block,
  boxOf,
  type Ctx,
  lineOf,
  textLineHeight,
  titleLine,
  widthOf,
} from "@/lib/banner/context";
import { compact, type TextRun, textLine } from "@/lib/banner/draw";
import { formatCount, formatNumber } from "@/lib/banner/format";
import { fitFontSize } from "@/lib/banner/metrics";
import type { YearReview } from "@/lib/banner/review";
import { statIds } from "@/lib/banner/stats";

/**
 * The opening of the year-in-review poster: when (the year, in the theme's
 * colour) and how much (the total, as the largest type on the canvas).
 *
 * Like every section, each piece is planned for a width and answers with a
 * block; the layouts under `layout/wrapped` decide where the blocks go.
 */

/**
 * The poster's one colour: the stronger of the theme's two top heat colours
 * against the background. It ties the year to the graph under it (GitHub
 * green on the GitHub themes, purple on Dracula) and reads on dark and light.
 */
function reviewAccent(ctx: Ctx): string {
  const { bg, heat } = ctx.palette.colors;
  return contrast(heat[4], bg) >= contrast(heat[3], bg) ? heat[4] : heat[3];
}

/**
 * Line height of the poster's display numerals: just the digits, without the
 * room a text line keeps for accents and descenders. Rows above and below can
 * then be set by the look of the numbers instead of by empty line boxes.
 */
function displayLine(size: number): number {
  return Math.round(size * 0.92);
}

/** "in 2026", or "in the last 12 months" when no calendar year was asked for. */
function periodOf(review: YearReview): string {
  return review.year ? `in ${review.year}` : "in the last 12 months";
}

/** What follows the total: "contributions in 2026". A custom title replaces it, `hide=title` removes it. */
export function totalPhrase(ctx: Ctx, review: YearReview): string {
  if (ctx.hide.has("title")) return "";
  if (ctx.options.title) return ctx.options.title;
  const noun = review.total === 1 ? "contribution" : "contributions";
  return `${noun} ${periodOf(review)}`;
}

/** The total as a sentence, for captions: "2,532 contributions in 2026". */
export function totalSentence(ctx: Ctx, review: YearReview): string | null {
  if (ctx.hide.has("title")) return null;
  if (ctx.options.title) return ctx.options.title;
  if (review.total <= 0) return `No public contributions ${periodOf(review)}`;
  return `${formatNumber(review.total)} ${totalPhrase(ctx, review)}`;
}

/** The year mark, with what a neighbour needs to know to sit beside it. */
export interface YearMark extends Block {
  /** Height of the large line; below it only the quiet line remains. */
  bigHeight: number;
  /** Width of the quiet line, which ends at the same right edge. */
  subWidth: number;
}

/**
 * The year, large, in the poster's colour, with one quiet line under it: how
 * the year compares with the one before when that is known, otherwise what
 * the poster is. Without a calendar year the two lines read "Year in review"
 * over "Last 12 months".
 *
 * Right-aligned in its own box. `null` when it does not fit `maxWidth` even
 * at its smallest.
 */
export function planYearMark(
  ctx: Ctx,
  review: YearReview,
  maxWidth: number,
): YearMark | null {
  const { ramp, palette } = ctx;
  const numeric = review.year !== null;
  const big = numeric ? String(review.year) : "Year in review";
  const sub = numeric
    ? review.change
      ? `${review.change.text} vs ${review.change.against}`
      : "Year in review"
    : "Last 12 months";
  const subColor =
    numeric && review.change?.up ? palette.success : palette.colors.muted;
  const subSize = ramp.small;
  const subLine = lineOf(subSize, 1.4);
  const bigSize = fitFontSize(
    big,
    maxWidth,
    numeric ? Math.round(ramp.small * 3.4) : ramp.title,
    numeric ? ramp.title : ramp.body,
    { weight: ramp.strong, mono: ctx.font.id === "mono" },
  );
  const bigWidth = boxOf(ctx, big, bigSize, ramp.strong);
  const subWidth = boxOf(ctx, sub, subSize);
  const width = Math.max(bigWidth, subWidth);
  if (width > maxWidth) return null;
  const bigLine = numeric ? displayLine(bigSize) : titleLine(bigSize);
  return {
    width,
    height: bigLine + ramp.lead + subLine,
    bigHeight: bigLine + ramp.lead,
    subWidth,
    at: (x, y) =>
      compact([
        textLine({
          x: x + width - bigWidth,
          y,
          width: bigWidth,
          text: big,
          size: bigSize,
          line: bigLine,
          weight: ramp.strong,
          color: reviewAccent(ctx),
          align: "right",
        }),
        textLine({
          x: x + width - subWidth,
          y: y + bigLine + ramp.lead,
          width: subWidth,
          text: sub,
          size: subSize,
          line: subLine,
          color: subColor,
          align: "right",
        }),
      ]),
  };
}

/** The kinds of contribution a total is made of, with their singular and plural. */
const PARTS = [
  ["commits", "commit", "commits"],
  ["pullRequests", "pull request", "pull requests"],
  ["reviews", "review", "reviews"],
  ["issues", "issue", "issues"],
] as const;

/**
 * "1.8k commits · 228 pull requests · 329 reviews": what the total is made
 * of, for the kinds the banner's stat ids name. Kinds that are unknown or
 * zero are left out, and only whole entries are printed, as many as fit.
 */
function breakdownOf(ctx: Ctx, width: number, size: number): string {
  const { entity } = ctx;
  if (entity.kind !== "user") return "";
  const wanted = statIds(entity, ctx.options);
  let text = "";
  for (const [id, one, many] of PARTS) {
    const amount = entity.stats?.[id];
    if (!wanted.includes(id) || typeof amount !== "number" || !(amount > 0)) {
      continue;
    }
    const entry = `${formatCount(amount)} ${amount === 1 ? one : many}`;
    const next = text ? `${text} · ${entry}` : entry;
    if (widthOf(ctx, next, size) > width - 2) break;
    text = next;
  }
  return text;
}

/**
 * The hero: the year's total as the largest thing on the poster, what it
 * counts beside it (below it when the line is too short), and optionally the
 * breakdown underneath. A year without contributions says so in words.
 */
export function planHero(
  ctx: Ctx,
  review: YearReview,
  width: number,
  withBreakdown: boolean,
): Block {
  const { ramp, palette } = ctx;
  const card = ctx.canvas.chrome === "card";
  const fitting = { weight: ramp.strong, mono: ctx.font.id === "mono" };
  const labelSize = Math.round(ramp.body * 1.12);
  const noteSize = ramp.small;
  const noteLine = lineOf(noteSize, 1.4);
  const breakdown = withBreakdown ? breakdownOf(ctx, width, noteSize) : "";
  // The numerals above have no line spacing of their own: give the line
  // under them the air a comma needs.
  const breakdownGap = Math.round(ramp.small * 0.4);
  const breakdownSpace = breakdown ? breakdownGap + noteLine : 0;

  if (review.total <= 0) {
    const sentence = totalSentence(ctx, review) ?? "";
    const size = fitFontSize(sentence, width, ramp.title, ramp.body, fitting);
    const line = titleLine(size);
    return {
      width,
      height: line,
      at: (x, y) =>
        compact([
          textLine({
            x,
            y,
            width,
            text: sentence,
            size,
            line,
            weight: ramp.strong,
            color: palette.colors.text,
          }),
        ]),
    };
  }

  const number = formatNumber(review.total);
  const phrase = totalPhrase(ctx, review);
  const wanted = Math.round(ramp.small * (card ? 3.6 : 4));
  const inline =
    widthOf(ctx, number, wanted, ramp.strong) +
      widthOf(ctx, ` ${phrase}`, labelSize) <=
    width - 2;
  const size = inline
    ? wanted
    : fitFontSize(number, width, wanted, ramp.title, fitting);
  const line = displayLine(size);
  const phraseLine = textLineHeight(labelSize);
  const phraseSpace = !inline && phrase ? phraseLine : 0;
  const runs: TextRun[] = [
    { text: number, weight: ramp.strong, color: palette.colors.text },
    ...(inline && phrase
      ? [
          {
            text: ` ${phrase}`,
            size: labelSize,
            weight: 400,
            color: palette.colors.muted,
          },
        ]
      : []),
  ];
  return {
    width,
    height: line + phraseSpace + breakdownSpace,
    at: (x, y) =>
      compact([
        textLine({
          x,
          y,
          width,
          text: runs,
          size,
          line,
          color: palette.colors.text,
        }),
        phraseSpace
          ? textLine({
              x,
              y: y + line,
              width,
              text: phrase,
              size: labelSize,
              line: phraseLine,
              color: palette.colors.muted,
            })
          : null,
        breakdown
          ? textLine({
              x,
              y: y + line + phraseSpace + breakdownGap,
              width,
              text: breakdown,
              size: noteSize,
              line: noteLine,
              color: palette.colors.muted,
            })
          : null,
      ]),
  };
}
