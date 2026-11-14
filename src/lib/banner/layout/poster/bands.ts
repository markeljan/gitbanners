"use no memo";

import {
  boxOf,
  type Ctx,
  finePrint,
  noteLine,
  textLineHeight,
  titleLine,
} from "@/lib/banner/context";
import { compact, type TextRun, textLine } from "@/lib/banner/draw";
import { formatNumber } from "@/lib/banner/format";
import type { Graph } from "@/lib/banner/graph";
import {
  type Band,
  type BandBlock,
  type Level,
  MEASURE_SHARE,
  MIN_CELL,
  type Parts,
} from "@/lib/banner/layout/poster/model";
import {
  type Brand,
  brandTop,
  fitBrand,
  planBrand,
  planFooter,
} from "@/lib/banner/sections/footer";
import { planHeader, roomBesideName } from "@/lib/banner/sections/header";
import { planGrid, planLegend } from "@/lib/banner/sections/heatmap";
import { SECTION_PLANNERS } from "@/lib/banner/sections/index";
import {
  planTiles,
  type TilesPlan,
  tilesThatFit,
  tilesThatPack,
} from "@/lib/banner/sections/tiles";
import type { Tile } from "@/lib/banner/stats";
import type { HeatmapGeometry, SectionId } from "@/lib/banner/types";

/**
 * Bands: the pieces a fixed canvas is stacked from. Each one sizes itself
 * for the box it is offered and answers `null` when it cannot be shown there.
 */

/**
 * Lines a bio may take on a fixed canvas. A person's bio is a tagline and
 * gets one; the description of a repository or an organization says what
 * the banner is about, and gets the two it has on github.com.
 */
function posterBioLines(ctx: Ctx): number {
  return ctx.entity.kind === "user" ? 1 : 2;
}

/** The identity row, optionally with tiles or the headline total on its right. */
export function headerBand(
  ctx: Ctx,
  level: Level,
  slot: readonly Tile[],
): Band {
  return {
    plan(width, maxHeight) {
      const { ramp } = ctx;
      // The name keeps the room it wants unless the slot then has none.
      const beside =
        [false, true]
          .map((squeeze) => roomBesideName(ctx, width, squeeze))
          .find((room) => tilesThatFit(ctx, slot, room) === slot.length) ?? 0;
      let tiles: TilesPlan | null = null;
      if (slot.length > 0) {
        if (tilesThatFit(ctx, slot, beside) < slot.length) return null;
        tiles = planTiles(ctx, slot, { width: beside, align: "right" });
      }
      const header = planHeader(ctx, {
        width,
        reserve: tiles ? tiles.used + ramp.small * 2 : 0,
        bioLines: level.bio ? posterBioLines(ctx) : 0,
      });
      // Tiles are two lines tall: an identity cut down to its name is not.
      const height = Math.max(
        header.height,
        tiles ? header.titleTop + tiles.height : 0,
      );
      // Every line box has to fit, not only the ink the height is measured
      // by: under the box there may be a profile photo.
      if (Math.max(height, header.extent) > maxHeight) return null;
      return {
        width,
        height,
        strain: header.strain,
        at: (x, y) => [
          ...header.at(x, y),
          ...(tiles ? tiles.at(x + width - beside, y + header.titleTop) : []),
        ],
      };
    },
  };
}

/** "1,364 contributions in the last year" as a headline, for graphs that stand alone. */
function titleRuns(ctx: Ctx, graph: Graph): TextRun[] {
  const { ramp, palette } = ctx;
  const strong = { weight: ramp.strong, color: palette.colors.text };
  if (ctx.options.title || graph.total === null || graph.total <= 0) {
    return [{ text: graph.caption ?? "", ...strong }];
  }
  return [
    { text: formatNumber(graph.total), ...strong },
    {
      text: ` ${graph.label}`,
      size: ramp.body,
      weight: 400,
      color: palette.colors.muted,
    },
  ];
}

interface HeatmapBandSpec {
  /** Print the caption as a headline above the graph. */
  title: boolean;
  /** The line to print under the graph, on the left; `null` for none. */
  caption: string | null;
  /** Put the legend under the graph (when the level keeps one). */
  legend: boolean;
  /** Put the brand mark on the line under the graph. */
  brand: boolean;
}

