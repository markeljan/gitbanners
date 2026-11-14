import { describe, expect, test } from "bun:test";
import {
  addDays,
  dateOf,
  daysBetween,
  formatCount,
  formatDateRange,
  formatDay,
  formatNumber,
  longMonthName,
  monthName,
  parseIsoDate,
  percentChange,
  relativeDay,
  toIsoDate,
  weekdayName,
  weekdayOf,
} from "@/lib/banner/format";

describe("formatCount", () => {
  const table: [number, string][] = [
    [0, "0"],
    [7, "7"],
    [999, "999"],
    [1000, "1k"],
    [1049, "1k"],
    [1050, "1.1k"],
    [1150, "1.2k"],
    [1234, "1.2k"],
    [1250, "1.3k"],
    [1950, "2k"],
    [4015, "4k"],
    [9999, "10k"],
    [10_000, "10k"],
    [12_345, "12.3k"],
    [14_200, "14.2k"],
    [99_949, "99.9k"],
    [99_950, "100k"],
    [100_499, "100k"],
    [100_500, "101k"],
    [267_800, "268k"],
    [331_771, "332k"],
    [999_499, "999k"],
    [999_500, "1M"],
    [1_000_000, "1M"],
    [1_049_999, "1M"],
    [1_050_000, "1.1M"],
    [1_234_567, "1.2M"],
    [12_345_678, "12.3M"],
    [99_949_999, "99.9M"],
    [99_950_000, "100M"],
    [987_654_321, "988M"],
    [999_499_999, "999M"],
    [999_500_000, "1B"],
    [1_500_000_000, "1.5B"],
    [2_000_000_000_000, "2T"],
  ];
  for (const [input, expected] of table) {
    test(`${input} -> ${expected}`, () => {
      expect(formatCount(input)).toBe(expected);
    });
  }

  test("uses a lower-case k and never Intl's compact notation", () => {
    expect(formatCount(267_800)).not.toContain("K");
    expect(formatCount(12_345)).toBe("12.3k");
  });

  test("is total", () => {
    expect(formatCount(Number.NaN)).toBe("0");
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe("0");
    expect(formatCount(-12)).toBe("0");
    expect(formatCount(12.9)).toBe("12");
    expect(formatCount(undefined as unknown as number)).toBe("0");
    expect(formatCount(1e21)).toMatch(/T$/);
  });
});

describe("formatNumber", () => {
  test("adds thousands separators", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(999)).toBe("999");
    expect(formatNumber(1000)).toBe("1,000");
    expect(formatNumber(4015)).toBe("4,015");
    expect(formatNumber(1_234_567)).toBe("1,234,567");
    expect(formatNumber(Number.NaN)).toBe("0");
    expect(formatNumber(-5)).toBe("0");
  });
});

describe("dates", () => {
  test("parseIsoDate reads dates and timestamps", () => {
    expect(parseIsoDate("2026-11-13")).toEqual({
      year: 2026,
      month: 11,
      day: 13,
    });
    expect(parseIsoDate("2011-09-03T15:26:22Z")).toEqual({
      year: 2011,
      month: 9,
      day: 3,
    });
    for (const junk of [
      "",
      "yesterday",
      "2026-13-01",
      "2026-00-10",
      "2026-01-32",
      null,
      undefined,
    ]) {
      expect(parseIsoDate(junk)).toBeNull();
    }
  });

  test("weekdayOf is time-zone independent", () => {
    expect(weekdayOf({ year: 2026, month: 11, day: 13 })).toBe(5);
    expect(weekdayOf({ year: 2025, month: 11, day: 9 })).toBe(0);
    expect(weekdayOf({ year: 2024, month: 2, day: 29 })).toBe(4);
  });

  test("addDays crosses months and years", () => {
    expect(toIsoDate(addDays({ year: 2025, month: 12, day: 31 }, 1))).toBe(
      "2026-01-01",
    );
    expect(toIsoDate(addDays({ year: 2024, month: 2, day: 28 }, 1))).toBe(
      "2024-02-29",
    );
    expect(toIsoDate(addDays({ year: 2026, month: 3, day: 1 }, -1))).toBe(
      "2026-02-28",
    );
    expect(toIsoDate(addDays({ year: 2026, month: 1, day: 5 }, 0))).toBe(
      "2026-01-05",
    );
  });

  test("formatDay and monthName", () => {
    expect(formatDay({ year: 2026, month: 10, day: 2 })).toBe("Oct 2");
    expect(formatDay({ year: 2026, month: 10, day: 2 }, true)).toBe(
      "Oct 2, 2026",
    );
    expect(monthName(1)).toBe("Jan");
    expect(monthName(12)).toBe("Dec");
    expect(monthName(0)).toBe("");
    expect(monthName(13)).toBe("");
  });

  test("formatDateRange", () => {
    expect(formatDateRange("2026-10-02", "2026-11-13")).toBe("Oct 2 – Nov 13");
    expect(formatDateRange("2025-12-28", "2026-01-04")).toBe(
      "Dec 28, 2025 – Jan 4, 2026",
    );
    expect(formatDateRange("2026-11-13", "2026-11-13")).toBe("Nov 13");
    expect(formatDateRange("2026-11-13", null)).toBe("Nov 13");
    expect(formatDateRange(null, "2026-11-13")).toBe("Nov 13");
    expect(formatDateRange(null, null)).toBe("");
    expect(formatDateRange("junk", "more junk")).toBe("");
  });
});

