"use no memo";

import type { Rect } from "@/lib/banner/canvas";
import type { Block, Ctx } from "@/lib/banner/context";
import type { Graph } from "@/lib/banner/graph";
import type { Brand } from "@/lib/banner/sections/footer";
import type { GridPlan } from "@/lib/banner/sections/heatmap";
import type { Tile } from "@/lib/banner/stats";
import type { SectionId } from "@/lib/banner/types";

/**
 * Vocabulary of the fixed-canvas layout: the frame content lives in, the
 * bands that are stacked in it, and what one candidate layout looks like.
 */

/** The content box and the area the destination covers with its own UI. */
export interface Frame {
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Bottom-left area that must stay empty (the profile photo on X and LinkedIn). */
  zone: Rect | null;
}

/** What a candidate layout keeps. Levels only ever take things away. */
export interface Level {
  bio: boolean;
  legend: boolean;
  labels: boolean;
  /** Passed to content sections: 0 keeps their detail, 2 drops it. */
  compact: 0 | 1 | 2;
  /** Most stat tiles to show. */
  tiles: number;
}

/** What the banner has to show, independent of how it is arranged. */
export interface Parts {
  header: boolean;
  tiles: readonly Tile[];
  /**
   * Content sections that have something to show, in order. `stats` is in
   * here only when the tiles are the main content (no other section to lead).
   */
  mains: readonly SectionId[];
  /** The year graph (contributions or commits) when `heatmap` is among the mains. */
  graph: Graph | null;
  brand: Brand | null;
}

/** A planned band: a block, plus what the search wants to know about it. */
export interface BandBlock extends Block {
  /** Set by the band that draws the contribution graph. */
  grid?: GridPlan;
  /** How cramped the block is (0 = comfortable); growing the type must not raise it. */
  strain?: number;
}

/** A piece of the layout that sizes itself for the box it is offered. */
export interface Band {
  plan(width: number, maxHeight: number): BandBlock | null;
  /** Takes whatever height its region has left (the contribution graph). */
  flex?: boolean;
  /** Sits in the bottom-right corner of its region, outside the flow. */
  pinned?: boolean;
}

/** A rectangle of the canvas that bands are stacked in. */
export interface Region {
  x: number;
  width: number;
  top: number;
  bottom: number;
  /** Which side blocks narrower than the region hold on to. */
  align: "left" | "right";
  /** `top`: stack from the top edge. `center`: spread, then centre. */
  mode: "top" | "center";
  /**
   * The region continues a stack that ends at its top edge: the space above
   * its first band is then a gap like the others, not a margin.
   */
  follows?: boolean;
}

/** A planned band with its place on the canvas. */
export interface Placed {
  block: BandBlock;
  x: number;
  y: number;
}

/** One candidate layout: everything placed, nothing drawn yet. */
export interface Attempt {
  placed: Placed[];
  /** The contribution graph of this candidate, when it has one. */
  grid: GridPlan | null;
}

/** Cell size of the candidate's graph; 0 without one. Bigger is better. */
export function cellOf(candidate: Attempt): number {
  return candidate.grid?.fit.cell ?? 0;
}

/** Total strain of a candidate (see `BandBlock.strain`). Lower is better. */
export function strainOf(candidate: Attempt): number {
  return candidate.placed.reduce(
    (sum, item) => sum + (item.block.strain ?? 0),
    0,
  );
}

/**
 * How the bands are arranged.
 * `rows`: header, content, then the stat tiles with the brand mark.
 * `merged`: the same, with the tiles beside the name instead of at the bottom.
 * `columns`: identity above the profile-photo zone, everything else beside it.
 */
export type Arrangement = "rows" | "merged" | "columns";

/** Vertical space between bands. */
export interface Gaps {
  /** Smallest space between two bands. */
  min: number;
  /** Largest: beyond it the bands drift apart and the rest becomes margin. */
  max: number;
}

/** Below this a contribution graph is noise; the candidate is dropped instead. */
export const MIN_CELL = 3;

/** The content box of the canvas and the zone that must stay empty. */
export function frameOf(ctx: Ctx): Frame {
  const { canvas } = ctx;
  const height = canvas.height ?? 0;
  const zone = canvas.safeZone;
  // Only a zone in the bottom-left corner is understood (it is the only kind
  // the destinations have); any other is ignored rather than guessed at.
  const cornered =
    zone !== null &&
    zone.x <= canvas.inset.left &&
    zone.y + zone.height >= height - canvas.inset.bottom &&
    zone.y > canvas.inset.top;
  return {
    left: canvas.inset.left,
    top: canvas.inset.top,
    right: canvas.width - canvas.inset.right,
    bottom: height - canvas.inset.bottom,
    zone: cornered ? zone : null,
  };
}

/**
 * Gaps for the current type scale. `roomy` asks for comfortable spacing: the
 * bar a layout must clear before its type is allowed to grow.
 */
export function gapsOf(ctx: Ctx, roomy: boolean): Gaps {
  const { small } = ctx.ramp;
  return {
    min: Math.round(small * (roomy ? 1.5 : 2 / 3)),
    max: Math.round(small * 3),
  };
}

/** Left edge of content that sits beside the zone. */
export function besideZone(ctx: Ctx, frame: Frame): number {
  if (!frame.zone) return frame.left;
  const gutter = Math.round(ctx.ramp.small * 1.25);
  return Math.min(
    frame.right,
    Math.max(frame.left, frame.zone.x + frame.zone.width + gutter),
  );
}