/** The graph with whatever belongs to it: headline above, legend line below. */
export function heatmapBand(
  ctx: Ctx,
  parts: Parts,
  level: Level,
  spec: HeatmapBandSpec,
): Band {
  return {
    flex: true,
    plan(width, maxHeight, align) {
      const { ramp, hide } = ctx;
      const graph = parts.graph;
      if (!graph) return null;
      const title = spec.title && graph.caption ? titleRuns(ctx, graph) : null;
      const titleHeight = titleLine(ramp.title);
      const titleSpace = title ? titleHeight + Math.round(ramp.small * 0.6) : 0;
      const legend =
        spec.legend && level.legend && graph.live && !hide.has("legend");
      const caption = spec.caption;
      const brand = spec.brand ? parts.brand : null;
      const footerGap = Math.round(ramp.small * 0.7);
      const footerSpace =
        legend || caption || brand ? noteLine(ctx) + footerGap : 0;
      const grid = planGrid(ctx, graph.grid, {
        maxWidth: width,
        maxHeight: maxHeight - titleSpace - footerSpace,
        labels: level.labels && !hide.has("labels"),
      });
      if (!grid || grid.fit.cell < MIN_CELL) return null;
      // Under a graph that sets the measure the line is as wide as the
      // graph. Under a much narrower one (a low canvas limits the cells) it
      // spans the column instead, so the mark ends at the same right edge
      // as everything else rather than somewhere under the graph.
      const spans =
        align === "left" &&
        footerSpace > 0 &&
        grid.width < width * MEASURE_SHARE;
      const footer = footerSpace
        ? planFooter(ctx, {
            width: spans ? width : grid.width,
            caption,
            legend: legend ? planLegend(ctx, grid.geometry) : null,
            brand,
          })
        : null;
      return {
        width: footer && spans ? width : grid.width,
        height: titleSpace + grid.height + (footer ? footerSpace : 0),
        grid,
        at: (x, y) =>
          compact([
            title
              ? textLine({
                  x,
                  y,
                  width: grid.width,
                  text: title,
                  size: ramp.title,
                  line: titleHeight,
                  color: ctx.palette.colors.text,
                })
              : null,
            ...grid.at(x, y + titleSpace),
            ...(footer
              ? footer.at(x, y + titleSpace + grid.height + footerGap)
              : []),
          ]),
      };
    },
  };
}

/**
 * Shared by a tile row and the brand line that follows it: the row reports
 * whether the mark found room on its label line, and the line only appears
 * when it did not.
 */
export interface BrandSlot {
  taken: boolean;
}

const NOTHING: BandBlock = { width: 0, height: 0, at: () => [] };

/** Tiles in one row, with the brand mark on their label line when it fits there. */
export function tileRowBand(
  ctx: Ctx,
  tiles: readonly Tile[],
  brand: Brand | null,
  slot: BrandSlot,
): Band {
  return {
    plan(width, maxHeight) {
      const { ramp } = ctx;
      slot.taken = false;
      if (tilesThatPack(ctx, tiles, width) < tiles.length) return null;
      // The tiles move a little closer if that lets the mark share their
      // line: for the full mark first, then for the host alone. They do not
      // tighten for a mark that would not fit even then.
      const spacing = ramp.small * 2;
      const row = (keepFree: number) =>
        planTiles(ctx, tiles, { width, align: "left", packed: true, keepFree });
      const texts = brand ? [...new Set([brand.full, brand.short])] : [];
      let plan: TilesPlan | null = null;
      let mark: { text: string; width: number } | null = null;
      for (const text of texts) {
        const needed = boxOf(ctx, text, finePrint(ctx));
        const tight = row(needed + spacing);
        if (tight && needed <= width - tight.tailX - spacing) {
          plan = tight;
          mark = { text, width: needed };
          break;
        }
      }
      plan ??= row(0);
      if (!plan || plan.height > maxHeight) return null;
      slot.taken = mark !== null;
      return {
        width,
        height: plan.height,
        at: (x, y) => [
          ...plan.at(x, y),
          ...(mark
            ? planBrand(ctx, mark.text, mark.width).at(
                x + width - mark.width,
                y + brandTop(ctx, plan.labelBaseline),
              )
            : []),
        ],
      };
    },
  };
}

