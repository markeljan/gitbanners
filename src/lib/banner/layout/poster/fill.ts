"use no memo";

import type { Block } from "@/lib/banner/context";
import type {
  Band,
  BandBlock,
  Gaps,
  Placed,
  Region,
} from "@/lib/banner/layout/poster/model";
import type { GridPlan } from "@/lib/banner/sections/heatmap";

/**
 * Stacking bands in a region of the canvas.
 */

/**
 * Plans the bands for a region and stacks them. Fixed bands take the height
 * they need, the flexible one (the graph) gets what is left, a pinned one
 * sits in the bottom-right corner. Returns `null` when a band cannot be shown
 * or the stack is taller than the region.
 */
export function fill(
  bands: readonly Band[],
  region: Region,
  gaps: Gaps,
): Placed[] | null {
  const height = region.bottom - region.top;
  if (bands.length === 0) return [];
  if (height <= 0 || region.width <= 0) return null;

  const flow = bands.filter((band) => !band.pinned);
  // One band takes what the others leave. Should several ask for it, the
  // first one gets it and the rest are planned like any other band.
  const flexIndex = flow.findIndex((band) => band.flex);
  const blocks: (BandBlock | null)[] = flow.map((band, index) =>
    index === flexIndex ? null : band.plan(region.width, height),
  );
  if (flow.some((_, index) => index !== flexIndex && !blocks[index])) {
    return null;
  }
  // Planned after the flow: a pinned band may depend on what the flow did
  // (the brand line stays away when a tile row already carries the mark).
  const pinned = bands.find((band) => band.pinned);
  const planned = pinned ? pinned.plan(region.width, height) : null;
  if (pinned && !planned) return null;
  const pinnedBlock = planned && planned.height > 0 ? planned : null;
  const flowHeight = pinnedBlock
    ? height - pinnedBlock.height - (flow.length ? gaps.min : 0)
    : height;
  // Gaps that must exist: between bands, and above the first one when the
  // region continues a stack.
  const lead = region.follows && flow.length > 0 ? 1 : 0;
  const spaces = Math.max(0, flow.length - 1) + lead;
  const taken = blocks.reduce((sum, block) => sum + (block?.height ?? 0), 0);
  if (flexIndex >= 0) {
    const block = flow[flexIndex].plan(
      region.width,
      flowHeight - taken - spaces * gaps.min,
    );
    if (!block) return null;
    blocks[flexIndex] = block;
  }
  const used = blocks.reduce((sum, block) => sum + (block?.height ?? 0), 0);
  const free = flowHeight - used;
  if (free < spaces * gaps.min) return null;

  // What is left after the minimum gaps is shared: a stack that continues
  // another keeps an even rhythm (the space under it gets a share too), a
  // stack on its own spreads towards the edges of its region and is centred.
  const spare = free - spaces * gaps.min;
  const shares = lead ? spaces + 1 : spaces;
  const gap =
    region.mode === "top" || shares === 0
      ? gaps.min
      : Math.min(gaps.max, gaps.min + Math.floor(spare / shares));
  let y = region.top;
  if (region.mode === "center") {
    y += lead ? gap : Math.floor((free - gap * spaces) / 2);
  } else if (lead) {
    y += gap;
  }
  const xOf = (block: Block) =>
    region.align === "right" ? region.x + region.width - block.width : region.x;
  const placed: Placed[] = [];
  for (const block of blocks) {
    if (!block) continue;
    placed.push({ block, x: xOf(block), y });
    y += block.height + gap;
  }
  if (pinnedBlock) {
    placed.push({
      block: pinnedBlock,
      x: region.x + region.width - pinnedBlock.width,
      y: region.bottom - pinnedBlock.height,
    });
  }
  return placed;
}

/** The contribution graph among the placed bands, if one of them drew it. */
export function gridOf(placed: readonly Placed[]): GridPlan | null {
  return placed.find((item) => item.block.grid)?.block.grid ?? null;
}

/** Lowest edge of the placed bands, or `fallback` when there are none. */
export function bottomOf(placed: readonly Placed[], fallback: number): number {
  return placed.reduce(
    (bottom, item) => Math.max(bottom, item.y + item.block.height),
    fallback,
  );
}
