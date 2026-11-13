"use no memo";

import type { Ctx } from "@/lib/banner/context";
import { formatNumber } from "@/lib/banner/format";
import type { User } from "@/lib/github/schema";

/** "the last year", or the calendar year a banner was asked for. */
function period(year: number | null): string {
  return year ? String(year) : "the last year";
}

/** The label that goes with the contribution total: "contributions in the last year". */
export function totalLabel(ctx: Ctx): string {
  return ctx.options.title ?? `contributions in ${period(ctx.options.year)}`;
}

/**
 * A custom title as the heading of a banner that has no graph to caption
 * (with a graph, the title replaces its caption instead). `null` when there
 * is none or titles are hidden.
 */
export function headingOf(ctx: Ctx): string | null {
  return ctx.hide.has("title") ? null : ctx.options.title;
}

/**
 * The sentence under (or above) the graph: "4,015 contributions in the last
 * year". A custom title replaces it, `hide=title` removes it, and an empty
 * calendar says so instead of printing a lonely zero.
 */
export function captionOf(ctx: Ctx, user: User): string | null {
  if (ctx.hide.has("title")) return null;
  if (ctx.options.title) return ctx.options.title;
  const total = user.calendar?.total ?? 0;
  if (!(total > 0)) {
    return `No public contributions in ${period(ctx.options.year)}`;
  }
  const noun = total === 1 ? "contribution" : "contributions";
  return `${formatNumber(total)} ${noun} in ${period(ctx.options.year)}`;
}
