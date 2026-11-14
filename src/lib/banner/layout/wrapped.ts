"use no memo";

import { calendarGrid } from "@/lib/banner/calendar";
import { ABSOLUTE_MIN_TYPE } from "@/lib/banner/canvas";
import { type Ctx, withRamp } from "@/lib/banner/context";
import { frameOf } from "@/lib/banner/layout/poster/model";
import type { Layout } from "@/lib/banner/layout/types";
import {
  layoutColumnCard,
  layoutColumnPoster,
} from "@/lib/banner/layout/wrapped/column";
import { layoutAroundPhoto } from "@/lib/banner/layout/wrapped/zone";
import { reviewOf } from "@/lib/banner/review";
import type { SectionId } from "@/lib/banner/types";

/**
 * The year in review: a poster of one calendar range.
 *
 * Top to bottom it reads who, when and how much (the identity, the year in
 * the theme's colour, the total as the largest type on the canvas), then the
 * year as GitHub's graph, then what stood out (longest streak, best day,
 * active days, busiest month and weekday), then where the work went (top
 * repositories and languages).
 *
 * Three arrangements carry it: a column for cards, link previews and
 * squares (`wrapped/column`); and two around a profile photo, for the X
 * header and the shallow LinkedIn banner (`wrapped/zone`).
 */

/**
 * Lays the poster out. `null` when it does not apply (other kinds, or the
 * `wrapped` section was not asked for) or when the canvas is too small for a
 * poster even at the smallest type: the caller then draws the general layout.
 */
export function layoutWrapped(
  ctx: Ctx,
  sections: readonly SectionId[],
): Layout | null {
  const { entity, canvas } = ctx;
  if (entity.kind !== "user" || !sections.includes("wrapped")) return null;
  const review = reviewOf(entity, ctx.options.year);
  const calendar = calendarGrid(entity.calendar);
  if (canvas.height === null) return layoutColumnCard(ctx, review, calendar);
  const frame = frameOf(ctx);
  // The canvas' own type size first; smaller only when nothing fits.
  for (let size = canvas.unit; size >= ABSOLUTE_MIN_TYPE - 3; size--) {
    const scaled = size === canvas.unit ? ctx : withRamp(ctx, size);
    const layout = frame.zone
      ? layoutAroundPhoto(scaled, review, calendar, frame, frame.zone)
      : layoutColumnPoster(scaled, review, calendar, frame);
    if (layout) return layout;
  }
  return null;
}
