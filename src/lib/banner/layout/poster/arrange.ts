"use no memo";

import type { Rect } from "@/lib/banner/canvas";
import type { Ctx } from "@/lib/banner/context";
import { formatNumber } from "@/lib/banner/format";
import { headingOf } from "@/lib/banner/layout/caption";
import {
  type BrandSlot,
  brandBand,
  footBand,
  headed,
  headerBand,
  heatmapBand,
  sectionBand,
  tileGridBand,
  tileRowBand,
} from "@/lib/banner/layout/poster/bands";
import { bottomOf, fill, gridOf } from "@/lib/banner/layout/poster/fill";
import {
  type Arrangement,
  type Attempt,
  type Band,
  type BandBlock,
  besideZone,
  cellOf,
  type Frame,
  frameOf,
  type Gaps,
  gapsOf,
  type Level,
  type Parts,
  type Region,
} from "@/lib/banner/layout/poster/model";
import {
  avatarSize,
  type HeaderPlan,
  planHeader,
} from "@/lib/banner/sections/header";
import type { GridPlan } from "@/lib/banner/sections/heatmap";
import type { Tile } from "@/lib/banner/stats";
import type { HeatmapGeometry } from "@/lib/banner/types";

/**
 * Arrangements: the ways the bands of a banner can be laid on a fixed
 * canvas. "Rows" stacks them (around the profile-photo zone when there is
 * one); "columns" puts the identity above the zone and everything else
 * beside it.
 */

interface Sequence {
  bands: Band[];
  /** The last band is a detachable line for caption, legend and brand. */
  foot: boolean;
}

/**
 * Bands of the "rows" family, top to bottom. With `merged` the tiles sit in
 * the header instead of at the bottom. `detach` moves the line under the
 * graph into a band of its own, so it can live in another region.
 */
function rowSequence(
  ctx: Ctx,
  parts: Parts,
  level: Level,
  merged: boolean,
  detach: boolean,
  legendOf: () => HeatmapGeometry | null,
): Sequence {
  const tiles = parts.tiles.slice(0, level.tiles);
  const graph = parts.mains.includes("heatmap") ? parts.graph : null;
  const hasGraph = graph !== null;
  const tilesLead = parts.mains.includes("stats");
  const firstMain = parts.mains[0];
  // With a header the total becomes a headline number beside the name, and
  // the "Contributions" tile would only repeat it. A total that is still
  // unknown has no number to print: its message stays under the graph.
  const total =
    parts.header && !merged && !tilesLead && graph?.caption != null
      ? graph.total
      : null;
  const headline = total !== null;
  const headerSlot: Tile[] = merged
    ? [...tiles]
    : total !== null && graph
      ? [
          {
            id: "contributions",
            value: formatNumber(total),
            label: graph.label,
          },
        ]
      : [];
  const bottomTiles =
    merged || tilesLead
      ? []
      : headline
        ? tiles.filter((tile) => tile.id !== "contributions")
        : tiles;
  const graphIsLast = parts.mains[parts.mains.length - 1] === "heatmap";
  const titled = !parts.header && firstMain === "heatmap";
  // Under the graph: its sentence, unless the header or a title already
  // says it. Then only what the number leaves unsaid remains.
  const footCaption = titled
    ? null
    : headline
      ? (graph?.note ?? null)
      : (graph?.caption ?? null);
  // The line under the graph carries the brand when nothing comes after it.
  const graphOwnsFoot = hasGraph && graphIsLast && bottomTiles.length === 0;

  const bands: Band[] = [];
  if (parts.header) bands.push(headerBand(ctx, level, headerSlot));
  parts.mains.forEach((id, index) => {
    // Without a graph to caption, a custom title heads the first section.
    const heading = index === 0 && !hasGraph ? headingOf(ctx) : null;
    if (id === "heatmap") {
      bands.push(
        heatmapBand(ctx, parts, level, {
          title: titled,
          caption: graphOwnsFoot && detach ? null : footCaption,
          legend: !(graphOwnsFoot && detach),
          brand: graphOwnsFoot && !detach,
        }),
      );
    } else if (id === "stats") {
      bands.push(headed(ctx, tileGridBand(ctx, tiles), heading));
    } else {
      bands.push(headed(ctx, sectionBand(ctx, id, level), heading));
    }
  });
  let foot = false;
  if (bottomTiles.length > 0) {
    const slot: BrandSlot = { taken: false };
    bands.push(tileRowBand(ctx, bottomTiles, parts.brand, slot));
    bands.push(brandBand(ctx, parts.brand, slot));
  } else if (graphOwnsFoot && detach) {
    foot = true;
    bands.push(
      footBand(
        ctx,
        footCaption,
        level.legend && !ctx.hide.has("legend") ? legendOf : null,
        parts.brand,
      ),
    );
  } else if (!graphOwnsFoot) {
    bands.push(brandBand(ctx, parts.brand));
  }
  return { bands, foot };
}

