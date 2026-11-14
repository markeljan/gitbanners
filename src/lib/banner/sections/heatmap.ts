"use no memo";

import type { CalendarGrid } from "@/lib/banner/calendar";
import {
  type Block,
  boxOf,
  type Ctx,
  finePrint,
  lineOf,
  noteLine,
} from "@/lib/banner/context";
import { box, compact, type Node, textLine } from "@/lib/banner/draw";
import { shortHex } from "@/lib/banner/palette";
import { fitHeatmap, type HeatmapFit } from "@/lib/banner/sizes";
import type { HeatmapGeometry } from "@/lib/banner/types";

/**
 * The contribution calendar, drawn the way github.com draws it: week columns
 * with Sunday on top, month names above, Mon / Wed / Fri on the left.
 */

const ROWS = 7;
const WEEKDAYS = [
  { row: 1, label: "Mon" },
  { row: 3, label: "Wed" },
  { row: 5, label: "Fri" },
] as const;

export interface GridPlan extends Block {
  /** What the animation post-processor needs to find the cells again. */
  geometry: HeatmapGeometry;
  fit: HeatmapFit;
  /** Whether month and weekday labels are drawn. */
  labelled: boolean;
  /** Number of bands the year is wrapped into (1 = GitHub's single strip). */
  bands: number;
}

export interface GridBox {
  maxWidth: number;
  /** `null`: only the width limits the cell size. */
  maxHeight: number | null;
  /** Ask for month and weekday labels; they are dropped when they do not suit the cell size. */
  labels: boolean;
}

/**
 * Labels belong next to cells of about their own size: GitHub sets 12 px
 * labels beside 10 px cells. Beside much smaller cells they would shout, and
 * a weekday label must fit the two rows it can occupy.
 */
function labelsSuit(micro: number, fit: HeatmapFit): boolean {
  return (
    micro <= fit.cell * 1.3 && lineOf(micro, 1.2) <= 2 * fit.cell + fit.gap
  );
}

/** One way of drawing the calendar in a box. */
interface Shape {
  fit: HeatmapFit;
  bands: number;
  /** Week columns per band. */
  perBand: number;
  /** Width of the weekday label column, 0 without labels. */
  gutter: number;
  /** Height of the month label row above each band, 0 without labels. */
  monthRow: number;
  /** Space between two bands. */
  bandGap: number;
  width: number;
  height: number;
}

/** A wrapped calendar must be this much larger to be worth leaving GitHub's familiar strip... */
const WRAP_GAIN = 1.3;
/** ...and still span this share of the width: a narrow lump leaves half the canvas empty. */
const WRAP_FILL = 0.85;
/** On cards (no height limit) the strip is only wrapped when its cells get this small... */
const WRAP_BELOW = 7;
/** ...and only until they are this large again: a card should not grow without need. */
const WRAP_UNTIL = 10;
const MAX_BANDS = 4;

function shapeOf(
  ctx: Ctx,
  cols: number,
  space: GridBox,
  bands: number,
  labelled: boolean,
): Shape | null {
  const { ramp } = ctx;
  const micro = ramp.micro;
  const perBand = Math.ceil(cols / bands);
  const gutter = labelled
    ? Math.max(...WEEKDAYS.map((day) => boxOf(ctx, day.label, micro))) +
      Math.round(micro * 0.7)
    : 0;
  const monthRow = labelled ? lineOf(micro, 1.3) + Math.round(micro * 0.45) : 0;
  const bandGap = labelled
    ? Math.round(micro * 0.8)
    : Math.round(ramp.small * 0.9);
  const heightLimit =
    space.maxHeight === null
      ? Number.POSITIVE_INFINITY
      : (space.maxHeight - (bands - 1) * bandGap) / bands - monthRow;
  if (heightLimit <= 0 || space.maxWidth - gutter <= 0) return null;
  const fit = fitHeatmap(space.maxWidth - gutter, heightLimit, perBand, ROWS);
  if (fit.width > space.maxWidth - gutter || fit.height > heightLimit)
    return null;
  if (labelled && !labelsSuit(micro, fit)) return null;
  return {
    fit,
    bands,
    perBand,
    gutter,
    monthRow,
    bandGap,
    width: gutter + fit.width,
    height: bands * (monthRow + fit.height) + (bands - 1) * bandGap,
  };
}

