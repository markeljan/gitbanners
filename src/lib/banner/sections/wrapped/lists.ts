"use no memo";

import {
  type Block,
  boxOf,
  type Ctx,
  lineOf,
  textLineHeight,
} from "@/lib/banner/context";
import { box, compact, type Node, textLine } from "@/lib/banner/draw";
import { formatNumber } from "@/lib/banner/format";
import type { YearReview } from "@/lib/banner/review";
import { sharesOf } from "@/lib/banner/sections/languages";

/**
 * Where the year's work went: top repositories and top languages, as a line
 * each (landscape canvases, cards) or as small tables (squares).
 */

/** One entry of a list: a repository or a language. */
export interface ListEntry {
  name: string;
  /** What goes with the name: a share, a count. */
  note: string;
  /** Colour of the dot in front of the name (languages). */
  dot?: string;
}

function percent(value: number): string {
  return `${Math.round(value)}%`;
}

/** The user's top languages, largest first. Colours are Linguist's. */
export function languageEntries(ctx: Ctx, count: number): ListEntry[] {
  return sharesOf(ctx, count)
    .slice(0, count)
    .map((share) => ({
      name: share.name,
      note: percent(share.percent),
      dot: share.color,
    }));
}

/** The repositories the year's commits went to, most first, with their commit counts. */
export function repoEntries(review: YearReview, count: number): ListEntry[] {
  return review.topRepos.slice(0, count).map((repo) => ({
    name: repo.name,
    note: formatNumber(repo.commits),
  }));
}

/** A planned list line, with how many of its entries found room. */
export interface ListLine extends Block {
  shown: number;
}

export interface ListLineSpec {
  width: number;
  /** "Top languages" */
  label: string;
  /** Width of the label column, so two lines start their entries together. */
  labelWidth: number;
  entries: readonly ListEntry[];
  /** Print the notes ("46%"); names alone otherwise. */
  notes: boolean;
}

/** Width of the label column for list lines with these labels. */
export function listLabelWidth(ctx: Ctx, labels: readonly string[]): number {
  const size = ctx.ramp.small;
  return (
    Math.max(0, ...labels.map((label) => boxOf(ctx, label, size))) +
    Math.round(size)
  );
}

/**
 * A list on one line: its label, then whole entries while they fit. `null`
 * when not even the first entry fits.
 */
export function planListLine(ctx: Ctx, spec: ListLineSpec): ListLine | null {
  const { ramp, palette } = ctx;
  const size = ramp.small;
  const line = lineOf(size, 1.4);
  const dot = Math.round(size * 0.8);
  const dotGap = Math.round(size * 0.45);
  const noteGap = Math.round(size * 0.4);
  const entryGap = Math.round(size * 1.1);
  const placed: { entry: ListEntry; x: number; name: number; note: number }[] =
    [];
  let cursor = spec.labelWidth;
  for (const entry of spec.entries) {
    const lead = entry.dot ? dot + dotGap : 0;
    const name = boxOf(ctx, entry.name, size, 500);
    const note = spec.notes && entry.note ? boxOf(ctx, entry.note, size) : 0;
    const own = lead + name + (note ? noteGap + note : 0);
    if (cursor + own > spec.width) break;
    placed.push({ entry, x: cursor, name, note });
    cursor += own + entryGap;
  }
  if (placed.length === 0) return null;
  return {
    width: spec.width,
    height: line,
    shown: placed.length,
    at(x, y) {
      const nodes: (Node | null)[] = [
        textLine({
          x,
          y,
          width: spec.labelWidth,
          text: spec.label,
          size,
          line,
          color: palette.colors.muted,
        }),
      ];
      for (const item of placed) {
        const lead = item.entry.dot ? dot + dotGap : 0;
        if (item.entry.dot) {
          nodes.push(
            box(x + item.x, y + Math.round((line - dot) / 2), dot, dot, {
              borderRadius: dot / 2,
              backgroundColor: item.entry.dot,
            }),
          );
        }
        nodes.push(
          textLine({
            x: x + item.x + lead,
            y,
            width: item.name,
            text: item.entry.name,
            size,
            line,
            weight: 500,
            color: palette.colors.text,
          }),
          item.note
            ? textLine({
                x: x + item.x + lead + item.name + noteGap,
                y,
                width: item.note,
                text: item.entry.note,
                size,
                line,
                color: palette.colors.muted,
              })
            : null,
        );
      }
      return compact(nodes);
    },
  };
}

export interface ListColumnSpec {
  width: number;
  /** "Top repositories" */
  heading: string;
  /** What the notes count ("commits"), printed once above them. */
  unit?: string;
  entries: readonly ListEntry[];
}

/**
 * A list as a small table: its heading, then one entry per row with the note
 * at the right edge. For canvases with height to spare (squares).
 */
export function planListColumn(ctx: Ctx, spec: ListColumnSpec): Block | null {
  const { ramp, palette } = ctx;
  if (spec.entries.length === 0 || spec.width <= 0) return null;
  const headSize = ramp.small;
  const headLine = lineOf(headSize, 1.4);
  const size = ramp.body;
  const line = textLineHeight(size);
  const rowGap = Math.round(ramp.small * 0.25);
  const top = headLine + Math.round(ramp.small * 0.4);
  const dot = Math.round(size * 0.8);
  const dotGap = Math.round(size * 0.45);
  return {
    width: spec.width,
    height:
      top + spec.entries.length * line + (spec.entries.length - 1) * rowGap,
    at(x, y) {
      const unit = spec.unit ? boxOf(ctx, spec.unit, headSize) : 0;
      const nodes: (Node | null)[] = [
        textLine({
          x,
          y,
          width: spec.width - unit - (unit ? headSize : 0),
          text: spec.heading,
          size: headSize,
          line: headLine,
          color: palette.colors.muted,
        }),
        spec.unit
          ? textLine({
              x: x + spec.width - unit,
              y,
              width: unit,
              text: spec.unit,
              size: headSize,
              line: headLine,
              color: palette.colors.muted,
              align: "right",
            })
          : null,
      ];
      spec.entries.forEach((entry, index) => {
        const rowTop = y + top + index * (line + rowGap);
        const lead = entry.dot ? dot + dotGap : 0;
        const note = Math.min(
          boxOf(ctx, entry.note, size),
          Math.floor(spec.width / 2),
        );
        const room = spec.width - lead - note - Math.round(size * 0.8);
        if (entry.dot) {
          nodes.push(
            box(x, rowTop + Math.round((line - dot) / 2), dot, dot, {
              borderRadius: dot / 2,
              backgroundColor: entry.dot,
            }),
          );
        }
        nodes.push(
          textLine({
            x: x + lead,
            y: rowTop,
            width: Math.max(
              0,
              Math.min(room, boxOf(ctx, entry.name, size, 500)),
            ),
            text: entry.name,
            size,
            line,
            weight: 500,
            color: palette.colors.text,
          }),
          textLine({
            x: x + spec.width - note,
            y: rowTop,
            width: note,
            text: entry.note,
            size,
            line,
            color: palette.colors.muted,
            align: "right",
          }),
        );
      });
      return compact(nodes);
    },
  };
}
