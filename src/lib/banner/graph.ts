"use no memo";

import { type CalendarGrid, calendarGrid } from "@/lib/banner/calendar";
import type { Ctx } from "@/lib/banner/context";
import {
  addDays,
  type DateParts,
  dateOf,
  daysBetween,
  formatNumber,
  parseIsoDate,
  toIsoDate,
  weekdayOf,
} from "@/lib/banner/format";
import { captionOf, totalLabel } from "@/lib/banner/layout/caption";
import { presetDefaults } from "@/lib/banner/presets";
import type { SectionId } from "@/lib/banner/types";
import type {
  Calendar,
  CommitActivity,
  ContributionDay,
  RepoActivityWeek,
} from "@/lib/github/schema";

/**
 * The year graph of a banner, in GitHub's calendar shape: a user's
 * contributions, or the commits of a repository (an organization: of its top
 * repositories) day by day.
 *
 * Layouts only know this shape, so a repository's commit activity gets the
 * same treatment as a profile's contribution graph: it sets the measure of a
 * card, takes the free height of a poster, and its total becomes the headline.
 */
export interface Graph {
  grid: CalendarGrid;
  /** The number behind the graph; `null` while GitHub is still working it out. */
  total: number | null;
  /** What the number counts, with its period: "contributions in the last year". */
  label: string;
  /** The same as a sentence, for captions; `null` when titles are hidden. */
  caption: string | null;
  /**
   * What the total leaves unsaid ("Across top public repositories"), shown
   * under the graph when the sentence is not.
   */
  note: string | null;
  /**
   * False for a placeholder grid: it holds the place of the real one, but has
   * no levels to explain in a legend and nothing worth animating.
   */
  live: boolean;
}

const WEEK = 7;
/** GitHub reports a year of weeks for a repository. */
const YEAR_WEEKS = 52;
/** A day or a week counts as "busiest" from here on, however quiet the rest is. */
const FULL_SCALE_FLOOR = 4;

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function weeksOf(activity: CommitActivity | null | undefined) {
  return Array.isArray(activity?.weeks)
    ? activity.weeks.filter((week) => week && typeof week === "object")
    : [];
}

/** The commit activity of a repository or an organization; `null` for users and while unknown. */
export function activityOf(ctx: Ctx): CommitActivity | null {
  const { entity } = ctx;
  if (entity.kind === "user") return null;
  const activity = entity.activity;
  return activity && typeof activity === "object" ? activity : null;
}

/** The most recent year of weeks, oldest first, with their totals made safe. */
export function recentWeeks(activity: CommitActivity): RepoActivityWeek[] {
  return weeksOf(activity)
    .slice(-YEAR_WEEKS)
    .map((week) => ({
      week: typeof week.week === "string" ? week.week : "",
      commits: isCount(week.commits) ? Math.floor(week.commits) : 0,
      days:
        Array.isArray(week.days) &&
        week.days.length === WEEK &&
        week.days.every(isCount)
          ? week.days.map(Math.floor)
          : null,
    }));
}

/** True when every week says how its commits spread over the weekdays. */
function hasDays(weeks: readonly RepoActivityWeek[]): boolean {
  return weeks.length > 0 && weeks.every((week) => week.days !== null);
}

/**
 * The value that fills the scale: the 97th percentile of the busy entries,
 * so one release-day outlier does not turn every other day pale. GitHub's
 * own graph does the same (Linus Torvalds' best day has 68 contributions,
 * and everything from 36 up is the brightest green).
 */
export function fullScale(values: readonly number[]): number {
  const busy = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (busy.length === 0) return FULL_SCALE_FLOOR;
  const index = Math.min(busy.length - 1, Math.floor(busy.length * 0.97));
  return Math.max(FULL_SCALE_FLOOR, busy[index] ?? 0);
}

/** Intensity 0-4 of a count against the value that fills the scale. */
export function levelOf(count: number, scale: number): number {
  if (!(count > 0)) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / scale) * 4)));
}

/** The Sunday that starts the week `date` falls in. */
export function weekStart(date: DateParts): DateParts {
  return addDays(date, -weekdayOf(date));
}

/**
 * Commit activity as a contribution calendar: one day per weekday of every
 * week, levelled like GitHub's graph. Days of the current week that have not
 * happened yet are left out, so the graph ends today as it does on a profile.
 */
function commitCalendar(
  weeks: readonly RepoActivityWeek[],
  today: DateParts | null,
): Calendar {
  const scale = fullScale(weeks.flatMap((week) => week.days ?? []));
  // Weeks are a week apart by definition: every date is counted from the
  // last week's, so one garbled date cannot shift a column.
  const lastStart = parseIsoDate(weeks[weeks.length - 1]?.week);
  const anchor = lastStart
    ? addDays(lastStart, -(weeks.length - 1) * WEEK)
    : null;
  // Only the last week can hold days that are still to come. A clock that
  // disagrees with the data by more than that week is not trusted.
  const ahead = lastStart && today ? daysBetween(lastStart, today) : -1;
  const lastDay = ahead >= 0 && ahead < WEEK ? ahead : WEEK - 1;
  const days: ContributionDay[] = [];
  weeks.forEach((week, index) => {
    const last = index === weeks.length - 1;
    (week.days ?? []).forEach((count, weekday) => {
      if (last && weekday > lastDay) return;
      days.push({
        date: anchor ? toIsoDate(addDays(anchor, index * WEEK + weekday)) : "",
        count,
        level: levelOf(count, scale),
      });
    });
  });
  return {
    total: days.reduce((sum, day) => sum + day.count, 0),
    from: days[0]?.date ?? "",
    to: days[days.length - 1]?.date ?? "",
    days,
  };
}