/**
 * Picks how to draw the calendar: GitHub's single strip whenever it is big
 * enough, otherwise the year wrapped into two to four bands (half years,
 * thirds, quarters) so the cells stay legible on narrow cards and fill tall
 * posters. Labels are kept when they suit the cell size.
 */
function chooseShape(ctx: Ctx, cols: number, space: GridBox): Shape | null {
  const best = (bands: number) =>
    (space.labels ? shapeOf(ctx, cols, space, bands, true) : null) ??
    shapeOf(ctx, cols, space, bands, false);
  let chosen = best(1);
  if (space.maxHeight === null) {
    // A card grows with every band, so it takes the fewest that make the
    // cells comfortable again.
    if ((chosen?.fit.cell ?? 0) > WRAP_BELOW) return chosen;
    for (let bands = 2; bands <= MAX_BANDS; bands++) {
      const wrapped = best(bands);
      if (wrapped && wrapped.fit.cell > (chosen?.fit.cell ?? 0))
        chosen = wrapped;
      if ((chosen?.fit.cell ?? 0) >= WRAP_UNTIL) break;
    }
    return chosen;
  }
  // A fixed canvas has the height anyway: wrap whenever it clearly pays.
  for (let bands = 2; bands <= MAX_BANDS; bands++) {
    const wrapped = best(bands);
    if (!wrapped) continue;
    const worthIt =
      wrapped.fit.cell >= (chosen?.fit.cell ?? 0) * WRAP_GAIN &&
      wrapped.width >= space.maxWidth * WRAP_FILL;
    if (!chosen || worthIt) chosen = wrapped;
  }
  return chosen;
}

/** Month labels of one band that fit: one that would run into the next, or past the grid, is left out. */
function monthLabels(
  ctx: Ctx,
  grid: CalendarGrid,
  from: number,
  to: number,
  pitch: number,
  gridWidth: number,
): { x: number; width: number; label: string }[] {
  const { micro } = ctx.ramp;
  const placed = grid.months
    .filter((month) => month.col >= from && month.col < to)
    .map((month) => ({
      x: (month.col - from) * pitch,
      width: boxOf(ctx, month.label, micro),
      label: month.label,
    }));
  return placed.filter((item, index) => {
    const next = placed[index + 1];
    const limit = next ? next.x - Math.round(micro * 0.4) : gridWidth + 2;
    return item.x + item.width <= limit;
  });
}

/**
 * Sizes the calendar for a box and returns it as a block, or `null` when not
 * even the smallest cells fit. The cell size is the largest
 * GitHub-proportioned one that fits; labels are added only when they suit it.
 */