/** Rows on a canvas without a zone: one column, spread and centred. */
function attemptOpen(
  ctx: Ctx,
  parts: Parts,
  level: Level,
  frame: Frame,
  merged: boolean,
  gaps: Gaps,
): Attempt | null {
  const sequence = rowSequence(ctx, parts, level, merged, false, () => null);
  const region: Region = {
    x: frame.left,
    width: frame.right - frame.left,
    top: frame.top,
    bottom: frame.bottom,
    align: "left",
    mode: "center",
  };
  const first = fill(sequence.bands, region, gaps);
  if (!first) return null;
  const grid = gridOf(first);
  // A graph that (nearly) spans the canvas sets the measure, so everything
  // lines up with its two edges. A much narrower one would squeeze the rest.
  if (!grid || grid.width >= region.width || grid.width < region.width * 0.85) {
    return { placed: first, grid };
  }
  const measure: Region = {
    ...region,
    x: frame.left + Math.floor((region.width - grid.width) / 2),
    width: grid.width,
  };
  const second = fill(sequence.bands, measure, gaps);
  return second
    ? { placed: second, grid: gridOf(second) }
    : { placed: first, grid };
}

/**
 * Rows around a zone: bands above it span the canvas, bands that reach down
 * beside it keep to its right. Every split point is tried and the one with
 * the largest graph wins (ties go to the split that keeps more above).
 */
function attemptZoned(
  ctx: Ctx,
  parts: Parts,
  level: Level,
  frame: Frame,
  zone: Rect,
  merged: boolean,
  gaps: Gaps,
): Attempt | null {
  const side = besideZone(ctx, frame);
  let best: Attempt | null = null;
  for (const detach of [false, true]) {
    let upperGrid: GridPlan | null = null;
    const sequence = rowSequence(
      ctx,
      parts,
      level,
      merged,
      detach,
      () => upperGrid?.geometry ?? null,
    );
    if (detach && !sequence.foot) continue;
    // Pinned bands go to the canvas corner, which is always beside the zone.
    const flow = sequence.bands.filter((band) => !band.pinned);
    const pinned = sequence.bands.filter((band) => band.pinned);
    const count = flow.length;
    for (let split = count; split >= 0; split--) {
      // A detached foot only makes sense below the graph's region.
      if (detach && split !== count - 1) continue;
      const upper = fill(
        flow.slice(0, split),
        {
          x: frame.left,
          width: frame.right - frame.left,
          top: frame.top,
          bottom: Math.min(zone.y, frame.bottom),
          align: "left",
          mode: "top",
        },
        gaps,
      );
      if (!upper) continue;
      upperGrid = gridOf(upper);
      const lower = fill(
        [...flow.slice(split), ...pinned],
        {
          x: side,
          width: frame.right - side,
          top: bottomOf(upper, frame.top),
          bottom: frame.bottom,
          align: "right",
          mode: "center",
          follows: split > 0,
        },
        gaps,
      );
      if (!lower) continue;
      const attempt: Attempt = {
        placed: [...upper, ...lower],
        grid: upperGrid ?? gridOf(lower),
      };
      if (!best || cellOf(attempt) > cellOf(best)) {
        best = attempt;
      }
    }
  }
  return best;
}

