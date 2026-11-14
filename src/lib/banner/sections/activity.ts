"use no memo";

import {
  type Block,
  boxOf,
  type Ctx,
  lineOf,
  noteLine,
} from "@/lib/banner/context";
import { box, compact, type Node, textLine } from "@/lib/banner/draw";
import { addDays, dateOf, monthName, parseIsoDate } from "@/lib/banner/format";
import {
  activityOf,
  chartStyle,
  commitsCaption,
  commitTotal,
  fullScale,
  levelOf,
  recentWeeks,
  weekStart,
} from "@/lib/banner/graph";
import { shortHex } from "@/lib/banner/palette";
import { type Brand, planFooter } from "@/lib/banner/sections/footer";
import type { RepoActivityWeek } from "@/lib/github/schema";

/**
 * Commit activity as weekly bars: the compact form of the commit calendar,
 * for canvases too narrow for a year of cells, data without weekdays, and
 * presets where the chart supports other content.
 *
 * It is drawn as the calendar collapsed to one row: a bar per week in the
 * heat colour of that week's level, month names along the baseline, and the
 * same sentence underneath. While GitHub is still computing a repository's
 * statistics, pale bars hold its place.
 */

export interface ActivitySpec {
  width: number;
  /** Height the chart may take; `null` when the canvas grows with its content. */
  maxHeight: number | null;
  /** How much height to give up on a fixed canvas, 0 (none) to 2. */
  compact: 0 | 1 | 2;
}

export interface ActivityPlan extends Block {
  /** 0 when the bars have the height they want; rises as they are squeezed. */
  strain: number;
  /** The chart with the brand mark on its caption line, or `null` when the mark does not fit there. */
  withBrand(brand: Brand): Block | null;
}

/** Weeks drawn while the real ones are unknown. */
const PLACEHOLDER_WEEKS = 52;
const WEEK = 7;

/** One bar: its share of the chart height and its heat level (0 = a placeholder or an empty week). */
interface Bar {
  share: number;
  level: number;
}

function barsOf(weeks: readonly RepoActivityWeek[]): Bar[] {
  const counts = weeks.map((week) => week.commits);
  // Heights are honest: the busiest week is the tallest bar. Colours follow
  // the calendar's levels, which top out at the 97th percentile, so a single
  // release week does not leave every other bar in the palest green.
  const scale = fullScale(counts);
  const tallest = Math.max(scale, ...counts);
  return counts.map((count) => ({
    share: count / tallest,
    level: levelOf(count, scale),
  }));
}

/** A calm, obviously synthetic outline: nobody should read it as data. */
function placeholderBars(): Bar[] {
  return Array.from({ length: PLACEHOLDER_WEEKS }, (_, index) => ({
    share: 0.3 + 0.14 * Math.sin(index / 3.4) + 0.08 * Math.sin(index / 1.3),
    level: 0,
  }));
}

/**
 * Month of each week (1-12, by the week's Sunday), or `null` when unknown.
 * Weeks are a week apart by definition, so the dates are counted back from
 * the last one; placeholders count back from today.
 */
function monthsOf(
  ctx: Ctx,
  weeks: readonly RepoActivityWeek[] | null,
  count: number,
): (number | null)[] {
  const today = dateOf(ctx.now);
  const last = weeks
    ? parseIsoDate(weeks[weeks.length - 1]?.week)
    : today
      ? weekStart(today)
      : null;
  return Array.from({ length: count }, (_, index) =>
    last ? addDays(last, -(count - 1 - index) * WEEK).month : null,
  );
}

