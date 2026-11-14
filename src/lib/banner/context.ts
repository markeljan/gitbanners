"use no memo";

import type { Canvas } from "@/lib/banner/canvas";
import type { Node } from "@/lib/banner/draw";
import { strongWeight } from "@/lib/banner/fonts";
import type { FontWeight, TextStyle } from "@/lib/banner/metrics";
import { textBox, textWidth } from "@/lib/banner/metrics";
import type { Palette } from "@/lib/banner/palette";
import type {
  BannerFont,
  BannerOptions,
  HideId,
  RenderEnv,
} from "@/lib/banner/types";
import type { Entity } from "@/lib/github/schema";

/**
 * Type sizes and spacing for one banner, all derived from the size of small
 * text (`small`). A README card runs at 12 px, an X header at 24 px: the same
 * section code draws both.
 */
export interface Ramp {
  /** Labels and captions. */
  small: number;
  /** Month and weekday labels of the heatmap. */
  micro: number;
  /** Handles, bios, descriptions. */
  body: number;
  /** Names and numbers. */
  title: number;
  /** Width of hairlines and avatar rings. */
  hair: number;
  /** Corner radius of inner cards. */
  radius: number;
  /**
   * Extra space between a title line and the small line under it. Cards read
   * at arm's length and get some; posters are display type and get none.
   */
  lead: number;
  /** Weight of names and numbers. */
  strong: FontWeight;
}

/**
 * Builds the ramp for a given small-text size. `floor` is the canvas'
 * minimum type size: the heatmap labels would otherwise dip below it.
 */
export function makeRamp(
  small: number,
  floor: number,
  strong: FontWeight,
  chrome: Canvas["chrome"],
): Ramp {
  const size = Math.max(1, Math.round(small));
  return {
    small: size,
    micro: Math.max(Math.min(floor, size), Math.round(size * 0.92)),
    body: Math.round(size * 1.1 + 0.6),
    title: Math.round(size * 1.85),
    hair: Math.max(1, Math.round(size / 24)),
    radius: Math.max(2, Math.round(size / 2)),
    lead: chrome === "card" ? Math.round(size / 4) : 0,
    strong,
  };
}

/** Whole-pixel line height for a font size. */
export function lineOf(size: number, ratio: number): number {
  return Math.round(size * ratio);
}

/** Line height of names and numbers: display type, set tight. */
export function titleLine(size: number): number {
  return lineOf(size, 1.12);
}

/**
 * Line height of running text. Not tighter than the font's own 1.41 glyph
 * box, so clamped paragraphs never clip an accent or a descender.
 */
export function textLineHeight(size: number): number {
  return Math.ceil(size * 1.41);
}

/**
 * Type size of the quiet line under the content (caption, legend, brand
 * mark). It follows the type scale down but not up: when a roomy canvas lets
 * names and numbers grow, the fine print stays fine.
 */
export function noteSize(ctx: Ctx): number {
  return Math.min(ctx.ramp.small, ctx.canvas.unit);
}

/** Size of the smallest notes on that line: legend labels and the brand mark. */
export function finePrint(ctx: Ctx): number {
  return Math.min(ctx.ramp.micro, ctx.canvas.minType);
}

/** Height of that line. */
export function noteLine(ctx: Ctx): number {
  return lineOf(noteSize(ctx), 1.4);
}

/** Everything a section needs to plan and draw itself. */
export interface Ctx {
  entity: Entity;
  options: BannerOptions;
  canvas: Canvas;
  palette: Palette;
  font: BannerFont;
  ramp: Ramp;
  hide: ReadonlySet<HideId>;
  /** A drawable source for a remote image at `px` CSS pixels ("" when there is none). */
  image(url: string | null | undefined, px: number): string;
  /** Host shown in the brand mark. */
  host: string;
  /** "Now", as injected by the caller: sections never read the clock themselves. */
  now: Date;
}

/** The context with another type scale: how layouts try bigger or smaller type. */
export function withRamp(ctx: Ctx, small: number): Ctx {
  return {
    ...ctx,
    ramp: makeRamp(
      small,
      ctx.canvas.minType,
      strongWeight(ctx.font),
      ctx.canvas.chrome,
    ),
  };
}

/** Text style for the width estimator, in this banner's typeface. */
function styleOf(ctx: Ctx, size: number, weight: FontWeight = 400): TextStyle {
  return { size, weight, mono: ctx.font.id === "mono" };
}

/** Estimated width of `text` (float). */
export function widthOf(
  ctx: Ctx,
  text: string,
  size: number,
  weight: FontWeight = 400,
): number {
  return textWidth(text, styleOf(ctx, size, weight));
}

/** Width of a box that shows `text` without an ellipsis. */
export function boxOf(
  ctx: Ctx,
  text: string,
  size: number,
  weight: FontWeight = 400,
): number {
  return textBox(text, styleOf(ctx, size, weight));
}

/**
 * A laid-out piece of a banner: its size is known before anything is drawn,
 * and drawing it is a pure function of where it is put.
 */
export interface Block {
  width: number;
  height: number;
  /** The block's leaves with its top-left corner at (x, y). */
  at(x: number, y: number): Node[];
}

/** Wraps an image source so remote URLs go through the environment and data URIs do not. */
export function imageResolver(env: RenderEnv): Ctx["image"] {
  return (url, px) => {
    // Data that does not match the schema must still draw: no source, no image.
    if (typeof url !== "string" || !url) return "";
    if (url.startsWith("data:")) return url;
    try {
      const resolved = env.image(url, Math.max(1, Math.round(px)));
      return typeof resolved === "string" ? resolved : "";
    } catch {
      return "";
    }
  };
}