/**
 * Columns: the identity sits above the zone (where the destination shows the
 * profile photo right under it), everything else stacks beside it.
 */
function attemptColumns(
  ctx: Ctx,
  identityCtx: Ctx,
  parts: Parts,
  level: Level,
  frame: Frame,
  zone: Rect,
  gaps: Gaps,
): Attempt | null {
  if (!parts.header) return null;
  const side = besideZone(ctx, frame);
  const cellWidth = zone.x + zone.width - frame.left;
  const cellHeight = zone.y - frame.top;
  // A bio needs a line long enough to say something; the cell above the
  // photo rarely is, and a three-word stub is worse than no bio.
  const avatar = identityCtx.hide.has("avatar") ? 0 : avatarSize(identityCtx);
  const roomForBio = cellWidth - avatar >= identityCtx.ramp.small * 18;
  let header: HeaderPlan | null = null;
  for (
    let lines = level.bio && roomForBio ? 2 : 0;
    lines >= 0 && !header;
    lines--
  ) {
    const plan = planHeader(identityCtx, {
      width: cellWidth,
      reserve: 0,
      bioLines: lines,
    });
    if (plan.height <= cellHeight) header = plan;
  }
  if (!header || cellWidth <= 0) return null;

  const tiles = parts.tiles.slice(0, level.tiles);
  const tilesLead = parts.mains.includes("stats");
  const graphIsLast = parts.mains[parts.mains.length - 1] === "heatmap";
  const bottomTiles = tilesLead ? [] : tiles;
  const graphOwnsFoot = graphIsLast && bottomTiles.length === 0;
  const hasGraph = parts.mains.includes("heatmap");
  const bands: Band[] = parts.mains.map((id, index) => {
    if (id === "heatmap") {
      return heatmapBand(ctx, parts, level, {
        title: false,
        caption: parts.graph?.caption ?? null,
        legend: true,
        brand: graphOwnsFoot,
      });
    }
    const band =
      id === "stats" ? tileGridBand(ctx, tiles) : sectionBand(ctx, id, level);
    return headed(ctx, band, index === 0 && !hasGraph ? headingOf(ctx) : null);
  });
  if (bottomTiles.length > 0) {
    const slot: BrandSlot = { taken: false };
    bands.push(tileRowBand(ctx, bottomTiles, parts.brand, slot));
    bands.push(brandBand(ctx, parts.brand, slot));
  } else if (!graphOwnsFoot) {
    bands.push(brandBand(ctx, parts.brand));
  }
  const column = fill(
    bands,
    {
      x: side,
      width: frame.right - side,
      top: frame.top,
      bottom: frame.bottom,
      align: "right",
      mode: "center",
    },
    gaps,
  );
  if (!column) return null;
  const identity: BandBlock = header;
  return {
    placed: [{ block: identity, x: frame.left, y: frame.top }, ...column],
    grid: gridOf(column),
  };
}

/**
 * One candidate layout. `identityCtx` carries the type scale of the identity
 * cell in the columns arrangement: that cell is as narrow as the profile
 * photo under it, so the name stays at its natural size while the content
 * beside it is free to grow.
 */
export function attempt(
  ctx: Ctx,
  identityCtx: Ctx,
  parts: Parts,
  level: Level,
  arrangement: Arrangement,
  roomy: boolean,
): Attempt | null {
  const frame = frameOf(ctx);
  const gaps = gapsOf(ctx, roomy);
  if (arrangement === "columns") {
    return frame.zone
      ? attemptColumns(ctx, identityCtx, parts, level, frame, frame.zone, gaps)
      : null;
  }
  const merged = arrangement === "merged";
  return frame.zone
    ? attemptZoned(ctx, parts, level, frame, frame.zone, merged, gaps)
    : attemptOpen(ctx, parts, level, frame, merged, gaps);
}