/** Plans the bars. `null` when this banner draws no bar chart, or it does not fit. */
export function planActivity(
  ctx: Ctx,
  spec: ActivitySpec,
): ActivityPlan | null {
  if (chartStyle(ctx) !== "bars" || spec.width <= 0) return null;
  const { ramp, palette, canvas, hide } = ctx;
  const activity = activityOf(ctx);
  const weeks = activity ? recentWeeks(activity) : null;
  const bars = weeks ? barsOf(weeks) : placeholderBars();
  const total = activity && weeks ? commitTotal(activity, weeks) : null;
  const count = Math.max(1, bars.length);

  // Whole-pixel bars on a whole-pixel pitch; what is left over is split
  // between the two ends, under a baseline that spans the full width.
  const pitch = Math.floor((spec.width + 1) / count);
  if (pitch < 2) return null;
  const gap = Math.max(1, Math.round(pitch * 0.27));
  const bar = pitch - gap;
  const inset = Math.floor((spec.width - (count * pitch - gap)) / 2);
  const radius = Math.min(Math.floor(bar / 2), Math.max(1, ramp.hair * 2));

  const micro = ramp.micro;
  const microLine = lineOf(micro, 1.3);
  const months = monthsOf(ctx, weeks, count);
  const labelled =
    !hide.has("labels") && pitch * 3 >= boxOf(ctx, "May", micro) + micro * 0.4;
  const labelSpace = labelled ? Math.round(micro * 0.35) + microLine : 0;
  const caption = commitsCaption(ctx, total);
  const footGap = Math.round(
    ramp.small * (canvas.chrome === "card" ? 1.1 : 0.7),
  );
  const footSpace = caption ? footGap + noteLine(ctx) : 0;
  const axis = ramp.hair;

  // A card gives the bars five lines of small text; a fixed canvas lets them
  // take the height that is free, up to two fifths of its own (and never a
  // chart taller than it is wide).
  const frame = (canvas.height ?? 0) - canvas.inset.top - canvas.inset.bottom;
  const wanted =
    spec.maxHeight === null
      ? Math.round(ramp.small * 5)
      : Math.round(
          Math.min(spec.width * 0.5, frame * 0.42) / (1 + spec.compact * 0.4),
        );
  const least = Math.round(ramp.small * 2.5);
  const room =
    spec.maxHeight === null
      ? wanted
      : spec.maxHeight - axis - labelSpace - footSpace;
  if (room < least) return null;
  const chart = Math.min(wanted, room);
  const lowest = Math.max(2, ramp.hair * 2);
  const heat = palette.colors.heat.map(shortHex);
  // Placeholders are drawn in the empty-cell colour. On the themes where
  // that is the background itself, the surface colour keeps them visible.
  const pale =
    heat[0] === shortHex(palette.colors.bg)
      ? shortHex(palette.colors.surface)
      : heat[0];

  const draw = (x: number, y: number, brand: Brand | null): Node[] => {
    const nodes: (Node | null)[] = [];
    const base = y + chart;
    bars.forEach((item, index) => {
      if (!(item.share > 0)) return;
      const height = Math.max(lowest, Math.round(item.share * chart));
      nodes.push(
        box(x + inset + index * pitch, base - height, bar, height, {
          backgroundColor: (item.level > 0 && heat[item.level]) || pale,
          borderTopLeftRadius: radius,
          borderTopRightRadius: radius,
        }),
      );
    });
    nodes.push(
      box(x, base, spec.width, axis, {
        backgroundColor: palette.colors.border,
      }),
    );
    if (labelled) {
      let previous: number | null = null;
      let free = 0;
      months.forEach((month, index) => {
        if (month === null || month === previous) return;
        // The first column only names its month when the month starts there
        // or has room: a year that begins in its last week would label a
        // single bar.
        const starts = previous !== null || months[index + 2] === month;
        previous = month;
        const label = monthName(month);
        const width = boxOf(ctx, label, micro);
        const left = inset + index * pitch;
        if (!starts || left < free || left + width > spec.width) return;
        free = left + width + Math.round(micro * 0.4);
        nodes.push(
          textLine({
            x: x + left,
            y: base + axis + Math.round(micro * 0.35),
            width,
            text: label,
            size: micro,
            line: microLine,
            color: palette.colors.muted,
          }),
        );
      });
    }
    const footer = planFooter(ctx, {
      width: spec.width,
      caption,
      legend: null,
      brand,
    });
    if (footer) nodes.push(...footer.at(x, base + axis + labelSpace + footGap));
    return compact(nodes);
  };

  const height = chart + axis + labelSpace + footSpace;
  return {
    width: spec.width,
    height,
    at: (x, y) => draw(x, y, null),
    strain: Math.max(0, (wanted - chart) / wanted),
    withBrand(brand) {
      // Without a caption there is no line for the mark to share.
      if (!caption) return null;
      return { width: spec.width, height, at: (x, y) => draw(x, y, brand) };
    },
  };
}
