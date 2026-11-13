"use no memo";

import { ABSOLUTE_MIN_TYPE } from "@/lib/banner/canvas";
import { type Ctx, withRamp } from "@/lib/banner/context";
import type { Node } from "@/lib/banner/draw";
import { graphOf } from "@/lib/banner/graph";
import { attempt } from "@/lib/banner/layout/poster/arrange";
import {
  type Arrangement,
  type Attempt,
  cellOf,
  frameOf,
  type Level,
  type Parts,
  strainOf,
} from "@/lib/banner/layout/poster/model";
import type { Layout } from "@/lib/banner/layout/types";
import { brandOf } from "@/lib/banner/sections/footer";
import { SECTION_PLANNERS } from "@/lib/banner/sections/index";
import { statIds, statTiles } from "@/lib/banner/stats";
import type { SectionId } from "@/lib/banner/types";

/**
 * Fixed canvases: X and LinkedIn headers, link previews, squares, custom
 * sizes. The canvas does not grow, so the layout is a search:
 *
 *  1. Arrange the sections ("rows": header on top, content, numbers at the
 *     bottom; "columns": identity above the profile photo, content beside it).
 *  2. Keep as many decorations (bio, legend, labels, description lines, extra
 *     tiles) as possible without costing the contribution graph more than a
 *     tenth of its cell size.
 *  3. Grow the type while there is room; shrink it only when nothing else
 *     makes the content fit.
 *
 * Every candidate is a pure plan of whole-pixel boxes; leaves are only
 * created for the winner.
 */

/**
 * Sorts the requested sections into what the arrangements work with: the
 * identity, the stat tiles, and the content sections that have something to
 * show for this entity (the rest is skipped, never an error).
 */
function partsOf(ctx: Ctx, sections: readonly SectionId[]): Parts {
  const { entity } = ctx;
  const graph = sections.includes("heatmap") ? graphOf(ctx) : null;
  const probeWidth = ctx.canvas.width;
  const content = sections.filter((id, index) => {
    if (sections.indexOf(id) !== index) return false;
    if (id === "heatmap") return graph !== null;
    return (
      SECTION_PLANNERS[id]?.(ctx, {
        width: probeWidth,
        maxHeight: null,
        compact: 0,
      }) != null
    );
  });
  const tiles = sections.includes("stats")
    ? statTiles(entity, statIds(entity, ctx.options), ctx.now)
    : [];
  // Tiles lead when no other section does: a "stats" banner is all numbers.
  const tilesLead = tiles.length > 0 && content.length === 0;
  const mains = tilesLead
    ? sections.filter((id) => id === "stats").slice(0, 1)
    : content;
  const wantsHeader = sections.includes("header");
  return {
    // Nothing else to show: the identity alone is still a banner.
    header: wantsHeader || (mains.length === 0 && tiles.length === 0),
    tiles,
    mains,
    graph,
    brand: brandOf(ctx),
  };
}

/** Arrangements worth trying for this banner, most preferred first. */
function arrangementsOf(ctx: Ctx, parts: Parts): Arrangement[] {
  const zoned = frameOf(ctx).zone !== null;
  const hasGraph = parts.mains.includes("heatmap");
  const tilesLead = parts.mains.includes("stats");
  const rows: Arrangement[] =
    parts.header && parts.tiles.length > 0 && !tilesLead
      ? ["rows", "merged"]
      : ["rows"];
  if (!zoned || !parts.header) return rows;
  // Beside a profile photo, identity above and content beside reads best,
  // unless there is a graph: it wants the full width above the photo.
  return hasGraph ? [...rows, "columns"] : ["columns", ...rows];
}

/** An arrangement at the richest level it can afford. */
interface Choice {
  arrangement: Arrangement;
  level: Level;
  attempt: Attempt;
  /** Cell size with every decoration dropped: the best this arrangement can do. */
  bare: number;
}

/** Share of the best achievable cell size a decoration may cost and still be kept. */
const CELL_TOLERANCE = 0.9;

/**
 * The richest version of one arrangement. It starts from the bare layout
 * (which gives the graph its best size) and adds decorations back, most
 * valuable first, keeping each one only if everything still fits and the
 * graph keeps at least nine tenths of that size. Decorations are therefore
 * given up in the order: bio, legend, labels, detail of content sections,
 * extra stat tiles.
 */
