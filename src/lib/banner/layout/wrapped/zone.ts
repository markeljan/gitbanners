"use no memo";

import type { CalendarGrid } from "@/lib/banner/calendar";
import type { Rect } from "@/lib/banner/canvas";
import { type Ctx, noteLine } from "@/lib/banner/context";
import type { Node } from "@/lib/banner/draw";
import { formatNumber } from "@/lib/banner/format";
import { headerBand } from "@/lib/banner/layout/poster/bands";
import {
  besideZone,
  type Frame,
  type Level,
  MIN_CELL,
} from "@/lib/banner/layout/poster/model";
import type { Layout } from "@/lib/banner/layout/types";
import { fullLists, planLines } from "@/lib/banner/layout/wrapped/pieces";
import { rowsOf, spread } from "@/lib/banner/layout/wrapped/rows";
import type { YearReview } from "@/lib/banner/review";
import { brandOf, planFooter } from "@/lib/banner/sections/footer";
import { avatarSize, planHeader } from "@/lib/banner/sections/header";
import { type GridPlan, planGrid } from "@/lib/banner/sections/heatmap";
import { planFacts } from "@/lib/banner/sections/wrapped/facts";
import {
  planHero,
  planYearMark,
  totalPhrase,
  totalSentence,
} from "@/lib/banner/sections/wrapped/hero";
import type { Tile } from "@/lib/banner/stats";

/**
 * The year in review on a profile header, where the photo covers the
 * bottom-left corner.
 *
 * Where the strip above the photo is deep enough (X), the identity, the
 * total and the graph go there, with the year in the space the graph leaves
 * at its right, and the facts and languages sit beside the photo. Where it
 * is shallow (LinkedIn), only the identity stays above the photo and
 * everything else stacks beside it.
 */

/** Above the profile photo the graph must keep cells of at least this size; otherwise it goes beside the photo. */
const COMFORTABLE_CELL = 8;

/** The identity row of a profile header, as bare as it gets. */
const BARE: Level = {
  bio: false,
  legend: false,
  labels: false,
  compact: 2,
  tiles: 0,
};

/** What both arrangements measure the canvas by. */
interface Zoned {
  frame: Frame;
  zone: Rect;
  /** Left edge of content beside the photo. */
  side: number;
  /** Height of the strip above the photo. */
  upper: number;
  /** Space between rows that belong to different things. */
  gap: number;
  /** Space between rows that belong together. */
  tight: number;
}

function layoutOf(ctx: Ctx, nodes: Node[], grid: GridPlan): Layout {
  return {
    width: ctx.canvas.width,
    height: ctx.canvas.height ?? 0,
    nodes,
    heatmap: grid.geometry,
  };
}

/**
 * X: identity with the total as its headline, the graph under it across the
 * strip above the photo, the year at the graph's right; facts and languages
 * beside the photo. `null` when the strip is too shallow for a graph of a
 * comfortable size.
 */
