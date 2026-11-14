"use no memo";

import type { CalendarGrid } from "@/lib/banner/calendar";
import type { Ctx } from "@/lib/banner/context";
import {
  type Frame,
  MEASURE_SHARE,
  MIN_CELL,
} from "@/lib/banner/layout/poster/model";
import type { Layout } from "@/lib/banner/layout/types";
import {
  fullLists,
  hasRepos,
  type Lists,
  listCount,
  planLines,
  planTables,
  planTop,
} from "@/lib/banner/layout/wrapped/pieces";
import {
  type Row,
  rowsOf,
  spread,
  stack,
} from "@/lib/banner/layout/wrapped/rows";
import type { YearReview } from "@/lib/banner/review";
import { brandOf } from "@/lib/banner/sections/footer";
import { type GridPlan, planGrid } from "@/lib/banner/sections/heatmap";
import { planFacts } from "@/lib/banner/sections/wrapped/facts";
import { fitHeatmap } from "@/lib/banner/sizes";

/**
 * The year in review as one column: the opening, the graph, the facts, the
 * closing. A card shows all of it and grows; a poster (link preview, square)
 * has a fixed height, so the graph takes what the rest leaves and content is
 * given up in a fixed order when the graph would get too small.
 */

/**
 * Share of its full-year, width-limited cell size the graph must keep.
 * Content that would cost it more is left out instead.
 */
const GRAPH_TOLERANCE = 0.95;
/** Week columns of a full year: the yardstick for the graph, however short the range is. */
const YEAR_COLS = 53;

/** What a poster keeps beyond its core (identity, total, graph). */
interface Keep extends Lists {
  /** What the total is made of, under it. */
  breakdown: boolean;
  facts: boolean;
}

/**
 * From everything to the bare poster: the order in which content is given
 * up. Long lists are shortened before a list is dropped, so asking for more
 * entries never shows fewer.
 */
function keepsFor(ctx: Ctx): Keep[] {
  const count = listCount(ctx);
  const all = { repos: true, languages: true, facts: true };
  const shorter = [...new Set([count, Math.min(count, 5), Math.min(count, 3)])];
  return [
    { ...all, breakdown: true, count },
    ...shorter.map((entries) => ({ ...all, breakdown: false, count: entries })),
    { ...all, breakdown: false, repos: false, count: shorter.at(-1) ?? count },
    { ...all, breakdown: false, repos: false, languages: false, count },
    { breakdown: false, repos: false, languages: false, facts: false, count },
  ];
}

/** A README card: everything, in one column as wide as the graph. */
export function layoutColumnCard(
  ctx: Ctx,
  review: YearReview,
  calendar: CalendarGrid,
): Layout {
  const { canvas, hide, ramp } = ctx;
  const content = canvas.width - canvas.inset.left - canvas.inset.right;
  const grid = planGrid(ctx, calendar, {
    maxWidth: content,
    maxHeight: null,
    labels: !hide.has("labels"),
  });
  // The graph sets the measure, as on every card that has one.
  const width =
    grid && grid.width >= content * MEASURE_SHARE ? grid.width : content;
  const left = canvas.inset.left + Math.floor((content - width) / 2);
  const rows = rowsOf(
    [
      planTop(ctx, review, width, true),
      grid,
      planFacts(ctx, review, { width, columns: 5, rows: 2 }),
      planLines(ctx, review, width, fullLists(ctx), brandOf(ctx)),
    ],
    Math.round(ramp.small * 1.5),
  );
  const { nodes, bottom } = stack(rows, left, canvas.inset.top);
  return {
    width: canvas.width,
    height: bottom + canvas.inset.bottom,
    nodes,
    heatmap: grid?.geometry ?? null,
  };
}

/** The rows of a poster at one width, with the graph taking the height the others leave. */
function compose(
  ctx: Ctx,
  review: YearReview,
  calendar: CalendarGrid,
  width: number,
  available: number,
  keep: Keep,
): { rows: Row[]; grid: GridPlan } | null {
  const gap = Math.round(ctx.ramp.small * 0.8);
  // A canvas about as tall as it is wide has room for two rows of facts and
  // for tables; a landscape one keeps to one row and to lines.
  const tall = available >= width * 0.8;
  const top = planTop(ctx, review, width, keep.breakdown);
  const facts = keep.facts
    ? planFacts(ctx, review, {
        width,
        columns: tall ? 3 : 5,
        rows: tall ? 2 : 1,
      })
    : null;
  // Two lists make two tables; a single one reads better as a line.
  const paired = keep.repos && keep.languages && hasRepos(review);
  const closing =
    tall && paired
      ? planTables(ctx, review, width, keep, brandOf(ctx))
      : planLines(ctx, review, width, keep, brandOf(ctx), tall);
  const others = rowsOf([top, facts, closing], gap);
  const taken = others.reduce((sum, row) => sum + row.block.height + gap, 0);
  const grid = planGrid(ctx, calendar, {
    maxWidth: width,
    maxHeight: available - taken,
    labels: false,
  });
  if (!grid || grid.fit.cell < MIN_CELL) return null;
  return { grid, rows: rowsOf([top, grid, facts, closing], gap) };
}

/**
 * Link previews, squares and other open canvases: one column, spread over
 * the height. `null` when not even the bare poster fits at this type size.
 */
export function layoutColumnPoster(
  ctx: Ctx,
  review: YearReview,
  calendar: CalendarGrid,
  frame: Frame,
): Layout | null {
  const { canvas } = ctx;
  const full = frame.right - frame.left;
  const available = frame.bottom - frame.top;
  if (full <= 0 || available <= 0) return null;
  // What a year's graph is when only the width limits it.
  const natural = fitHeatmap(
    full,
    Number.POSITIVE_INFINITY,
    Math.max(calendar.cols, YEAR_COLS),
  );
  const keeps = keepsFor(ctx);
  for (const keep of keeps) {
    const bare = keep === keeps[keeps.length - 1];
    const first = compose(ctx, review, calendar, full, available, keep);
    if (!first) continue;
    if (!bare && first.grid.fit.cell < natural.cell * GRAPH_TOLERANCE) continue;
    // A graph that nearly spans the canvas sets the measure for everything,
    // unless the narrower column would cost the graph its size.
    const narrow =
      first.grid.width < full && first.grid.width >= full * MEASURE_SHARE
        ? compose(ctx, review, calendar, first.grid.width, available, keep)
        : null;
    const measured =
      narrow && narrow.grid.fit.cell >= first.grid.fit.cell ? narrow : first;
    const width = measured === first ? full : first.grid.width;
    const left = frame.left + Math.floor((full - width) / 2);
    const nodes = spread(ctx, measured.rows, left, frame.top, available);
    if (!nodes) continue;
    return {
      width: canvas.width,
      height: canvas.height ?? 0,
      nodes,
      heatmap: measured.grid.geometry,
    };
  }
  return null;
}
