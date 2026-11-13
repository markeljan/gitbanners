"use no memo";

import type { Block, Ctx } from "@/lib/banner/context";
import type { Node } from "@/lib/banner/draw";

/**
 * Rows of the year-in-review poster and the two ways they are stacked: tight
 * from the top (a card, which grows with its content) or spread over a fixed
 * height (a poster).
 */

export interface Row {
  block: Block;
  /** Smallest space above the row; the first row ignores it. */
  gap: number;
}

/** Rows from the blocks that exist, all with the same gap. */
export function rowsOf(blocks: readonly (Block | null)[], gap: number): Row[] {
  return blocks
    .filter((block) => block !== null)
    .map((block) => ({ block, gap }));
}

/**
 * Stacks rows from `top` with their gaps (each widened by `extra`), and
 * returns the leaves and where the stack ends.
 */
export function stack(
  rows: readonly Row[],
  left: number,
  top: number,
  extra = 0,
): { nodes: Node[]; bottom: number } {
  const nodes: Node[] = [];
  let y = top;
  rows.forEach((row, index) => {
    if (index > 0) y += row.gap + extra;
    nodes.push(...row.block.at(left, y));
    y += row.block.height;
  });
  return { nodes, bottom: y };
}

/**
 * Stacks rows in a box of a fixed height: the space left over is shared
 * between the rows (up to a couple of lines of small text each), and what
 * then remains is split above and below. `null` when the rows are taller
 * than the box.
 */
export function spread(
  ctx: Ctx,
  rows: readonly Row[],
  left: number,
  top: number,
  available: number,
): Node[] | null {
  const needed = rows.reduce(
    (sum, row, index) => sum + row.block.height + (index > 0 ? row.gap : 0),
    0,
  );
  const spare = available - needed;
  if (spare < 0) return null;
  const gaps = Math.max(0, rows.length - 1);
  const most = Math.round(ctx.ramp.small * 2.4);
  const extra = gaps ? Math.min(most, Math.floor(spare / (gaps + 1))) : 0;
  const offset = Math.floor((spare - extra * gaps) / 2);
  return stack(rows, left, top + offset, extra).nodes;
}
