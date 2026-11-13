"use no memo";

import { mix } from "@/lib/banner/color";
import { boxOf, type Ctx } from "@/lib/banner/context";
import { box, compact, type Node, textLine } from "@/lib/banner/draw";

/**
 * Pills: the small rounded labels github.com puts beside a name ("Public
 * archive", "Verified") and under a repository's description (topics).
 *
 * Two looks, both Primer's: a state label is an outline in the colour of its
 * text, a topic is the accent colour on a tint of itself. Tints are mixed
 * into the background here because the renderers only agree on opaque
 * colours.
 */

export interface PillMetrics {
  /** Font size of the text. */
  size: number;
  height: number;
  /** Space between the text and each end. */
  padX: number;
  /** Space between two pills in a row. */
  gap: number;
}

/** Pill sizes for the current type scale. Labels are a little tighter than topics, as on github.com. */
export function pillMetrics(ctx: Ctx, kind: "label" | "topic"): PillMetrics {
  const { small } = ctx.ramp;
  return kind === "label"
    ? {
        size: small,
        height: Math.round(small * 1.67),
        padX: Math.round(small * 0.6),
        gap: Math.round(small * 0.5),
      }
    : {
        size: small,
        height: Math.round(small * 1.83),
        padX: Math.round(small * 0.83),
        gap: Math.round(small * 0.5),
      };
}

/** Width of a pill that shows `text` whole. */
export function pillWidth(ctx: Ctx, text: string, m: PillMetrics): number {
  return boxOf(ctx, text, m.size, 500) + 2 * m.padX;
}

export interface PillColors {
  text: string;
  /** Outline colour; left out for a filled pill. */
  border?: string;
  /** Fill colour; left out for an outlined pill. */
  fill?: string;
}

/** Colours of a state label: its own colour as text, a quieter version of it as outline. */
export function labelColors(ctx: Ctx, color: string): PillColors {
  return { text: color, border: mix(ctx.palette.colors.bg, color, 0.6) };
}

/** Colours of a topic: the link colour on a tint of itself. */
export function topicColors(ctx: Ctx): PillColors {
  const { palette } = ctx;
  return {
    text: palette.link,
    fill: mix(palette.colors.bg, palette.link, 0.16),
  };
}

/** One pill with its top-left corner at (x, y). `width` comes from `pillWidth`. */
export function drawPill(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  width: number,
  m: PillMetrics,
  colors: PillColors,
): Node[] {
  const style = {
    borderRadius: m.height / 2,
    ...(colors.fill ? { backgroundColor: colors.fill } : null),
    ...(colors.border
      ? { border: `${ctx.ramp.hair}px solid ${colors.border}` }
      : null),
  };
  return compact([
    box(x, y, width, m.height, style),
    textLine({
      x: x + m.padX,
      y,
      width: width - 2 * m.padX,
      text,
      size: m.size,
      line: m.height,
      weight: 500,
      color: colors.text,
      align: "center",
    }),
  ]);
}
