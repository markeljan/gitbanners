/**
 * Pure contribution-calendar helpers: no I/O, no clock. "Today" is always
 * passed in as a UTC date so results are reproducible and match GitHub's
 * public profile page (every request is sent with `Time-Zone: UTC`).
 *
 * Week-grid and month-label layout belong to the banner engine, not here.
 */
import type { Calendar, ContributionDay, Streak } from "./schema";

/** One day of GitHub's `contributionCalendar.weeks[].contributionDays[]`. */
export interface RawContributionDay {
  /** `YYYY-MM-DD`. */
  date: string;
  contributionCount: number;
  /** `NONE`, `FIRST_QUARTILE` ... `FOURTH_QUARTILE`. */
  contributionLevel: string;
}

/** One week of GitHub's `contributionCalendar.weeks[]`. */
export interface RawContributionWeek {
  contributionDays: readonly RawContributionDay[];
}

/**
 * GitHub's intensity buckets as shown on github.com (`data-level` 0-4).
 * The API's own `color` is ignored on purpose: it is always the legacy light
 * palette (and the Halloween one on 31 October), whatever the banner theme.
 */
const LEVELS: Readonly<Record<string, number>> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

const MS_PER_DAY = 86_400_000;

/** GitHub's founding year: no contribution calendar starts earlier. */
export const MIN_YEAR = 2008;

/** Whether `year` can be requested as a calendar year: 2008 to the current UTC year. */
export function isValidYear(year: number, now: Date = new Date()): boolean {
  return (
    Number.isInteger(year) && year >= MIN_YEAR && year <= now.getUTCFullYear()
  );
}

/** `from` / `to` timestamps covering one calendar year in UTC. */
export function yearWindow(year: number): { from: string; to: string } {
  return { from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` };
}

/** The UTC calendar date of `date` as `YYYY-MM-DD`. */
export function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Days since the Unix epoch for a `YYYY-MM-DD` date (UTC). */
function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / MS_PER_DAY);
}

function dateOfDayNumber(day: number): string {
  return utcDate(new Date(day * MS_PER_DAY));
}

function toLevel(day: RawContributionDay): number {
  // An unknown bucket (GitHub adding one) must not hide real activity.
  return LEVELS[day.contributionLevel] ?? (day.contributionCount > 0 ? 1 : 0);
}

/** A calendar with no days, for accounts whose activity is unavailable. */
export function emptyCalendar(from: string, to: string): Calendar {
  return { total: 0, from, to, days: [] };
}

/**
 * Builds the normalized calendar from days in any order.
 *
 * - Days after `today` are dropped: a window that ends in the future (the
 *   current calendar year) comes back zero-filled through its last day, which
 *   would otherwise read as a long gap and end every streak.
 * - Days are sorted oldest first, de-duplicated, and any hole is filled with
 *   an empty day, so consumers can rely on "one entry per day, no gaps".
 *
 * @param today Current UTC date, `YYYY-MM-DD`.
 * @param total The source's own total. It is authoritative (GitHub's can
 *   include contribution kinds without a per-day breakdown we could sum);
 *   omit it only when the source has none.
 */
export function calendarFromDays(
  input: Iterable<ContributionDay>,
  today: string,
  total?: number,
): Calendar {
  const byDate = new Map<string, ContributionDay>();
  for (const day of input) {
    if (day.date <= today) byDate.set(day.date, day);
  }
  const dates = [...byDate.keys()].sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === undefined || last === undefined) {
    return emptyCalendar(today, today);
  }

  const days: ContributionDay[] = [];
  const end = dayNumber(last);
  for (let day = dayNumber(first); day <= end; day += 1) {
    const date = dateOfDayNumber(day);
    days.push(byDate.get(date) ?? { date, count: 0, level: 0 });
  }
  return {
    total: total ?? days.reduce((sum, day) => sum + day.count, 0),
    from: first,
    to: last,
    days,
  };
}

/**
 * Flattens GitHub's week grid into the normalized calendar: flat days, oldest
 * first, `contributionLevel` mapped to 0-4, nothing after `today`.
 * See {@link calendarFromDays} for the guarantees.
 */
export function toCalendar(
  weeks: readonly RawContributionWeek[],
  today: string,
  total?: number,
): Calendar {
  const days = weeks.flatMap((week) =>
    week.contributionDays.map((day) => ({
      date: day.date,
      count: day.contributionCount,
      level: toLevel(day),
    })),
  );
  return calendarFromDays(days, today, total);
}

/**
 * Current and longest streak of consecutive days with contributions.
 *
 * The current streak is the run that ends today or yesterday. An empty
 * *today* does not break it: the day is not over, and a streak that vanishes
 * at 00:00 UTC only to reappear after the first commit would be wrong for
 * most of every user's day. A calendar that ends earlier (a past year) has no
 * current streak.
 *
 * @param days Oldest first. A missing date counts as a break.
 * @param today Current UTC date, `YYYY-MM-DD`. Later days are ignored.
 */
export function computeStreak(
  days: readonly ContributionDay[],
  today: string,
): Streak {
  const todayNumber = dayNumber(today);
  let longest = 0;
  let longestStart: string | null = null;
  let longestEnd: string | null = null;
  let run = 0;
  let runStart: string | null = null;
  let previous: number | null = null;
  /** Index of the last day that is not in the future. */
  let lastIndex = -1;

  for (const [index, day] of days.entries()) {
    const number = dayNumber(day.date);
    if (number > todayNumber) break;
    lastIndex = index;
    if (day.count > 0) {
      if (run > 0 && previous !== null && number === previous + 1) {
        run += 1;
      } else {
        run = 1;
        runStart = day.date;
      }
      if (run > longest) {
        longest = run;
        longestStart = runStart;
        longestEnd = day.date;
      }
    } else {
      run = 0;
    }
    previous = number;
  }

  let anchor = lastIndex;
  const lastDay = days[anchor];
  if (lastDay && lastDay.date === today && lastDay.count === 0) anchor -= 1;

  let current = 0;
  let currentStart: string | null = null;
  let expected: number | null = null;
  for (let index = anchor; index >= 0; index -= 1) {
    const day = days[index];
    if (!day || day.count === 0) break;
    const number = dayNumber(day.date);
    // The run must end today or yesterday, then continue day by day.
    if (expected === null ? number < todayNumber - 1 : number !== expected) {
      break;
    }
    current += 1;
    currentStart = day.date;
    expected = number - 1;
  }

  return { current, currentStart, longest, longestStart, longestEnd };
}

/**
 * The day with the most contributions, or `null` when there are none.
 * Ties go to the earliest day.
 */
export function bestDay(
  days: readonly ContributionDay[],
): ContributionDay | null {
  let best: ContributionDay | null = null;
  for (const day of days) {
    if (day.count > 0 && (best === null || day.count > best.count)) best = day;
  }
  return best;
}
