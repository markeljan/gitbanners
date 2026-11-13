"use no memo";

import {
  type Block,
  boxOf,
  type Ctx,
  lineOf,
  titleLine,
} from "@/lib/banner/context";
import { compact, type Node, textLine } from "@/lib/banner/draw";
import { formatDay, formatNumber, parseIsoDate } from "@/lib/banner/format";
import { fitFontSize } from "@/lib/banner/metrics";
import type { YearReview } from "@/lib/banner/review";

/**
 * What stood out in the year, as a grid of values over their labels: longest
 * streak, best day, active days, busiest month and weekday.
 */

/** One fact of the year: a value over its label. */
interface Fact {
  value: string;
  /** A shorter value for narrow columns: "Oct" for "October". */
  short?: string;
  /** Labels to try, the most telling first. */
  labels: readonly string[];
}

/** Facts of the year, the most telling first. */
function factsOf(review: YearReview): Fact[] {
  const facts: Fact[] = [];
  if (review.streak) {
    const { days } = review.streak;
    facts.push({
      value: `${formatNumber(days)} ${days === 1 ? "day" : "days"}`,
      labels: ["Longest streak", "Streak"],
    });
  }
  if (review.bestDay) {
    const date = parseIsoDate(review.bestDay.date);
    facts.push({
      value: formatNumber(review.bestDay.count),
      labels: date
        ? [`Best day, ${formatDay(date)}`, "Best day"]
        : ["Best day"],
    });
  }
  if (review.activeDays > 0) {
    facts.push({
      value: formatNumber(review.activeDays),
      labels: ["Active days", "Active"],
    });
  }
  if (review.busiestMonth) {
    facts.push({
      value: review.busiestMonth.name,
      short: review.busiestMonth.short,
      labels: ["Busiest month", "Top month"],
    });
  }
  if (review.busiestWeekday) {
    facts.push({
      value: review.busiestWeekday.name,
      short: review.busiestWeekday.short,
      labels: ["Busiest weekday", "Busiest day", "Top day"],
    });
  }
  return facts;
}

/**
 * One more fact, for grids that would otherwise end on a half-empty row:
 * contributions per day over the whole range.
 */
function spareFact(review: YearReview): Fact | null {
  if (review.days <= 0) return null;
  const average = review.total / review.days;
  // Under one a day the average says nothing the total does not.
  if (average < 1) return null;
  return {
    value: average >= 10 ? formatNumber(average) : average.toFixed(1),
    labels: ["Daily average", "Per day"],
  };
}

export interface FactsSpec {
  width: number;
  /** Most facts side by side. */
  columns: number;
  /** Most rows; facts that do not fit them are left out, the last ones first. */
  rows: number;
}

/**
 * The year's facts in even columns: longest streak, best day, active days,
 * busiest month and weekday. All values of the grid share one size, so a
 * long one ("Wednesday") makes the whole row a little smaller instead of
 * standing out; where even that is too tight, month and weekday use their
 * three-letter forms. `null` for a year with nothing to say.
 */
export function planFacts(
  ctx: Ctx,
  review: YearReview,
  spec: FactsSpec,
): Block | null {
  const { ramp, palette } = ctx;
  const told = factsOf(review);
  if (told.length === 0 || spec.width <= 0) return null;
  // A column needs room for a short value and its label.
  const widest = Math.max(1, Math.floor(spec.width / (ramp.small * 7)));
  const most = Math.max(1, Math.min(spec.columns, widest));
  const rows = Math.max(1, Math.min(spec.rows, Math.ceil(told.length / most)));
  // A last row that is one short of full gets the spare fact.
  const spare = told.length % most === most - 1 ? spareFact(review) : null;
  const all = rows > 1 && spare ? [...told, spare] : told;
  const facts = all.slice(0, most * rows);
  // Balanced rows: 3 + 2, not 4 + 1.
  const columns = Math.ceil(facts.length / rows);
  const pitch = Math.floor(spec.width / columns);
  const slot = Math.max(1, pitch - Math.round((ramp.small * 2) / 3));
  // Values are words in display type ("September", "Tuesday"): closer
  // together than about three quarters of their size they read as one
  // phrase, so they keep more distance than the small labels under them.
  const valueSlot = Math.max(
    1,
    Math.min(slot, pitch - Math.round(ramp.title * 0.75)),
  );
  const fitting = { weight: ramp.strong, mono: ctx.font.id === "mono" };
  // Full names while the row loses no more than a tenth of its size to them.
  const fits = (text: string) =>
    fitFontSize(text, valueSlot, ramp.title, ramp.body, fitting) >=
    ramp.title * 0.9;
  const long = facts.every((fact) => fits(fact.value));
  const values = facts.map((fact) =>
    long ? fact.value : (fact.short ?? fact.value),
  );
  const size = Math.min(
    ...values.map((value) =>
      fitFontSize(value, valueSlot, ramp.title, ramp.body, fitting),
    ),
  );
  const labelSize = ramp.small;
  const valueLine = titleLine(size);
  const labelLine = lineOf(labelSize, 1.4);
  const rowHeight = valueLine + ramp.lead + labelLine;
  const rowGap = Math.round(ramp.small * 1.3);

  return {
    width: spec.width,
    height: rows * rowHeight + (rows - 1) * rowGap,
    at(x, y) {
      const nodes: (Node | null)[] = [];
      facts.forEach((fact, index) => {
        const left = x + (index % columns) * pitch;
        const top = y + Math.floor(index / columns) * (rowHeight + rowGap);
        const value = values[index] ?? fact.value;
        const label =
          fact.labels.find((text) => boxOf(ctx, text, labelSize) <= slot) ??
          fact.labels[fact.labels.length - 1] ??
          "";
        nodes.push(
          textLine({
            x: left,
            y: top,
            width: Math.min(valueSlot, boxOf(ctx, value, size, ramp.strong)),
            text: value,
            size,
            line: valueLine,
            weight: ramp.strong,
            color: palette.colors.text,
          }),
          textLine({
            x: left,
            y: top + valueLine + ramp.lead,
            width: Math.min(slot, boxOf(ctx, label, labelSize)),
            text: label,
            size: labelSize,
            line: labelLine,
            color: palette.colors.muted,
          }),
        );
      });
      return compact(nodes);
    },
  };
}
