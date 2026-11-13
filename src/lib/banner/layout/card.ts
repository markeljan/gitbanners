"use no memo";

import { type Block, type Ctx, textLineHeight } from "@/lib/banner/context";
import { compact, type Node, textLine } from "@/lib/banner/draw";
import { type Graph, graphOf } from "@/lib/banner/graph";
import { headingOf } from "@/lib/banner/layout/caption";
import type { Layout } from "@/lib/banner/layout/types";
import {
  type Brand,
  brandOf,
  brandTop,
  fitBrand,
  planBrand,
  planFooter,
} from "@/lib/banner/sections/footer";
import { planHeader, roomBesideName } from "@/lib/banner/sections/header";
import {
  type GridPlan,
  planGrid,
  planLegend,
} from "@/lib/banner/sections/heatmap";
import { SECTION_PLANNERS } from "@/lib/banner/sections/index";
import {
  planTileGrid,
  planTiles,
  tilesThatFit,
} from "@/lib/banner/sections/tiles";
import { statIds, statTiles, type Tile } from "@/lib/banner/stats";
import type { SectionId } from "@/lib/banner/types";

/**
 * README cards: a fixed width, a height that follows the content.
 *
 * Sections stack top to bottom in one column. When the card has a heatmap,
 * the column is exactly as wide as the graph (whole-pixel cells rarely fill
 * the card) and centred, so the header, the tiles and the footer line up with
 * both edges of the graph.
 */

interface Row {
  block: Block;
  /** Space above the row; the first row ignores it. */
  gap: number;
}

/** What one section contributes to the stack. */
interface Item {
  rows: Row[];
  /**
   * The same rows with the brand mark worked into their last line, or `null`
   * when it does not fit there. Only asked of the last item of a card.
   */
  withBrand?: (brand: Brand) => Row[] | null;
}

/** More tiles than this are a grid of their own instead of a row. */
const ROW_TILES = 4;

function gaps(ctx: Ctx) {
  const { small } = ctx.ramp;
  return {
    /** Between sections. */
    row: Math.round(small * 1.5),
    /** Between a block and the quiet line that belongs to it. */
    note: Math.round(small * 1.1),
    /** Between a heading and what it heads. */
    heading: Math.round(small * 0.9),
  };
}

/** A line of text that heads the content under it, set like GitHub's "N contributions in the last year". */
function headingRow(ctx: Ctx, text: string, width: number): Row {
  const size = ctx.ramp.body;
  const line = textLineHeight(size);
  return {
    gap: gaps(ctx).row,
    block: {
      width,
      height: line,
      at: (x, y) =>
        compact([
          textLine({
            x,
            y,
            width,
            text,
            size,
            line,
            color: ctx.palette.colors.text,
          }),
        ]),
    },
  };
}

/** The identity row. Up to four tiles sit beside the name when it leaves them room. */
function headerItem(
  ctx: Ctx,
  width: number,
  tiles: readonly Tile[],
): { item: Item; tookTiles: boolean } {
  const { ramp } = ctx;
  const beside = roomBesideName(ctx, width);
  const merge =
    tiles.length > 0 &&
    tiles.length <= ROW_TILES &&
    tilesThatFit(ctx, tiles, beside) === tiles.length;
  const merged = merge
    ? planTiles(ctx, tiles, { width: beside, align: "right" })
    : null;
  const header = planHeader(ctx, {
    width,
    reserve: merged ? merged.used + ramp.small * 2 : 0,
    bioLines: 2,
  });
  const block: Block = {
    width,
    // Tiles are two lines tall. An identity cut down to its name (no avatar,
    // no second line) is shorter than that, and must not let the next row in.
    height: Math.max(
      header.height,
      merged ? header.titleTop + merged.height : 0,
    ),
    at: (x, y) => [
      ...header.at(x, y),
      ...(merged ? merged.at(x + width - beside, y + header.titleTop) : []),
    ],
  };
  return {
    item: { rows: [{ gap: gaps(ctx).row, block }] },
    tookTiles: merged !== null,
  };
}

/** Tiles in rows of their own: one bare row, or an outlined grid when there are many. */
function tilesItem(ctx: Ctx, width: number, tiles: readonly Tile[]): Item {
  const { ramp } = ctx;
  const gap = gaps(ctx).row;
  if (tiles.length > ROW_TILES) {
    const grid = planTileGrid(ctx, tiles, width);
    return { rows: grid ? [{ gap, block: grid }] : [] };
  }
  const plan = planTiles(ctx, tiles, { width, align: "left", spread: true });
  if (!plan) return { rows: [] };
  return {
    rows: [{ gap, block: plan }],
    withBrand(brand) {
      // Only the full mark, and only with air around it: a squeezed host name
      // beside the last label reads as a fifth tile.
      const room = width - plan.tailX - ramp.small * 3;
      const mark = fitBrand(ctx, brand, room, true);
      if (!mark) return null;
      const block: Block = {
        width,
        height: plan.height,
        at: (x, y) => [
          ...plan.at(x, y),
          ...planBrand(ctx, mark.text, mark.width).at(
            x + width - mark.width,
            y + brandTop(ctx, plan.labelBaseline),
          ),
        ],
      };
      return [{ gap, block }];
    },
  };
}