describe("names of months and weekdays", () => {
  test("long names, and nothing for values out of range", () => {
    expect(longMonthName(1)).toBe("January");
    expect(longMonthName(9)).toBe("September");
    expect(longMonthName(12)).toBe("December");
    expect(longMonthName(0)).toBe("");
    expect(longMonthName(13)).toBe("");
    expect(weekdayName(0)).toBe("Sunday");
    expect(weekdayName(3)).toBe("Wednesday");
    expect(weekdayName(6)).toBe("Saturday");
    expect(weekdayName(7)).toBe("");
    expect(weekdayName(-1)).toBe("");
  });
});

describe("dateOf and daysBetween", () => {
  test("an instant is read in UTC", () => {
    expect(dateOf(new Date("2026-11-13T23:59:59Z"))).toEqual({
      year: 2026,
      month: 11,
      day: 13,
    });
    expect(dateOf(new Date("2026-01-01T00:00:00Z"))).toEqual({
      year: 2026,
      month: 1,
      day: 1,
    });
    expect(dateOf(new Date(Number.NaN))).toBeNull();
    expect(dateOf("2026-11-13" as unknown as Date)).toBeNull();
  });

  test("whole days, across months, leap days and backwards", () => {
    const day = (iso: string) =>
      parseIsoDate(iso) as NonNullable<ReturnType<typeof parseIsoDate>>;
    expect(daysBetween(day("2026-11-13"), day("2026-11-13"))).toBe(0);
    expect(daysBetween(day("2026-11-03"), day("2026-11-13"))).toBe(10);
    expect(daysBetween(day("2025-11-09"), day("2026-11-13"))).toBe(369);
    expect(daysBetween(day("2024-02-28"), day("2024-03-01"))).toBe(2);
    expect(daysBetween(day("2026-11-13"), day("2026-11-03"))).toBe(-10);
  });
});

describe("relativeDay", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  const table: [string, string][] = [
    ["2026-11-13T00:00:01Z", "today"],
    ["2026-11-12T23:59:59Z", "yesterday"],
    ["2026-11-11", "2 days ago"],
    ["2026-11-07", "6 days ago"],
    ["2026-11-06", "last week"],
    ["2026-11-03T15:00:00Z", "last week"],
    ["2026-10-30", "2 weeks ago"],
    ["2026-10-15", "4 weeks ago"],
    ["2026-10-14", "last month"],
    ["2026-09-14", "2 months ago"],
    ["2025-11-14", "12 months ago"],
    ["2025-11-11", "last year"],
    ["2023-06-01", "3 years ago"],
  ];
  for (const [input, expected] of table) {
    test(`${input} -> ${expected}`, () => {
      expect(relativeDay(input, now)).toBe(expected);
    });
  }

  test("is total: a date to come reads as today, junk as nothing", () => {
    expect(relativeDay("2027-01-01", now)).toBe("today");
    expect(relativeDay(null, now)).toBeNull();
    expect(relativeDay(undefined, now)).toBeNull();
    expect(relativeDay("soon", now)).toBeNull();
    expect(relativeDay("2026-11-03", new Date(Number.NaN))).toBeNull();
  });
});

describe("percentChange", () => {
  test("signed whole percentages", () => {
    expect(percentChange(100, 122)).toBe("+22%");
    expect(percentChange(1660, 2033)).toBe("+22%");
    expect(percentChange(100, 92)).toBe("-8%");
    expect(percentChange(100, 100)).toBe("0%");
    expect(percentChange(1000, 1004)).toBe("0%");
    expect(percentChange(4, 1)).toBe("-75%");
    expect(percentChange(100, 0)).toBe("-100%");
  });

  test("beyond tenfold it says how many times", () => {
    expect(percentChange(10, 109)).toBe("+990%");
    expect(percentChange(10, 110)).toBe("11x");
    expect(percentChange(2, 4015)).toBe("2008x");
  });

  test("no base, no rate", () => {
    expect(percentChange(0, 500)).toBeNull();
    expect(percentChange(-3, 500)).toBeNull();
    expect(percentChange(Number.NaN, 500)).toBeNull();
    expect(percentChange(100, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
