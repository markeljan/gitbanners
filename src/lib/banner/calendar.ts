"use no memo";

import { monthName, parseIsoDate, weekdayOf } from "@/lib/banner/format";
import type { Calendar } from "@/lib/github/schema";

/**
 * A contribution calendar arranged the way GitHub draws it: one column per
 * week, Sunday in row 0.
 */
export interface CalendarGrid {
  /** Number of week columns. */
  cols: number;
  /** `levels[col][row]`: 0-4, or `null` where the range has no day. */
  levels: (number | null)[][];
  /** Month names with the column they start above. */
  months: { col: number; label: string }[];
  /** Number of day cells (non-null entries). */
  cells: number;
}

/** GitHub's "last year" view: 52 full weeks and the current one. */
const DEFAULT_COLS = 53;
/** A leap year that starts on a Saturday spans 54 week columns: never draw more. */
const MAX_COLS = 54;
const ROWS = 7;

function clampLevel(level: number): number {
  return Number.isFinite(level)
    ? Math.min(4, Math.max(0, Math.round(level)))
    : 0;
}

/**
 * Lays the calendar's days out in week columns and finds where month labels
 * go (above the first column whose first day falls in a new month, as on
 * github.com).
 *
 * Total: an empty calendar becomes a blank 53-week grid (the "no public
 * contributions" state), an over-long one keeps its most recent 54 weeks,
 * and out-of-range levels are clamped.
 */
export function calendarGrid(calendar: Calendar): CalendarGrid {
  const days = Array.isArray(calendar?.days) ? calendar.days : [];
  if (days.length === 0) {
    return {
      cols: DEFAULT_COLS,
      levels: Array.from({ length: DEFAULT_COLS }, () =>
        Array.from({ length: ROWS }, () => 0),
      ),
      months: [],
      cells: DEFAULT_COLS * ROWS,
    };
  }

  const first = parseIsoDate(days[0]?.date ?? calendar.from);
  const offset = first ? weekdayOf(first) : 0;
  const total = Math.ceil((offset + days.length) / ROWS);
  // Keep the newest weeks when there are too many: the right edge is "today".
  const skipCols = Math.max(0, total - MAX_COLS);
  const cols = total - skipCols;

  const levels: (number | null)[][] = Array.from({ length: cols }, () =>
    Array.from({ length: ROWS }, () => null),
  );
  const firstMonth: (number | null)[] = Array.from(
    { length: cols },
    () => null,
  );
  let cells = 0;
  days.forEach((day, index) => {
    const slot = offset + index;
    const col = Math.floor(slot / ROWS) - skipCols;
    if (col < 0) return;
    levels[col][slot % ROWS] = clampLevel(day?.level);
    cells += 1;
    if (firstMonth[col] === null) {
      firstMonth[col] = parseIsoDate(day?.date)?.month ?? null;
    }
  });

  const months: CalendarGrid["months"] = [];
  let previous: number | null = null;
  firstMonth.forEach((month, col) => {
    if (month !== null && month !== previous) {
      months.push({ col, label: monthName(month) });
    }
    if (month !== null) previous = month;
  });
  return { cols, levels, months, cells };
}
