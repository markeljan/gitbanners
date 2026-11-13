"use no memo";

import {
  type Block,
  boxOf,
  type Ctx,
  textLineHeight,
  titleLine,
} from "@/lib/banner/context";
import {
  CAP_HEIGHT,
  capOffset,
  compact,
  icon,
  type Node,
  type TextRun,
  textLine,
} from "@/lib/banner/draw";
import {
  addDays,
  formatDateRange,
  formatNumber,
  parseIsoDate,
  toIsoDate,
} from "@/lib/banner/format";
import { ICONS } from "@/lib/banner/icons";
import type { User } from "@/lib/github/schema";

/**
 * Current and longest contribution streak, each as a number with its dates.
 *
 * The data layer only sees the calendar range, so the longest streak is the
 * longest *in that range*. The label says so: people compare this card with
 * tools that count all-time streaks.
 */

interface Figure {
  value: string;
  /** Follows the number on its line, in the muted colour. */
  label: string;
  /** Second line: the dates. */
  detail: string;
  flame: boolean;
  /** Whether the flame burns (a live streak) or is just an outline in muted. */
  lit: boolean;
}

/** "in the last 12 months", or "in 2025" for a calendar-year banner. */
function rangePhrase(year: number | null): string {
  return year ? `in ${year}` : "in the last 12 months";
}

function figures(ctx: Ctx, user: User): Figure[] {
  const { streak } = user;
  const start = parseIsoDate(streak.currentStart);
  const currentEnd =
    start && streak.current > 0
      ? toIsoDate(addDays(start, streak.current - 1))
      : null;
  return [
    {
      value: formatNumber(streak.current),
      label: "day streak",
      detail:
        streak.current > 0
          ? formatDateRange(streak.currentStart, currentEnd)
          : "No contributions today or yesterday",
      flame: true,
      lit: streak.current > 0,
    },
    {
      value: formatNumber(streak.longest),
      label: `longest ${rangePhrase(ctx.options.year)}`,
      detail:
        streak.longest > 0
          ? formatDateRange(streak.longestStart, streak.longestEnd)
          : "No contributions yet",
      flame: false,
      lit: false,
    },
  ];
}

export interface StreakSpec {
  width: number;
  /** Height the figures may take; `null` when the canvas grows with its content. */
  maxHeight: number | null;
}

/**
 * Plans the two streak figures: side by side, or one above the other when
 * the box is too narrow for both. Users only; `null` when they do not fit.
 */
export function planStreak(ctx: Ctx, spec: StreakSpec): Block | null {
  const { entity, ramp, palette } = ctx;
  if (entity.kind !== "user" || spec.width <= 0) return null;
  const items = figures(ctx, entity);

  const valueSize = ramp.title;
  const valueLine = titleLine(valueSize);
  const labelSize = ramp.body;
  const detailSize = ramp.small;
  const detailLine = textLineHeight(detailSize);
  const detailTop = valueLine + ramp.lead;
  // The flame is as tall as the digits beside it and sits on their baseline.
  const flame = Math.round(valueSize * CAP_HEIGHT * 1.12);
  const flameGap = Math.round(valueSize * 0.2);
  const spacing = ramp.small * 4;

  const measured = items.map((item) => {
    const indent = item.flame ? flame + flameGap : 0;
    const value = boxOf(ctx, item.value, valueSize, ramp.strong);
    const label = boxOf(ctx, ` ${item.label}`, labelSize);
    const detail = boxOf(ctx, item.detail, detailSize);
    return { indent, natural: indent + Math.max(value + label, detail) };
  });
  const rowHeight = detailTop + detailLine;
  const rowGap = Math.round(ramp.small * 1.2);
  const [first, second] = measured;
  // Two even columns when both fit, the second right after the first when
  // only that fits, otherwise two rows.
  const half = Math.floor(spec.width / 2);
  const stacked = first.natural + spacing + second.natural > spec.width;
  const secondStart = stacked
    ? 0
    : Math.min(
        Math.max(half, first.natural + spacing),
        spec.width - second.natural,
      );
  const places = [
    { x: 0, y: 0, room: stacked ? spec.width : secondStart - spacing },
    {
      x: secondStart,
      y: stacked ? rowHeight + rowGap : 0,
      room: spec.width - secondStart,
    },
  ];
  const height = stacked ? 2 * rowHeight + rowGap : rowHeight;
  if (spec.maxHeight !== null && height > spec.maxHeight) return null;

  const at = (x: number, y: number): Node[] => {
    const nodes: (Node | null)[] = [];
    items.forEach((item, index) => {
      const place = places[index];
      const left = x + place.x;
      const top = y + place.y;
      const room = place.room;
      const indent = measured[index].indent;
      const text: TextRun[] = [
        {
          text: item.value,
          weight: ramp.strong,
          color: palette.colors.text,
        },
        {
          text: ` ${item.label}`,
          size: labelSize,
          weight: 400,
          color: palette.colors.muted,
        },
      ];
      if (item.flame) {
        nodes.push(
          icon(
            ICONS.flame,
            left,
            top +
              Math.round(
                capOffset(valueSize, valueLine) +
                  (valueSize * CAP_HEIGHT - flame) / 2,
              ),
            flame,
            item.lit ? palette.warning : palette.colors.muted,
          ),
        );
      }
      nodes.push(
        textLine({
          x: left + indent,
          y: top,
          width: Math.max(0, room - indent),
          text,
          size: valueSize,
          line: valueLine,
          color: palette.colors.text,
        }),
        textLine({
          x: left + indent,
          y: top + detailTop,
          width: Math.max(0, room - indent),
          text: item.detail,
          size: detailSize,
          line: detailLine,
          color: palette.colors.muted,
        }),
      );
    });
    return compact(nodes);
  };

  return { width: spec.width, height, at };
}
