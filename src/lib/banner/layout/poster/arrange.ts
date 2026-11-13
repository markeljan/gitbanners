"use no memo";

import type { Rect } from "@/lib/banner/canvas";
import type { Ctx } from "@/lib/banner/context";
import { formatNumber } from "@/lib/banner/format";
import { headingOf } from "@/lib/banner/layout/caption";
import {
  type BrandSlot,
  type BrandTail,
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
  MEASURE_SHARE,
  type Parts,
  type Placed,
  type Region,
} from "@/lib/banner/layout/poster/model";
import {
  avatarSize,
  type HeaderPlan,
  identityWidth,
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
  const tail = tailOf(parts, bottomTiles.length > 0);

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
      const last = index === parts.mains.length - 1;
      bands.push(
        headed(
          ctx,
          sectionBand(ctx, id, level, !hasGraph, last ? tail : undefined),
          heading,
        ),
      );
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
    bands.push(brandBand(ctx, parts.brand, tail?.slot));
  }
  return { bands, foot };
}

/**
 * The slot for the brand mark on the last line of the last content section,
 * for banners that end with one (no tile row after it, and not the graph or
 * the tile grid, which place the mark themselves).
 */
function tailOf(parts: Parts, tilesFollow: boolean): BrandTail | undefined {
  const last = parts.mains[parts.mains.length - 1];
  if (tilesFollow || !last || last === "heatmap" || last === "stats") {
    return undefined;
  }
  return { brand: parts.brand, slot: { taken: false } };
}

/**
 * The region narrowed to the graph's width, holding on to the side the
 * region is aligned to (centred when `centre` is set). `null` when the graph
 * already spans the region or is too narrow to set its measure.
 */
function measureOf(
  region: Region,
  grid: GridPlan | null,
  centre = false,
): Region | null {
  if (
    !grid ||
    grid.width >= region.width ||
    grid.width < region.width * MEASURE_SHARE
  ) {
    return null;
  }
  const spare = region.width - grid.width;
  const x = centre
    ? region.x + Math.floor(spare / 2)
    : region.align === "right"
      ? region.x + spare
      : region.x;
  return { ...region, x, width: grid.width };
}

/**
 * Stacks the bands in the region, then once more at the graph's measure
 * when it has one (see `measureOf`). The narrower column is only kept when
 * it costs the graph nothing.
 */
function fillMeasured(
  bands: readonly Band[],
  region: Region,
  gaps: Gaps,
  centre = false,
): Placed[] | null {
  const first = fill(bands, region, gaps);
  if (!first) return null;
  const grid = gridOf(first);
  const measure = measureOf(region, grid, centre);
  const second = measure ? fill(bands, measure, gaps) : null;
  const narrowed = second ? gridOf(second) : null;
  return second &&
    narrowed &&
    grid &&
    narrowed.fit.cell >= grid.fit.cell &&
    narrowed.width === grid.width
    ? second
    : first;
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
  // A graph that (nearly) spans the canvas sets the measure, so everything
  // lines up with its two edges.
  const placed = fillMeasured(sequence.bands, region, gaps, true);
  return placed ? { placed, grid: gridOf(placed) } : null;
}

/**
 * Orders of the content sections worth trying around a zone: the one asked
 * for, and, on a banner without an identity row, the graph first. The graph
 * is the only band that can use the full width above the photo; with the
 * streak figures or other content above it, it would be squeezed into what
 * they leave. The search keeps whichever order gives the larger graph.
 */
function orderings(parts: Parts): Parts[] {
  const at = parts.mains.indexOf("heatmap");
  if (parts.header || at <= 0) return [parts];
  const others = parts.mains.filter((id) => id !== "heatmap");
  return [parts, { ...parts, mains: ["heatmap", ...others] }];
}

/** Most height a graph gives back, in steps of a third of the small type size. */
const GIVE_BACK_STEPS = 12;

/**
 * One split of the bands around a zone: `above` spans the canvas over the
 * zone, `beside` continues to its right.
 *
 * A graph above the zone takes all the height there is, down to the zone's
 * top edge, which can leave what follows a few pixels short beside it. The
 * graph then gives height back in small steps until the rest fits: a graph
 * one cell size smaller with its numbers under it beats a full-size one
 * that pushed them out of the banner. `onUpperGrid` hears which graph the
 * upper region drew before the lower one is planned (its legend may be
 * drawn there).
 */
