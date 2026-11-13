"use no memo";

/**
 * Number and date formatting for banners. Hand-rolled on purpose: `Intl`
 * output differs between runtimes ("267.8K" with a capital K, locale-dependent
 * separators), and the engine must print the same string on the server and in
 * the browser preview.
 */

const UNITS = ["k", "M", "B", "T"] as const;

function safeInt(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/**
 * Compact count the way github.com prints it: 999, 1.2k, 12.3k, 332k, 1.2M.
 * One decimal below 100 of a unit, none above, lower-case `k`.
 */
export function formatCount(n: number): string {
  const value = safeInt(n);
  if (value < 1000) return String(value);
  // Thresholds are compared as integers (999.5 = 1999 / 2, 99.95 = 1999 / 20)
  // so that 99,950 and 999,500 land on the right side on every runtime.
  let unit = 0;
  let divisor = 1000;
  // 999,500 already rounds to "1000k": move to the next unit instead.
  while (value * 2 >= 1999 * divisor && unit < UNITS.length - 1) {
    divisor *= 1000;
    unit += 1;
  }
  if (value * 20 >= 1999 * divisor) {
    return `${Math.round(value / divisor)}${UNITS[unit]}`;
  }
  const tenths = Math.round(value / (divisor / 10));
  const whole = Math.floor(tenths / 10);
  const decimal = tenths % 10;
  return `${whole}${decimal ? `.${decimal}` : ""}${UNITS[unit]}`;
}

/** Full count with thousands separators, for sentences: 4,015. */
export function formatNumber(n: number): string {
  return String(safeInt(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export interface DateParts {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
}

/** Reads the leading `YYYY-MM-DD` of an ISO date or timestamp. `null` when it is not one. */
export function parseIsoDate(
  value: string | null | undefined,
): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** Three-letter English month name for a 1-based month; "" when out of range. */
export function monthName(month: number): string {
  return MONTHS[month - 1] ?? "";
}

const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Full English month name for a 1-based month; "" when out of range. */
export function longMonthName(month: number): string {
  return LONG_MONTHS[month - 1] ?? "";
}

/** Full English weekday name, 0 = Sunday; "" when out of range. */
export function weekdayName(weekday: number): string {
  return WEEKDAYS[weekday] ?? "";
}

/** Day of the week (0 = Sunday) of a calendar date, independent of the time zone. */
export function weekdayOf(date: DateParts): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** "Oct 2" or, with the year, "Oct 2, 2026". */
export function formatDay(date: DateParts, withYear = false): string {
  const base = `${monthName(date.month)} ${date.day}`;
  return withYear ? `${base}, ${date.year}` : base;
}

/**
 * "Oct 2 – Nov 13" inside one year, "Dec 28, 2025 – Jan 4, 2026" across two.
 * A single day collapses to "Nov 13".
 */
export function formatDateRange(
  from: string | null | undefined,
  to: string | null | undefined,
): string {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start && !end) return "";
  if (!start || !end) return formatDay((start ?? end) as DateParts);
  const sameYear = start.year === end.year;
  if (sameYear && start.month === end.month && start.day === end.day) {
    return formatDay(end);
  }
  return `${formatDay(start, !sameYear)} – ${formatDay(end, !sameYear)}`;
}

/** Calendar date `days` after `date` (negative goes back). */
export function addDays(date: DateParts, days: number): DateParts {
  const shifted = new Date(
    Date.UTC(date.year, date.month - 1, date.day + days),
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** `YYYY-MM-DD` for a calendar date. */
export function toIsoDate(date: DateParts): string {
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/** The calendar date of an instant in UTC, or `null` for an invalid `Date`. */
export function dateOf(instant: Date): DateParts | null {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    return null;
  }
  return {
    year: instant.getUTCFullYear(),
    month: instant.getUTCMonth() + 1,
    day: instant.getUTCDate(),
  };
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: DateParts, to: DateParts): number {
  const ms =
    Date.UTC(to.year, to.month - 1, to.day) -
    Date.UTC(from.year, from.month - 1, from.day);
  return Math.round(ms / 86_400_000);
}

function ago(count: number, unit: string): string {
  return count === 1 ? `last ${unit}` : `${count} ${unit}s ago`;
}

/**
 * How long ago a date was, in the words github.com uses next to a release:
 * "today", "yesterday", "5 days ago", "last week", "3 months ago".
 *
 * Counted in whole calendar days on purpose: a banner is cached for hours,
 * and "2 hours ago" would be wrong for most of that time. `null` when either
 * date cannot be read; a date in the future reads as "today".
 */
export function relativeDay(
  value: string | null | undefined,
  now: Date,
): string | null {
  const then = parseIsoDate(value);
  const today = dateOf(now);
  if (!then || !today) return null;
  const days = Math.max(0, daysBetween(then, today));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return ago(Math.floor(days / 7), "week");
  if (days < 365) return ago(Math.floor(days / 30), "month");
  return ago(Math.floor(days / 365), "year");
}

/**
 * Change from `before` to `after` as a signed whole percentage: "+22%",
 * "-8%", "0%". `null` when there is no base to compare with (a first year has
 * no growth rate, only a start).
 */
export function percentChange(before: number, after: number): string | null {
  if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0) {
    return null;
  }
  const change = Math.round(((after - before) / before) * 100);
  if (change === 0) return "0%";
  // Beyond 10x the percentage stops meaning anything: say how many times.
  if (change >= 1000) return `${Math.round(after / before)}x`;
  return `${change > 0 ? "+" : "-"}${formatNumber(Math.abs(change))}%`;
}
