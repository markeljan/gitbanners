"use no memo";

import {
  type Block,
  boxOf,
  type Ctx,
  lineOf,
  titleLine,
} from "@/lib/banner/context";
import {
  baselineOffset,
  box,
  CAP_HEIGHT,
  capOffset,
  compact,
  type Node,
  textLine,
} from "@/lib/banner/draw";
import { fitFontSize } from "@/lib/banner/metrics";
import { sparkline } from "@/lib/banner/sections/sparkline";
import type { Tile } from "@/lib/banner/stats";

/**
 * Stat tiles: a number (600) over its label (muted). A single row is bare
 * type (the numbers are the graphic); a grid of several rows gets outlined
 * boxes, the way GitHub frames its own cards, so it reads as one object.
 *
 * The figures are Mona Sans' default ones on purpose. Its tabular set swaps
 * in a slashed zero, which reads as code and is not how github.com prints
 * its counters.
 */

export interface TilesSpec {
  /** Width the tiles may use. */
  width: number;
  /**
   * `left`: columns start at the left edge (rows of their own).
   * `right`: columns end at the right edge (beside a name, as in a header).
   */
  align: "left" | "right";
  /** Tiles per row. Defaults to all of them in one row. */
  columns?: number;
  /** Spread the columns over the whole width instead of keeping them close. */
  spread?: boolean;
  /** Free width to keep after the last tile's label, for something that shares its line. */
  keepFree?: number;
  /**
   * When even columns do not fit a single left-aligned row, set every tile
   * as wide as its own text with even gaps instead (see `tilesThatPack`). One
   * long label ("Open pull requests") then no longer costs a whole tile.
   */
  packed?: boolean;
}

export interface TilesPlan extends Block {
  /** Width the columns really cover, measured from the side they are aligned to. */
  used: number;
  /** Baseline of the labels of the last row, relative to the block's top. */
  labelBaseline: number;
  /** Where free space starts on that line, from the block's left edge. */
  tailX: number;
}

interface TileMetrics {
  valueSize: number;
  valueLine: number;
  labelSize: number;
  labelLine: number;
  /** Height of one tile. */
  height: number;
  /** Widest value or label. */
  content: number;
  /** Narrowest and preferred distance between two column starts. */
  minPitch: number;
  pitch: number;
}

function measure(ctx: Ctx, tiles: readonly Tile[]): TileMetrics {
  const { ramp } = ctx;
  const valueSize = ramp.title;
  const labelSize = ramp.small;
  const valueLine = titleLine(valueSize);
  const labelLine = lineOf(labelSize, 1.4);
  let content = 0;
  for (const tile of tiles) {
    content = Math.max(
      content,
      boxOf(ctx, tile.value, valueSize, ramp.strong),
      boxOf(ctx, tile.label, labelSize),
    );
  }
  // Posters are read from far away and want more air between numbers.
  const air = ctx.canvas.chrome === "card" ? 3 : 4.5;
  return {
    valueSize,
    valueLine,
    labelSize,
    labelLine,
    height: valueLine + ramp.lead + labelLine,
    content,
    minPitch: content + Math.round(labelSize * 1.5),
    pitch: content + Math.round(labelSize * air),
  };
}

/**
 * The trend line of a tile, sized to the digits it sits beside: as tall as
 * their capitals, about two digits wide. It is only drawn where the tile has
 * free room on its value line (`room`), on the side away from the edge the
 * column holds on to. It never asks for room: a tile row is laid out as if
 * it were not there, so it can come and go without moving anything.
 */
function trendOf(
  ctx: Ctx,
  tile: Tile,
  place: {
    /** Left edge of the value text. */
    valueX: number;
    valueWidth: number;
    /** Top of the value's line box. */
    top: number;
    size: number;
    line: number;
    /** Free width beside the value. */
    room: number;
    side: "before" | "after";
  },
): Node | null {
  if (!tile.trend) return null;
  const height = Math.round(place.size * CAP_HEIGHT);
  const gap = Math.round(place.size * 0.4);
  // Up to two digits wide; a little narrower when that is all there is.
  const width = Math.min(Math.round(place.size * 1.9), place.room - gap);
  if (width < Math.round(place.size * 1.3)) return null;
  return sparkline({
    values: tile.trend,
    x:
      place.side === "after"
        ? place.valueX + place.valueWidth + gap
        : place.valueX - gap - width,
    y: place.top + Math.round(capOffset(place.size, place.line)),
    width,
    height,
    color: ctx.palette.success,
    stroke: Math.max(1.5, Math.round(place.size / 1.4) / 10),
  });
}

/** True when the tiles fit `width` side by side in columns of one width. */
function fitEvenly(metrics: TileMetrics, count: number, width: number) {
  return (count - 1) * metrics.minPitch + metrics.content <= width;
}