function aroundZone(
  ctx: Ctx,
  above: readonly Band[],
  beside: readonly Band[],
  frame: Frame,
  zone: Rect,
  side: number,
  gaps: Gaps,
  onUpperGrid: (grid: GridPlan | null) => void,
): Attempt | null {
  const zoneTop = Math.min(zone.y, frame.bottom);
  /** Both regions with the upper one ending `cut` pixels above the zone. */
  const split = (cut: number): Attempt | "graph" | null => {
    const upper = fill(
      above,
      {
        x: frame.left,
        width: frame.right - frame.left,
        top: frame.top,
        bottom: zoneTop - cut,
        align: "left",
        mode: "top",
      },
      gaps,
    );
    if (!upper) return null;
    const upperGrid = gridOf(upper);
    onUpperGrid(upperGrid);
    const lower = fillMeasured(
      beside,
      {
        x: side,
        width: frame.right - side,
        top: bottomOf(upper, frame.top),
        bottom: frame.bottom,
        align: "right",
        mode: "center",
        follows: above.length > 0,
      },
      gaps,
    );
    if (lower) {
      return { placed: [...upper, ...lower], grid: upperGrid ?? gridOf(lower) };
    }
    // Only a graph has height to give back.
    return upperGrid ? "graph" : null;
  };

  const whole = split(0);
  if (whole !== "graph") return whole;
  // Would giving back the most allowed be enough? If not, no smaller cut is.
  const step = Math.max(1, Math.round(ctx.ramp.small / 3));
  let high = GIVE_BACK_STEPS;
  let best = split(high * step);
  if (best === null || best === "graph") return null;
  // The smallest cut that works keeps the graph largest: more room below
  // never hurts, so the answer can be bisected.
  let low = 0;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    const attempt = split(middle * step);
    if (attempt === null || attempt === "graph") {
      low = middle;
    } else {
      high = middle;
      best = attempt;
    }
  }
  // The legend of the winner is the one the lower region must show.
  onUpperGrid(best.grid);
  return best;
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
  const options = orderings(parts).flatMap((ordered) =>
    [false, true].map((detach) => ({ ordered, detach })),
  );
  for (const { ordered, detach } of options) {
    let upperGrid: GridPlan | null = null;
    const sequence = rowSequence(
      ctx,
      ordered,
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
      const attempt = aroundZone(
        ctx,
        flow.slice(0, split),
        [...flow.slice(split), ...pinned],
        frame,
        zone,
        side,
        gaps,
        (grid) => {
          upperGrid = grid;
        },
      );
      if (attempt && (!best || cellOf(attempt) > cellOf(best))) {
        best = attempt;
      }
    }
  }
  return best;
}

/** How much of its size a name may give up to fit the cell above the photo. */
const IDENTITY_STRAIN = 0.12;
/** Most of the canvas width the identity cell may take from the content beside it. */
const IDENTITY_SHARE = 0.42;

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
  // The cell is at least as wide as the photo under it, and wider for a
  // name that needs more (`owner/repository` usually does): the content
  // column then starts further right instead of the name getting smaller.
  const full = frame.right - frame.left;
  const overZone = zone.x + zone.width - frame.left;
  const cellWidth = Math.max(
    overZone,
    Math.min(identityWidth(identityCtx), Math.round(full * IDENTITY_SHARE)),
  );
  const side =
    cellWidth > overZone
      ? Math.max(
          besideZone(ctx, frame),
          frame.left + cellWidth + identityCtx.ramp.small * 2,
        )
      : besideZone(ctx, frame);
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
    if (Math.max(plan.height, plan.extent) <= cellHeight) header = plan;
  }
  if (!header || cellWidth <= 0) return null;

  const tiles = parts.tiles.slice(0, level.tiles);
  const tilesLead = parts.mains.includes("stats");
  const graphIsLast = parts.mains[parts.mains.length - 1] === "heatmap";
  const bottomTiles = tilesLead ? [] : tiles;
  const graphOwnsFoot = graphIsLast && bottomTiles.length === 0;
  const hasGraph = parts.mains.includes("heatmap");
  const tail = tailOf(parts, bottomTiles.length > 0);
  const bands: Band[] = parts.mains.map((id, index) => {
    if (id === "heatmap") {
      return heatmapBand(ctx, parts, level, {
        title: false,
        caption: parts.graph?.caption ?? null,
        legend: true,
        brand: graphOwnsFoot,
      });
    }
    const last = index === parts.mains.length - 1;
    const band =
      id === "stats"
        ? tileGridBand(ctx, tiles)
        : sectionBand(ctx, id, level, !hasGraph, last ? tail : undefined);
    return headed(ctx, band, index === 0 && !hasGraph ? headingOf(ctx) : null);
  });
  if (bottomTiles.length > 0) {
    const slot: BrandSlot = { taken: false };
    bands.push(tileRowBand(ctx, bottomTiles, parts.brand, slot));
    bands.push(brandBand(ctx, parts.brand, slot));
  } else if (!graphOwnsFoot) {
    bands.push(brandBand(ctx, parts.brand, tail?.slot));
  }
  const column = fillMeasured(
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
    // A name that has to shrink visibly or be cut even in the widest cell
    // belongs on a line of its own: the rows arrangement gives it the whole
    // width, and is preferred when it fits everything too.
    cramped: header.strain > IDENTITY_STRAIN,
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