/** A year of empty days ending today: the grid a repository will fill once GitHub has counted. */
function blankCalendar(today: DateParts | null): Calendar {
  if (!today) return { total: 0, from: "", to: "", days: [] };
  const start = addDays(weekStart(today), -(YEAR_WEEKS - 1) * WEEK);
  const length = daysBetween(start, today) + 1;
  const days: ContributionDay[] = Array.from({ length }, (_, index) => ({
    date: toIsoDate(addDays(start, index)),
    count: 0,
    level: 0,
  }));
  return {
    total: 0,
    from: days[0]?.date ?? "",
    to: days[days.length - 1]?.date ?? "",
    days,
  };
}

/** Shown in place of a caption while GitHub computes a repository's statistics. */
export const CALCULATING = "GitHub is calculating activity";

/** "commits in the last year": what a commit graph counts. A custom title replaces it. */
export function commitsLabel(ctx: Ctx): string {
  return ctx.options.title ?? "commits in the last year";
}

/**
 * The sentence that goes with a commit chart. A total that is still unknown
 * says so whatever is hidden: an empty chart without a word would read as
 * "no commits".
 */
export function commitsCaption(ctx: Ctx, total: number | null): string | null {
  if (total === null) return CALCULATING;
  if (ctx.hide.has("title")) return null;
  if (ctx.options.title) return ctx.options.title;
  if (!(total > 0)) return "No commits in the last year";
  const noun = total === 1 ? "commit" : "commits";
  const scope = ctx.entity.kind === "org" ? " to top repositories" : "";
  return `${formatNumber(total)} ${noun}${scope} in the last year`;
}

/** How a commit chart is drawn. */
export type ChartStyle = "calendar" | "bars";

/** Narrowest content box, in units of small text, that still shows calendar cells of a readable size. */
const CALENDAR_MIN_WIDTH = 46;

/** The chart a banner would use if its data allows both. */
function preferredStyle(ctx: Ctx): ChartStyle {
  const { canvas, entity, options, ramp } = ctx;
  if (presetDefaults(entity.kind, options.preset)?.chart === "bars") {
    return "bars";
  }
  const room = canvas.width - canvas.inset.left - canvas.inset.right;
  return room >= ramp.small * CALENDAR_MIN_WIDTH ? "calendar" : "bars";
}

/**
 * Picks the chart for commit activity.
 *
 * The calendar is the shape everyone knows from a GitHub profile, so it is
 * the choice wherever a year of cells stays legible: every standard size.
 * Bars take over when the data has no weekdays, when the canvas is too narrow
 * for cells (small cards), and for presets where the chart only supports
 * other content (`release`), which ask for the compact form.
 *
 * `null` means there is no chart at all: users have a contribution graph
 * instead, and an organization without activity data shows nothing rather
 * than an empty frame.
 */
export function chartStyle(ctx: Ctx): ChartStyle | null {
  const { entity } = ctx;
  if (entity.kind === "user") return null;
  const activity = activityOf(ctx);
  // A repository's statistics arrive late (GitHub answers 202 first): hold
  // the place of the chart they will get.
  if (!activity) return entity.kind === "repo" ? preferredStyle(ctx) : null;
  const weeks = recentWeeks(activity);
  if (weeks.length === 0) return entity.kind === "repo" ? "bars" : null;
  return hasDays(weeks) ? preferredStyle(ctx) : "bars";
}

/**
 * The year graph for this banner, or `null` when it has none: a user's
 * contribution calendar, or the commit calendar of a repository or an
 * organization when `chartStyle` picked it.
 */
export function graphOf(ctx: Ctx): Graph | null {
  const { entity } = ctx;
  if (entity.kind === "user") {
    return {
      grid: calendarGrid(entity.calendar),
      total: entity.calendar?.total ?? 0,
      label: totalLabel(ctx),
      caption: captionOf(ctx, entity),
      note: null,
      live: true,
    };
  }
  if (chartStyle(ctx) !== "calendar") return null;
  const today = dateOf(ctx.now);
  const activity = activityOf(ctx);
  if (!activity) {
    return {
      grid: calendarGrid(blankCalendar(today)),
      total: null,
      label: commitsLabel(ctx),
      caption: commitsCaption(ctx, null),
      note: null,
      live: false,
    };
  }
  const weeks = recentWeeks(activity);
  const total = isCount(activity.total)
    ? Math.floor(activity.total)
    : weeks.reduce((sum, week) => sum + week.commits, 0);
  return {
    grid: calendarGrid(commitCalendar(weeks, today)),
    total,
    label: commitsLabel(ctx),
    caption: commitsCaption(ctx, total),
    note:
      entity.kind === "org" && !ctx.hide.has("title") && !ctx.options.title
        ? "Across top public repositories"
        : null,
    live: true,
  };
}

/**
 * The sections a banner really draws, in order. Commit activity that is
 * drawn as a calendar becomes the `heatmap` section, which is the one the
 * layouts build around; as bars it stays `activity`, a plain block. A section
 * named twice is drawn once.
 */
export function resolveSections(
  ctx: Ctx,
  sections: readonly SectionId[],
): SectionId[] {
  const style = chartStyle(ctx);
  const resolved: SectionId[] = [];
  for (const id of sections) {
    const mapped =
      ctx.entity.kind !== "user" && id === "activity" && style === "calendar"
        ? "heatmap"
        : id;
    if (!resolved.includes(mapped)) resolved.push(mapped);
  }
  return resolved;
}