/** The brand mark alone in the bottom-right corner, unless `slot` says it already has a place. */
export function brandBand(
  ctx: Ctx,
  brand: Brand | null,
  slot?: BrandSlot,
): Band {
  return {
    pinned: true,
    plan(width, maxHeight) {
      if (slot?.taken) return NOTHING;
      const mark = fitBrand(ctx, brand, width);
      if (!mark) return NOTHING;
      const block = planBrand(ctx, mark.text, mark.width);
      return block.height <= maxHeight ? block : null;
    },
  };
}

/** Tiles as the main content: as many columns as stay readable, spread over the width. */
export function tileGridBand(ctx: Ctx, tiles: readonly Tile[]): Band {
  return {
    plan(width, maxHeight) {
      const counts = Array.from(
        { length: tiles.length },
        (_, i) => tiles.length - i,
      );
      // Full rows first (4 + 4, not 5 + 3); ragged ones only when nothing else fits.
      const even = counts.filter((columns) => tiles.length % columns === 0);
      for (const columns of [...even, ...counts]) {
        if (tilesThatFit(ctx, tiles.slice(0, columns), width) < columns)
          continue;
        const plan = planTiles(ctx, tiles, {
          width,
          align: "left",
          columns,
          spread: true,
        });
        if (plan && plan.height <= maxHeight) return plan;
      }
      return null;
    },
  };
}

/**
 * The line that belongs under the graph (caption, legend, brand mark) as a
 * band of its own, for when the graph sits above the zone and the line has to
 * go beside it.
 */
export function footBand(
  ctx: Ctx,
  caption: string | null,
  legendOf: (() => HeatmapGeometry | null) | null,
  brand: Brand | null,
): Band {
  return {
    plan(width, maxHeight) {
      const geometry = legendOf?.() ?? null;
      const footer = planFooter(ctx, {
        width,
        caption,
        legend: geometry ? planLegend(ctx, geometry) : null,
        brand,
      });
      return footer && footer.height <= maxHeight ? footer : null;
    },
  };
}

/** Puts a custom title above a band, as its heading. */
export function headed(ctx: Ctx, band: Band, heading: string | null): Band {
  if (!heading) return band;
  const { ramp } = ctx;
  const line = textLineHeight(ramp.body);
  const space = line + Math.round(ramp.small * 0.6);
  const under = (block: BandBlock | null): BandBlock | null =>
    block && {
      ...block,
      height: space + block.height,
      at: (x, y) =>
        compact([
          textLine({
            x,
            y,
            width: block.width,
            text: heading,
            size: ramp.body,
            line,
            weight: ramp.strong,
            color: ctx.palette.colors.text,
          }),
          ...block.at(x, y + space),
        ]),
    };
  const { fit } = band;
  return {
    ...band,
    plan: (width, maxHeight) => under(band.plan(width, maxHeight - space)),
    ...(fit
      ? { fit: (width, height) => under(fit(width, height - space)) }
      : null),
  };
}

/** The brand mark and the slot that says whether a band found room for it. */
export interface BrandTail {
  brand: Brand | null;
  slot: BrandSlot;
}

/**
 * A content section as a band. With `leads` (the banner has no graph, so
 * this section is what it is about) the section may also be asked to fill
 * the height its region has left. With `tail` (the section is the last
 * thing on the banner) it carries the brand mark on its own last line when
 * it has one to share, and says so through the slot.
 */
export function sectionBand(
  ctx: Ctx,
  id: SectionId,
  level: Level,
  leads: boolean,
  tail?: BrandTail,
): Band {
  const planner = SECTION_PLANNERS[id];
  const plan = (
    width: number,
    maxHeight: number,
    stretch: boolean,
  ): BandBlock | null => {
    const block =
      planner?.(ctx, { width, maxHeight, compact: level.compact, stretch }) ??
      null;
    if (!tail) return block;
    tail.slot.taken = false;
    const marked =
      block && tail.brand ? (block.withBrand?.(tail.brand) ?? null) : null;
    if (!block || !marked) return block;
    tail.slot.taken = true;
    return { ...marked, strain: block.strain };
  };
  return {
    plan: (width, maxHeight) => plan(width, maxHeight, false),
    ...(leads ? { fit: (width, height) => plan(width, height, true) } : null),
  };
}
