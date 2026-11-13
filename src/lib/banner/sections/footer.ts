"use no memo";

import {
  type Block,
  boxOf,
  type Ctx,
  finePrint,
  noteLine,
  noteSize,
} from "@/lib/banner/context";
import { baselineOffset, compact, textLine } from "@/lib/banner/draw";
import { bannerPath, targetOf } from "@/lib/banner/path";
import { plainText } from "@/lib/banner/text";

/**
 * The quiet line under a banner's main content: a caption on the left, the
 * heatmap legend and the brand mark on the right.
 */

/** The brand mark in its two lengths. */
export interface Brand {
  /** "gitbanners.com/torvalds" */
  full: string;
  /** "gitbanners.com", for when the full form does not fit. */
  short: string;
}

/** The host as printed: no scheme, no path, whatever the environment passed. */
export function hostOf(ctx: Ctx): string {
  return plainText(ctx.host)
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/[/?#].*$/, "");
}

/** The brand mark for this banner, or `null` when it is switched off or there is no host. */
export function brandOf(ctx: Ctx): Brand | null {
  const host = hostOf(ctx);
  if (!ctx.options.brand || !host) return null;
  return { full: `${host}${bannerPath(targetOf(ctx.entity))}`, short: host };
}

/**
 * The longest form of the brand mark that fits `width`, or `null`. The mark
 * is never cut with an ellipsis: half a URL is worse than none. With
 * `fullOnly` the short form is not an option (used where falling back to a
 * line of its own reads better than squeezing the host in).
 */
export function fitBrand(
  ctx: Ctx,
  brand: Brand | null,
  width: number,
  fullOnly = false,
): { text: string; width: number } | null {
  if (!brand) return null;
  for (const text of fullOnly ? [brand.full] : [brand.full, brand.short]) {
    const needed = boxOf(ctx, text, finePrint(ctx));
    if (needed <= width) return { text, width: needed };
  }
  return null;
}

/**
 * The brand mark on someone else's line: its top, given the baseline it has
 * to share (the labels of a tile row are often set larger than the mark).
 */
export function brandTop(ctx: Ctx, baseline: number): number {
  return Math.round(baseline - baselineOffset(finePrint(ctx), noteLine(ctx)));
}

/** A right-aligned brand mark as a block of exactly its own width. */
export function planBrand(ctx: Ctx, text: string, width: number): Block {
  const line = noteLine(ctx);
  return {
    width,
    height: line,
    at: (x, y) =>
      compact([
        textLine({
          x,
          y,
          width,
          text,
          size: finePrint(ctx),
          line,
          color: ctx.palette.colors.muted,
          align: "right",
        }),
      ]),
  };
}

export interface FooterSpec {
  width: number;
  /** Sentence on the left, e.g. "4,015 contributions in the last year". */
  caption: string | null;
  legend: Block | null;
  brand: Brand | null;
}

interface FooterChoice {
  legend: boolean;
  brand: string | null;
}

/**
 * What to show, best first. When everything does not fit, things go in the
 * order they matter least: first the legend, then the path after the host,
 * and only then is the caption cut with an ellipsis.
 */
function footerChoices(spec: FooterSpec): FooterChoice[] {
  const legends = spec.legend ? [true, false] : [false];
  const brands = spec.brand ? [spec.brand.full, spec.brand.short] : [];
  const choices: FooterChoice[] = [];
  for (const brand of brands) {
    for (const legend of legends) choices.push({ legend, brand });
  }
  for (const legend of legends) choices.push({ legend, brand: null });
  return choices;
}

/** Lays the footer line out, or returns `null` when there is nothing to show. */
export function planFooter(ctx: Ctx, spec: FooterSpec): Block | null {
  const { palette } = ctx;
  const line = noteLine(ctx);
  const captionSize = noteSize(ctx);
  const spacing = Math.round(captionSize * 2);
  const size = finePrint(ctx);
  const captionWidth = spec.caption ? boxOf(ctx, spec.caption, captionSize) : 0;
  // A caption may be cut to make room for the mark, but not to a stub.
  const captionFloor = Math.min(captionWidth, captionSize * 8);

  const measure = (choice: FooterChoice, caption: number) => {
    const parts = [
      caption,
      choice.legend ? (spec.legend?.width ?? 0) : 0,
      choice.brand ? boxOf(ctx, choice.brand, size) : 0,
    ].filter((width) => width > 0);
    return (
      parts.reduce((sum, width) => sum + width, 0) +
      spacing * Math.max(0, parts.length - 1)
    );
  };
  // The mark outranks a complete caption: the sentence is cut before the
  // mark is dropped.
  const choices = footerChoices(spec);
  const marked = choices.filter((item) => item.brand !== null);
  const unmarked = choices.filter((item) => item.brand === null);
  const fits = (caption: number) => (item: FooterChoice) =>
    measure(item, caption) <= spec.width;
  const choice =
    marked.find(fits(captionWidth)) ??
    // Cutting the caption: the shorter the mark, the more of it survives.
    [...marked].reverse().find(fits(captionFloor)) ??
    unmarked.find(fits(captionWidth)) ??
    unmarked.find(fits(captionFloor)) ??
    ({ legend: false, brand: null } satisfies FooterChoice);

  const legend = choice.legend ? spec.legend : null;
  const brandWidth = choice.brand ? boxOf(ctx, choice.brand, size) : 0;
  if (!spec.caption && !legend && !choice.brand) return null;

  const rightWidth =
    brandWidth + (legend?.width ?? 0) + (brandWidth && legend ? spacing : 0);
  const captionRoom = spec.width - rightWidth - (rightWidth ? spacing : 0);
  // Without a caption the legend takes its place on the left, under the graph.
  const legendOnLeft = !spec.caption && legend !== null && brandWidth > 0;

  return {
    width: spec.width,
    height: line,
    at(x, y) {
      const brandX = x + spec.width - brandWidth;
      const legendX = legendOnLeft
        ? x
        : brandX - (brandWidth ? spacing : 0) - (legend?.width ?? 0);
      return compact([
        spec.caption
          ? textLine({
              x,
              y,
              width: Math.max(0, Math.min(captionWidth, captionRoom)),
              text: spec.caption,
              size: captionSize,
              line,
              color: palette.colors.muted,
            })
          : null,
        ...(legend ? legend.at(legendX, y) : []),
        ...(choice.brand
          ? planBrand(ctx, choice.brand, brandWidth).at(brandX, y)
          : []),
      ]);
    },
  };
}