function abovePhoto(
  ctx: Ctx,
  review: YearReview,
  calendar: CalendarGrid,
  z: Zoned,
): Layout | null {
  const { ramp } = ctx;
  const { frame } = z;
  const width = frame.right - frame.left;
  const sideWidth = frame.right - z.side;
  // Beside the name the total is a headline number, as on every profile
  // header. A year without contributions has no number to print there: it
  // says so in words beside the photo instead.
  const headline: Tile[] =
    review.total > 0
      ? [
          {
            id: "contributions",
            value: formatNumber(review.total),
            label: totalPhrase(ctx, review),
          },
        ]
      : [];
  const header =
    headerBand(ctx, BARE, headline).plan(width, z.upper) ??
    headerBand(ctx, BARE, []).plan(width, z.upper);
  if (!header) return null;
  const graph = planGrid(ctx, calendar, {
    maxWidth: width,
    maxHeight: z.upper - header.height - z.gap,
    labels: false,
  });
  if (!graph || graph.fit.cell < COMFORTABLE_CELL) return null;

  const graphTop = frame.top + header.height + z.gap;
  const nodes: Node[] = [
    ...header.at(frame.left, frame.top),
    ...graph.at(frame.left, graphTop),
  ];
  const markRoom = width - graph.width - Math.round(ramp.small * 1.25);
  const mark = markRoom > 0 ? planYearMark(ctx, review, markRoom) : null;
  if (mark && mark.height <= graph.height) {
    nodes.push(
      ...mark.at(
        frame.right - mark.width,
        graphTop + Math.floor((graph.height - mark.height) / 2),
      ),
    );
  }

  const lowerTop = graphTop + graph.height + z.tight;
  const lead =
    review.total > 0
      ? planFacts(ctx, review, { width: sideWidth, columns: 5, rows: 1 })
      : planHero(ctx, review, sideWidth, false);
  const brand = brandOf(ctx);
  const withLanguages = planLines(
    ctx,
    review,
    sideWidth,
    { ...fullLists(ctx), repos: false },
    brand,
  );
  const markOnly = planLines(
    ctx,
    review,
    sideWidth,
    { ...fullLists(ctx), repos: false, languages: false },
    brand,
  );
  // Beside the photo, richest first; the mark is the last thing to go.
  for (const blocks of [
    [lead, withLanguages],
    [lead, markOnly],
    [withLanguages],
    [markOnly],
  ]) {
    const lower = spread(
      ctx,
      rowsOf(blocks, z.tight),
      z.side,
      lowerTop,
      frame.bottom - lowerTop,
    );
    if (lower) return layoutOf(ctx, [...nodes, ...lower], graph);
  }
  return layoutOf(ctx, nodes, graph);
}

/**
 * LinkedIn: the identity above the photo; beside it a column of facts, the
 * graph, and a line with the total and the brand mark. `null` when the
 * identity or the graph does not fit.
 */
function besidePhoto(
  ctx: Ctx,
  review: YearReview,
  calendar: CalendarGrid,
  z: Zoned,
): Layout | null {
  const { frame, zone } = z;
  const sideWidth = frame.right - z.side;
  const cell = zone.x + zone.width - frame.left;
  const identity = planHeader(ctx, { width: cell, reserve: 0, bioLines: 0 });
  if (cell <= avatarSize(ctx) || identity.height > z.upper) return null;
  const height = frame.bottom - frame.top;
  for (const withFacts of [true, false]) {
    const probe = withFacts
      ? planFacts(ctx, review, { width: sideWidth, columns: 5, rows: 1 })
      : null;
    const graph = planGrid(ctx, calendar, {
      maxWidth: sideWidth,
      maxHeight:
        height - (probe ? probe.height + z.gap : 0) - noteLine(ctx) - z.tight,
      labels: false,
    });
    if (!graph || graph.fit.cell < MIN_CELL) continue;
    // A graph that nearly fills the column sets its measure; the column
    // keeps to the right edge, like everything beside a photo.
    const measure = graph.width >= sideWidth * 0.85 ? graph.width : sideWidth;
    const facts = withFacts
      ? planFacts(ctx, review, { width: measure, columns: 5, rows: 1 })
      : null;
    const foot = planFooter(ctx, {
      width: measure,
      caption: totalSentence(ctx, review),
      legend: null,
      brand: brandOf(ctx),
    });
    const column = spread(
      ctx,
      [...rowsOf([facts, graph], z.gap), ...rowsOf([foot], z.tight)],
      frame.right - measure,
      frame.top,
      height,
    );
    if (column) {
      return layoutOf(
        ctx,
        [...identity.at(frame.left, frame.top), ...column],
        graph,
      );
    }
  }
  return null;
}

/**
 * Lays the poster out around the photo. `null` when neither arrangement fits
 * at this type size.
 */
export function layoutAroundPhoto(
  ctx: Ctx,
  review: YearReview,
  calendar: CalendarGrid,
  frame: Frame,
  zone: Rect,
): Layout | null {
  const { ramp } = ctx;
  const side = besideZone(ctx, frame);
  const upper = Math.min(zone.y, frame.bottom) - frame.top;
  if (frame.right - frame.left <= 0 || frame.right - side <= 0 || upper <= 0) {
    return null;
  }
  const zoned: Zoned = {
    frame,
    zone,
    side,
    upper,
    gap: Math.round((ramp.small * 2) / 3),
    tight: Math.round(ramp.small / 2),
  };
  return (
    abovePhoto(ctx, review, calendar, zoned) ??
    besidePhoto(ctx, review, calendar, zoned)
  );
}
