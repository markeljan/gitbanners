"use no memo";

import {
  longMonthName,
  monthName,
  parseIsoDate,
  percentChange,
  weekdayName,
  weekdayOf,
} from "@/lib/banner/format";
import { plainText } from "@/lib/banner/text";
import type { User } from "@/lib/github/schema";

/**
 * A year in review: the facts of one calendar range that the `wrapped`
 * poster prints. Everything except the comparison with the year before and
 * the top repositories is worked out from the calendar's days, so it is
 * available for any range the data layer hands over: a calendar year, or the
 * last twelve months when no year was asked for.
 */
export interface YearReview {
  /** The calendar year, or `null` for "the last 12 months". */
  year: number | null;
  /** Contributions in the range. */
  total: number;
  /** Days in the range. */
  days: number;
  /** Days with at least one contribution. */
  activeDays: number;
  /** Longest run of consecutive active days; `null` when there was none. */
  streak: { days: number; from: string; to: string } | null;
  /** The day with the most contributions (the earliest, on a tie). */
  bestDay: { date: string; count: number } | null;
  /** The calendar month with the most contributions. */
  busiestMonth: { name: string; short: string; total: number } | null;
  /** The weekday with the most contributions over the whole range. */
  busiestWeekday: { name: string; short: string; total: number } | null;
  /**
   * Growth against the year before, as printed ("+22%", "-8%", "3x"), and
   * which year that was. Only known when the data layer fetched the extras.
   */
  change: { text: string; up: boolean; against: number } | null;
  /** Public repositories with the most commits in the range, best first. */
  topRepos: { name: string; commits: number }[];
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/** Index of the largest value, or -1 when every value is zero. Ties go to the first. */
function peak(values: readonly number[]): number {
  let best = -1;
  values.forEach((value, index) => {
    if (value > 0 && (best < 0 || value > (values[best] ?? 0))) best = index;
  });
  return best;
}

/**
 * `owner/name` as it reads on the owner's own poster: their repositories by
 * name alone, everyone else's in full.
 */
function repoLabel(fullName: unknown, login: string): string {
  const full = plainText(fullName);
  const slash = full.indexOf("/");
  if (slash < 0) return full;
  return full.slice(0, slash).toLowerCase() === login.toLowerCase()
    ? full.slice(slash + 1)
    : full;
}

/**
 * Works the review out. Total: a missing or empty calendar gives a review of
 * zeros and `null`s, never an error.
 */
export function reviewOf(user: User, year: number | null): YearReview {
  const days = Array.isArray(user.calendar?.days) ? user.calendar.days : [];
  let activeDays = 0;
  let sum = 0;
  let bestDay: YearReview["bestDay"] = null;
  let streak: YearReview["streak"] = null;
  let run = 0;
  let runStart = "";
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  // Keyed by year and month: a range of twelve months can touch the same
  // month name twice, and those are different months.
  const months = new Map<string, { month: number; total: number }>();

  for (const day of days) {
    const amount = count(day?.count);
    const date = typeof day?.date === "string" ? day.date : "";
    const parts = parseIsoDate(date);
    sum += amount;
    if (amount === 0) {
      run = 0;
      continue;
    }
    activeDays += 1;
    if (!bestDay || amount > bestDay.count) bestDay = { date, count: amount };
    if (run === 0) runStart = date;
    run += 1;
    if (!streak || run > streak.days) {
      streak = { days: run, from: runStart, to: date };
    }
    if (parts) {
      weekdays[weekdayOf(parts)] += amount;
      const key = `${parts.year}-${parts.month}`;
      const month = months.get(key) ?? { month: parts.month, total: 0 };
      month.total += amount;
      months.set(key, month);
    }
  }

  const monthList = [...months.values()];
  const topMonth = monthList[peak(monthList.map((month) => month.total))];
  const topWeekday = peak(weekdays);
  // GitHub's own total may include private contributions the days do not
  // itemise; it is the number people know from their profile.
  const total = count(user.calendar?.total) || sum;

  const extras = user.wrapped;
  const before = extras?.previousTotal;
  const changeText =
    typeof before === "number" ? percentChange(before, total) : null;
  const against = year ?? extras?.year;
  const topRepos = Array.isArray(extras?.topRepos)
    ? extras.topRepos
        .map((repo) => ({
          name: repoLabel(repo?.fullName, plainText(user.login)),
          commits: count(repo?.commits),
        }))
        .filter((repo) => repo.name && repo.commits > 0)
        // The data layer sends them ranked; a poster must not depend on it.
        .map((repo, index) => ({ repo, index }))
        .sort((a, b) => b.repo.commits - a.repo.commits || a.index - b.index)
        .map((entry) => entry.repo)
    : [];

  return {
    year,
    total,
    days: days.length,
    activeDays,
    streak,
    bestDay,
    busiestMonth: topMonth
      ? {
          name: longMonthName(topMonth.month),
          short: monthName(topMonth.month),
          total: topMonth.total,
        }
      : null,
    busiestWeekday:
      topWeekday >= 0
        ? {
            name: weekdayName(topWeekday),
            short: weekdayName(topWeekday).slice(0, 3),
            total: weekdays[topWeekday] ?? 0,
          }
        : null,
    change:
      changeText && typeof against === "number" && typeof before === "number"
        ? { text: changeText, up: total >= before, against: against - 1 }
        : null,
    topRepos,
  };
}