/**
 * The graph with its labels. On its own it gets GitHub's heading above; under
 * other content the sentence moves to the footer and the header keeps the
 * stage.
 */
function heatmapItem(
  ctx: Ctx,
  grid: GridPlan,
  graph: Graph,
  leads: boolean,
): Item {
  const space = gaps(ctx);
  const { caption } = graph;
  const asHeading = leads && caption !== null;
  const rows = (brand: Brand | null): Row[] => {
    const footer = planFooter(ctx, {
      width: grid.width,
      caption: asHeading ? null : caption,
      legend:
        ctx.hide.has("legend") || !graph.live
          ? null
          : planLegend(ctx, grid.geometry),
      brand,
    });
    return [
      ...(asHeading && caption ? [headingRow(ctx, caption, grid.width)] : []),
      { gap: asHeading ? space.heading : space.row, block: grid },
      ...(footer ? [{ gap: space.note, block: footer }] : []),
    ];
  };
  return { rows: rows(null), withBrand: (brand) => rows(brand) };
}

export function layoutCard(ctx: Ctx, sections: readonly SectionId[]): Layout {
  const { canvas, entity, hide } = ctx;
  const contentWidth = canvas.width - canvas.inset.left - canvas.inset.right;
  const graph = sections.includes("heatmap") ? graphOf(ctx) : null;
  const grid = graph
    ? planGrid(ctx, graph.grid, {
        maxWidth: contentWidth,
        maxHeight: null,
        labels: !hide.has("labels"),
      })
    : null;
  // The graph sets the measure of the whole card.
  const width = grid ? grid.width : contentWidth;
  const left = canvas.inset.left + Math.floor((contentWidth - width) / 2);

  const tiles = sections.includes("stats")
    ? statTiles(entity, statIds(entity, ctx.options), ctx.now)
    : [];
  let tilesPlaced = tiles.length === 0;
  // A custom title heads the first content section when there is no graph
  // to caption.
  let heading = grid ? null : headingOf(ctx);
  const items: Item[] = [];
  const add = (item: Item) => {
    if (item.rows.length === 0) return;
    if (!heading) {
      items.push(item);
      return;
    }
    const head = headingRow(ctx, heading, width);
    heading = null;
    const under = (rows: Row[]): Row[] => [
      head,
      { ...rows[0], gap: gaps(ctx).heading },
      ...rows.slice(1),
    ];
    items.push({
      rows: under(item.rows),
      withBrand: (brand) => {
        const rows = item.withBrand?.(brand);
        return rows ? under(rows) : null;
      },
    });
  };

  for (const id of sections) {
    if (id === "header") {
      const { item, tookTiles } = headerItem(
        ctx,
        width,
        tilesPlaced ? [] : tiles,
      );
      tilesPlaced ||= tookTiles;
      items.push(item);
    } else if (id === "stats") {
      if (!tilesPlaced) add(tilesItem(ctx, width, tiles));
      tilesPlaced = true;
    } else if (id === "heatmap") {
      if (grid && graph) {
        add(heatmapItem(ctx, grid, graph, items.length === 0));
      }
    } else {
      const block = SECTION_PLANNERS[id]?.(ctx, {
        width,
        maxHeight: null,
        compact: 0,
      });
      if (block) {
        const gap = gaps(ctx).row;
        add({
          rows: [{ gap, block }],
          withBrand(brand) {
            const marked = block.withBrand?.(brand);
            return marked ? [{ gap, block: marked }] : null;
          },
        });
      }
    }
  }
  // Nothing to show for this entity: the identity alone is still a banner.
  if (items.length === 0) items.push(headerItem(ctx, width, []).item);

  const brand = brandOf(ctx);
  const rows = items.flatMap((item) => item.rows);
  const lastItem = items[items.length - 1];
  const branded = brand ? (lastItem.withBrand?.(brand) ?? null) : null;
  if (branded) {
    rows.splice(rows.length - lastItem.rows.length, lastItem.rows.length);
    rows.push(...branded);
  } else {
    const mark = fitBrand(ctx, brand, width);
    if (mark) {
      const block = planBrand(ctx, mark.text, mark.width);
      rows.push({
        gap: gaps(ctx).note,
        block: {
          width,
          height: block.height,
          at: (x, y) => block.at(x + width - mark.width, y),
        },
      });
    }
  }

  const nodes: Node[] = [];
  let y = canvas.inset.top;
  rows.forEach((row, index) => {
    if (index > 0) y += row.gap;
    nodes.push(...row.block.at(left, y));
    y += row.block.height;
  });
  return {
    width: canvas.width,
    height: y + canvas.inset.bottom,
    nodes,
    // A placeholder grid is drawn but not reported: there is nothing to animate.
    heatmap:
      grid && graph?.live && rows.some((row) => row.block === grid)
        ? grid.geometry
        : null,
  };
}
