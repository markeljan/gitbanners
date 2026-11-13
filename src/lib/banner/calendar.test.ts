import { describe, expect, test } from "bun:test";
import { calendarGrid } from "@/lib/banner/calendar";
import { demoEntity } from "@/lib/banner/demo";
import type { Calendar } from "@/lib/github/schema";

function calendar(from: string, length: number, level = 1): Calendar {
  const start = new Date(`${from}T00:00:00Z`);
  const days = Array.from({ length }, (_, index) => {
    const date = new Date(start.getTime() + index * 86_400_000);
    return { date: date.toISOString().slice(0, 10), count: level, level };
  });
  return {
    total: length * level,
    from,
    to: days[days.length - 1]?.date ?? from,
    days,
  };
}

describe("calendarGrid", () => {
  test("the demo year: 53 weeks, Sunday on top, every day once", () => {
    const user = demoEntity("user");
    const grid = calendarGrid(user.calendar);
    expect(grid.cols).toBe(53);
    expect(grid.levels).toHaveLength(53);
    expect(grid.cells).toBe(user.calendar.days.length);
    expect(grid.levels.flat().filter((level) => level !== null)).toHaveLength(
      user.calendar.days.length,
    );
    // The demo range starts on a Sunday and ends on a Friday.
    expect(grid.levels[0][0]).toBe(user.calendar.days[0].level);
    expect(grid.levels[52][5]).toBe(user.calendar.days.at(-1)?.level ?? null);
    expect(grid.levels[52][6]).toBeNull();
  });

  test("a range that starts mid-week leaves the days before it empty", () => {
    // 2026-01-01 is a Thursday.
    const grid = calendarGrid(calendar("2026-01-01", 10, 2));
    expect(grid.cols).toBe(2);
    expect(grid.levels[0]).toEqual([null, null, null, null, 2, 2, 2]);
    expect(grid.levels[1]).toEqual([2, 2, 2, 2, 2, 2, 2]);
    expect(grid.cells).toBe(10);
  });

  test("month labels sit above the first week that starts in the month", () => {
    const grid = calendarGrid(calendar("2025-11-09", 370));
    expect(grid.months.map((month) => month.label)).toEqual([
      "Nov",
      "Dec",
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
    ]);
    expect(grid.months[0].col).toBe(0);
    // 2025-12-07 is the first Sunday of December: week 4.
    expect(grid.months[1]).toEqual({ col: 4, label: "Dec" });
    const cols = grid.months.map((month) => month.col);
    expect(cols).toEqual([...cols].sort((a, b) => a - b));
  });

  test("a calendar year can span 54 weeks", () => {
    // 2000 is a leap year that starts on a Saturday.
    const grid = calendarGrid(calendar("2000-01-01", 366));
    expect(grid.cols).toBe(54);
    expect(grid.cells).toBe(366);
    expect(grid.levels[0]).toEqual([null, null, null, null, null, null, 1]);
  });

  test("an empty calendar is a blank year, not an empty picture", () => {
    for (const empty of [
      { total: 0, from: "", to: "", days: [] },
      { total: 0, from: "2026-01-01", to: "2026-12-31", days: [] },
    ]) {
      const grid = calendarGrid(empty);
      expect(grid.cols).toBe(53);
      expect(grid.cells).toBe(371);
      expect(grid.levels.flat().every((level) => level === 0)).toBe(true);
      expect(grid.months).toEqual([]);
    }
  });

  test("an over-long calendar keeps its newest 54 weeks", () => {
    const grid = calendarGrid(calendar("2010-01-03", 4000, 3));
    expect(grid.cols).toBe(54);
    expect(grid.cells).toBeLessThanOrEqual(54 * 7);
    expect(grid.cells).toBeGreaterThan(53 * 7);
    expect(
      grid.levels[53].filter((level) => level !== null).length,
    ).toBeGreaterThan(0);
  });

  test("hostile days are clamped, never thrown on", () => {
    const grid = calendarGrid({
      total: 3,
      from: "nonsense",
      to: "",
      days: [
        { date: "garbage", count: 1, level: 99 },
        { date: "", count: 1, level: -3 },
        { date: "2026-02-30", count: 1, level: Number.NaN },
        { date: "2026-03-01", count: 1, level: 2.6 },
      ],
    });
    expect(grid.cols).toBe(1);
    expect(grid.levels[0].slice(0, 4)).toEqual([4, 0, 0, 3]);
    expect(grid.cells).toBe(4);
    expect(() => calendarGrid(undefined as never)).not.toThrow();
    expect(() => calendarGrid({ days: null } as never)).not.toThrow();
  });
});