export function planGrid(
  ctx: Ctx,
  grid: CalendarGrid,
  space: GridBox,
): GridPlan | null {
  const { ramp, palette } = ctx;
  const shape = chooseShape(ctx, grid.cols, space);
  if (!shape) return null;
  const { fit, gutter, monthRow, perBand } = shape;
  const { cell, gap, radius } = fit;
  const micro = ramp.micro;
  const microLine = lineOf(micro, 1.3);
  const pitch = cell + gap;
  const heat = palette.colors.heat.map(shortHex);
  const stroke = cell >= 5 ? palette.heatBorder : null;
  const strokeWidth = Math.max(1, Math.min(ramp.hair, Math.floor(cell / 4)));

  const drawCell = (cx: number, cy: number, level: number): Node[] => {
    const fill = heat[level] ?? heat[0];
    if (!stroke) {
      // Exactly this shape (a plain square, one radius, one fill, no border)
      // is what the animation post-processor looks for.
      return [
        box(cx, cy, cell, cell, {
          borderRadius: radius,
          backgroundColor: fill,
        }),
      ];
    }
    // Stroked cells are a ring plus an inset fill on purpose: neither piece
    // has the shape above, so they are never animated half-way.
    const ring = box(cx, cy, cell, cell, {
      borderRadius: radius,
      border: `${strokeWidth}px solid ${stroke}`,
    });
    if (level === 0) return [ring];
    const inner = cell - 2 * strokeWidth;
    return [
      ring,
      box(cx + strokeWidth, cy + strokeWidth, inner, inner, {
        borderRadius: Math.max(0, radius - strokeWidth),
        backgroundColor: fill,
      }),
    ];
  };

  const at = (x: number, y: number): Node[] => {
    const nodes: (Node | null)[] = [];
    for (let band = 0; band < shape.bands; band++) {
      const from = band * perBand;
      const to = Math.min(grid.cols, from + perBand);
      const top = y + band * (monthRow + fit.height + shape.bandGap);
      const gx = x + gutter;
      const gy = top + monthRow;
      if (gutter > 0) {
        for (const month of monthLabels(
          ctx,
          grid,
          from,
          to,
          pitch,
          fit.width,
        )) {
          nodes.push(
            textLine({
              x: gx + month.x,
              y: top,
              width: month.width,
              text: month.label,
              size: micro,
              line: microLine,
              color: palette.colors.muted,
            }),
          );
        }
        for (const day of WEEKDAYS) {
          nodes.push(
            textLine({
              x,
              y: gy + day.row * pitch + Math.round((cell - microLine) / 2),
              width: gutter,
              text: day.label,
              size: micro,
              line: microLine,
              color: palette.colors.muted,
            }),
          );
        }
      }
      for (let col = from; col < to; col++) {
        grid.levels[col]?.forEach((level, row) => {
          if (level === null) return;
          nodes.push(
            ...drawCell(gx + (col - from) * pitch, gy + row * pitch, level),
          );
        });
      }
    }
    return compact(nodes);
  };

  return {
    width: shape.width,
    height: shape.height,
    at,
    geometry: { cell, radius, gap, colors: heat, cells: grid.cells },
    fit,
    labelled: gutter > 0,
    bands: shape.bands,
  };
}

/**
 * Legend swatches: close to the cell size, but never equal to it, and never
 * taller than the line they sit on (a calendar of a few weeks on a large
 * canvas has cells the size of tiles).
 */
function swatchSize(cell: number, textSize: number, line: number): number {
  const size = Math.min(line, Math.max(cell - 1, Math.round(textSize * 0.55)));
  // A swatch with the cell's exact shape would be animated as if it were a day.
  if (size !== cell) return size;
  return size < line ? size + 1 : size - 1;
}

/** "Less ▢▢▢▢▢ More", as under GitHub's own graph. */
export function planLegend(ctx: Ctx, geometry: HeatmapGeometry): Block {
  const { ramp, palette } = ctx;
  const size = finePrint(ctx);
  const line = noteLine(ctx);
  const swatch = swatchSize(geometry.cell, size, line);
  const swatchGap = Math.max(2, Math.round(swatch * 0.3));
  const textGap = Math.round(size * 0.55);
  const less = boxOf(ctx, "Less", size);
  const more = boxOf(ctx, "More", size);
  const swatches = 5 * swatch + 4 * swatchGap;
  const stroke = swatch >= 5 ? palette.heatBorder : null;
  return {
    width: less + textGap + swatches + textGap + more,
    height: line,
    at(x, y) {
      const sy = y + Math.round((line - swatch) / 2);
      const sx = x + less + textGap;
      const label = (text: string, lx: number, width: number) =>
        textLine({
          x: lx,
          y,
          width,
          text,
          size,
          line,
          color: palette.colors.muted,
        });
      return compact([
        label("Less", x, less),
        ...geometry.colors.map((color, index) =>
          box(sx + index * (swatch + swatchGap), sy, swatch, swatch, {
            borderRadius: Math.max(1, Math.round(swatch * 0.2)),
            backgroundColor: color,
            ...(stroke ? { border: `${ramp.hair}px solid ${stroke}` } : null),
          }),
        ),
        label("More", sx + swatches + textGap, more),
      ]);
    },
  };
}