/** How many of `tiles`, taken from the front, fit side by side in `width`. */
export function tilesThatFit(
  ctx: Ctx,
  tiles: readonly Tile[],
  width: number,
): number {
  for (let count = tiles.length; count > 0; count--) {
    if (fitEvenly(measure(ctx, tiles.slice(0, count)), count, width)) {
      return count;
    }
  }
  return 0;
}

/** Width each tile needs for its own number and label. */
function ownWidths(
  ctx: Ctx,
  tiles: readonly Tile[],
  metrics: TileMetrics,
): number[] {
  return tiles.map((tile) =>
    Math.max(
      boxOf(ctx, tile.value, metrics.valueSize, ctx.ramp.strong),
      boxOf(ctx, tile.label, metrics.labelSize),
    ),
  );
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * How many of `tiles`, taken from the front, fit one row of `width` when
 * each may be as wide as its own text (`TilesSpec.packed`). Never fewer than
 * `tilesThatFit`: even columns are still what a row uses when they fit.
 */
export function tilesThatPack(
  ctx: Ctx,
  tiles: readonly Tile[],
  width: number,
): number {
  for (let count = tiles.length; count > 0; count--) {
    const shown = tiles.slice(0, count);
    const metrics = measure(ctx, shown);
    if (fitEvenly(metrics, count, width)) return count;
    const gap = metrics.minPitch - metrics.content;
    if (sum(ownWidths(ctx, shown, metrics)) + (count - 1) * gap <= width) {
      return count;
    }
  }
  return 0;
}

/**
 * Plans the tiles for a box. Returns `null` when there is nothing to show.
 * The caller is expected to have trimmed the list with `tilesThatFit` when a
 * single row is wanted; whatever still does not fit shrinks its number.
 */
export function planTiles(
  ctx: Ctx,
  tiles: readonly Tile[],
  spec: TilesSpec,
): TilesPlan | null {
  if (tiles.length === 0 || spec.width <= 0) return null;
  const { ramp, palette } = ctx;
  const metrics = measure(ctx, tiles);
  const columns = Math.max(
    1,
    Math.min(spec.columns ?? tiles.length, tiles.length),
  );
  const rows = Math.ceil(tiles.length / columns);
  const lastLabel = tiles[tiles.length - 1]?.label ?? "";
  const lastWidth = boxOf(ctx, lastLabel, metrics.labelSize);
  // Columns move closer together (never below the minimum pitch) to leave
  // `keepFree` on the label line after the last tile.
  const widest = Math.max(
    metrics.minPitch,
    Math.floor(
      Math.min(
        spec.width - metrics.content,
        spec.width - (spec.keepFree ?? 0) - lastWidth,
      ) / Math.max(1, columns - 1),
    ),
  );
  const even = Math.floor(spec.width / columns);
  const pitch =
    columns === 1
      ? spec.width
      : spec.spread
        ? even
        : Math.max(1, Math.min(metrics.pitch, widest));
  const evenSlot = Math.max(
    1,
    columns === 1
      ? spec.width
      : Math.min(pitch - Math.round(ramp.small), spec.width),
  );
  const rowGap = Math.round(ramp.small * 1.6);
  const lastRowCount = tiles.length - (rows - 1) * columns;
  // Even columns by default. A single left-aligned row that is too narrow
  // for them may be packed instead: every tile as wide as its own text.
  const own =
    spec.packed &&
    spec.align === "left" &&
    !spec.spread &&
    rows === 1 &&
    columns > 1 &&
    !fitEvenly(metrics, columns, spec.width)
      ? ownWidths(ctx, tiles, metrics)
      : null;
  const before = own ? sum(own.slice(0, -1)) : 0;
  const packedGap = own
    ? Math.max(
        metrics.minPitch - metrics.content,
        Math.min(
          metrics.pitch - metrics.content,
          Math.floor(
            Math.min(
              spec.width - sum(own),
              spec.width - (spec.keepFree ?? 0) - lastWidth - before,
            ) /
              (columns - 1),
          ),
        ),
      )
    : 0;
  /** Offset of a column's left edge (packed) or of the edge it holds on to. */
  const startOf = (col: number) =>
    own ? sum(own.slice(0, col)) + col * packedGap : col * pitch;
  /** Width a column's number and label may take. */
  const slotOf = (col: number) => own?.[col] ?? evenSlot;
  const lastCol = lastRowCount - 1;
  const used =
    startOf(columns - 1) + Math.min(slotOf(columns - 1), metrics.content);
  const labelTop =
    (rows - 1) * (metrics.height + rowGap) + metrics.valueLine + ramp.lead;

  const at = (x: number, y: number): Node[] => {
    const nodes: (Node | null)[] = [];
    tiles.forEach((tile, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const slot = slotOf(col);
      // The edge the column holds on to: its left side, or its right one.
      const edge =
        spec.align === "left"
          ? x + startOf(col)
          : x + spec.width - startOf(columns - 1 - col);
      const top = y + row * (metrics.height + rowGap);
      // A long value (a release tag) shrinks before it is cut.
      const size = fitFontSize(tile.value, slot, metrics.valueSize, ramp.body, {
        weight: ramp.strong,
        mono: ctx.font.id === "mono",
      });
      // Boxes are only as wide as their text, so nothing beside a tile (the
      // name, the brand mark) ever shares a pixel with it.
      const valueWidth = Math.min(
        slot,
        boxOf(ctx, tile.value, size, ramp.strong),
      );
      const labelWidth = Math.min(
        slot,
        boxOf(ctx, tile.label, metrics.labelSize),
      );
      const leftOf = (width: number) =>
        spec.align === "left" ? edge : edge - width;
      nodes.push(
        trendOf(ctx, tile, {
          valueX: leftOf(valueWidth),
          valueWidth,
          top,
          size,
          line: metrics.valueLine,
          room: slot - valueWidth,
          side: spec.align === "left" ? "after" : "before",
        }),
        textLine({
          x: leftOf(valueWidth),
          y: top,
          width: valueWidth,
          text: tile.value,
          size,
          line: metrics.valueLine,
          weight: ramp.strong,
          color: palette.colors.text,
          align: spec.align,
        }),
        textLine({
          x: leftOf(labelWidth),
          y: top + metrics.valueLine + ramp.lead,
          width: labelWidth,
          text: tile.label,
          size: metrics.labelSize,
          line: metrics.labelLine,
          color: palette.colors.muted,
          align: spec.align,
        }),
      );
    });
    return compact(nodes);
  };

  return {
    width: spec.align === "left" && !spec.spread ? used : spec.width,
    height: rows * metrics.height + (rows - 1) * rowGap,
    at,
    used,
    labelBaseline:
      labelTop + baselineOffset(metrics.labelSize, metrics.labelLine),
    tailX:
      spec.align === "left"
        ? startOf(lastCol) + Math.min(slotOf(lastCol), lastWidth)
        : spec.width,
  };
}

/** Most columns of an outlined grid: more, and the boxes turn into a strip. */
const GRID_COLUMNS = 4;

/**
 * Plans the tiles as a grid of outlined boxes that spans `width`: for cards
 * whose content is their numbers. Rows are balanced (4 + 4, 3 + 3, 4 + 3) and
 * every box is wide enough for its text. Returns `null` when there is
 * nothing to show.
 */
export function planTileGrid(
  ctx: Ctx,
  tiles: readonly Tile[],
  width: number,
): Block | null {
  if (tiles.length === 0 || width <= 0) return null;
  const { ramp, palette } = ctx;
  const metrics = measure(ctx, tiles);
  const gap = ramp.small;
  const padX = Math.round(ramp.small * 1.17);
  const padY = Math.round(ramp.small * 0.9);
  const widest = Math.max(
    1,
    Math.floor((width + gap) / (metrics.content + 2 * padX + gap)),
  );
  const rows = Math.ceil(tiles.length / Math.min(GRID_COLUMNS, widest));
  const columns = Math.ceil(tiles.length / rows);
  const boxWidth = Math.floor((width - (columns - 1) * gap) / columns);
  const boxHeight = 2 * padY + metrics.height;
  const inner = Math.max(1, boxWidth - 2 * padX);

  return {
    width,
    height: rows * boxHeight + (rows - 1) * gap,
    at(x, y) {
      const nodes: (Node | null)[] = [];
      tiles.forEach((tile, index) => {
        const left = x + (index % columns) * (boxWidth + gap);
        const top = y + Math.floor(index / columns) * (boxHeight + gap);
        const valueWidth = Math.min(
          inner,
          boxOf(ctx, tile.value, metrics.valueSize, ramp.strong),
        );
        nodes.push(
          box(left, top, boxWidth, boxHeight, {
            borderRadius: ramp.radius,
            border: `${ramp.hair}px solid ${palette.colors.border}`,
          }),
          trendOf(ctx, tile, {
            valueX: left + padX,
            valueWidth,
            top: top + padY,
            size: metrics.valueSize,
            line: metrics.valueLine,
            room: inner - valueWidth,
            side: "after",
          }),
          textLine({
            x: left + padX,
            y: top + padY,
            width: tile.trend ? valueWidth : inner,
            text: tile.value,
            size: metrics.valueSize,
            line: metrics.valueLine,
            weight: ramp.strong,
            color: palette.colors.text,
          }),
          textLine({
            x: left + padX,
            y: top + padY + metrics.valueLine + ramp.lead,
            width: inner,
            text: tile.label,
            size: metrics.labelSize,
            line: metrics.labelLine,
            color: palette.colors.muted,
          }),
        );
      });
      return compact(nodes);
    },
  };
}