function refine(
  ctx: Ctx,
  parts: Parts,
  arrangement: Arrangement,
  roomy: boolean,
): Choice | null {
  const bareLevel = (tiles: number): Level => ({
    bio: false,
    legend: false,
    labels: false,
    compact: 2,
    tiles,
  });
  let level: Level | null = null;
  let current: Attempt | null = null;
  // A banner whose content is its tiles keeps at least one of them.
  const fewest = parts.mains.includes("stats") ? 1 : 0;
  for (let tiles = parts.tiles.length; tiles >= fewest && !current; tiles--) {
    level = bareLevel(tiles);
    current = attempt(ctx, ctx, parts, level, arrangement, roomy);
  }
  if (!level || !current) return null;
  const bare = cellOf(current);
  const steps: Partial<Level>[] = [
    { compact: 1 },
    { compact: 0 },
    { labels: true },
    { legend: true },
    { bio: true },
  ];
  for (const step of steps) {
    const richer: Level = { ...level, ...step };
    const candidate = attempt(ctx, ctx, parts, richer, arrangement, roomy);
    if (candidate && cellOf(candidate) >= bare * CELL_TOLERANCE) {
      level = richer;
      current = candidate;
    }
  }
  return { arrangement, level, attempt: current, bare };
}

/**
 * At a given type scale: the first arrangement (in order of preference)
 * whose graph is nearly as large as the best any arrangement manages.
 */
function choose(ctx: Ctx, parts: Parts, roomy: boolean): Choice | null {
  const choices = arrangementsOf(ctx, parts)
    .map((arrangement) => refine(ctx, parts, arrangement, roomy))
    .filter((choice): choice is Choice => choice !== null);
  const best = Math.max(0, ...choices.map((choice) => choice.bare));
  return choices.find((choice) => choice.bare >= best * CELL_TOLERANCE) ?? null;
}

/** How far the type may grow beyond the canvas' natural size. */
function largestType(ctx: Ctx, chosen: Choice): number {
  const { unit } = ctx.canvas;
  const grid = chosen.attempt.grid;
  // Beside a graph the type stays in proportion to it: the graph is the hero.
  const free = Math.round(unit * 1.6);
  return grid
    ? Math.min(free, Math.max(unit, Math.round(grid.fit.height * 0.205)))
    : free;
}

/**
 * The layout for these parts: chosen at the canvas' natural type size, then
 * grown while the graph and the name lose nothing by it. Only when nothing
 * fits at the natural size is the type made smaller.
 */
function solve(ctx: Ctx, parts: Parts): Attempt | null {
  const { unit } = ctx.canvas;
  const base = choose(ctx, parts, false);
  if (base) {
    let best = base.attempt;
    const cap = largestType(ctx, base);
    for (let size = unit + 1; size <= cap; size++) {
      const bigger = attempt(
        withRamp(ctx, size),
        ctx,
        parts,
        base.level,
        base.arrangement,
        true,
      );
      // Bigger type must not shrink the graph or squeeze the name.
      if (
        !bigger ||
        cellOf(bigger) < cellOf(base.attempt) ||
        strainOf(bigger) > strainOf(base.attempt) + 0.001
      ) {
        break;
      }
      best = bigger;
    }
    return best;
  }
  // Nothing fits at the natural size, even stripped: only now shrink the type.
  for (let size = unit - 1; size >= ABSOLUTE_MIN_TYPE - 3; size--) {
    const smaller = choose(withRamp(ctx, size), parts, false);
    if (smaller) return smaller.attempt;
  }
  return null;
}

/**
 * Lays a banner out on a fixed canvas. Total: when not even the smallest
 * type fits everything, sections are dropped from the end until the rest
 * does, down to an empty canvas.
 */
export function layoutPoster(ctx: Ctx, sections: readonly SectionId[]): Layout {
  const { canvas } = ctx;
  const height = canvas.height ?? 0;
  let remaining = [...sections];
  let solved: Attempt | null = null;
  let parts: Parts;
  for (;;) {
    parts = partsOf(ctx, remaining);
    solved = solve(ctx, parts);
    if (solved || remaining.length === 0) break;
    remaining = remaining.slice(0, -1);
  }
  const nodes: Node[] = [];
  for (const item of solved?.placed ?? []) {
    nodes.push(...item.block.at(Math.round(item.x), Math.round(item.y)));
  }
  return {
    width: canvas.width,
    height,
    nodes,
    // A placeholder grid is drawn but not reported: there is nothing to animate.
    heatmap: (parts.graph?.live && solved?.grid?.geometry) || null,
  };
}
