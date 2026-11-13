import { describe, expect, test } from "bun:test";
import { fixture, fixtureData } from "./__fixtures__/mock";
import {
  bestDay,
  calendarFromDays,
  computeStreak,
  emptyCalendar,
  isValidYear,
  MIN_YEAR,
  type RawContributionWeek,
  toCalendar,
  utcDate,
  yearWindow,
} from "./calendar";
import { decode, OwnerCoreDataSchema } from "./raw";
import { CalendarSchema, type ContributionDay, StreakSchema } from "./schema";

/** The day the fixtures were recorded (UTC). */
const TODAY = "2026-11-13";

function userCalendar(name: string) {
  const owner = decode(
    OwnerCoreDataSchema,
    fixtureData(name),
    name,
  ).repositoryOwner;
  if (owner?.__typename !== "User") throw new Error(`${name} is not a user`);
  return owner.contributionsCollection.contributionCalendar;
}

/** All 16 years of torvalds, one aliased calendar per year, newest first. */
function allYears(): RawContributionWeek[] {
  const body = fixture("user-years.torvalds.json") as {
    data: {
      user: Record<
        string,
        {
          contributionCalendar: {
            weeks: {
              contributionDays: { date: string; contributionCount: number }[];
            }[];
          };
        }
      >;
    };
  };
  return Object.values(body.data.user).flatMap((year) =>
    year.contributionCalendar.weeks.map((week) => ({
      contributionDays: week.contributionDays.map((day) => ({
        ...day,
        contributionLevel:
          day.contributionCount > 0 ? "FIRST_QUARTILE" : "NONE",
      })),
    })),
  );
}

function days(from: string, counts: number[]): ContributionDay[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return counts.map((count, index) => ({
    date: utcDate(new Date(start + index * 86_400_000)),
    count,
    level: count > 0 ? 1 : 0,
  }));
}

describe("toCalendar", () => {
  test("flattens the last-12-months grid: oldest first, no gaps, API total", () => {
    const raw = userCalendar("owner-core.torvalds.json");
    const calendar = toCalendar(raw.weeks, TODAY, raw.totalContributions);

    expect(CalendarSchema.parse(calendar)).toEqual(calendar);
    expect(calendar.days).toHaveLength(370);
    expect(calendar.from).toBe("2025-11-09");
    expect(calendar.to).toBe(TODAY);
    expect(calendar.total).toBe(4015);
    expect(calendar.days.reduce((sum, day) => sum + day.count, 0)).toBe(4015);
    for (const [index, day] of calendar.days.entries()) {
      const previous = calendar.days[index - 1];
      if (!previous) continue;
      expect(Date.parse(day.date) - Date.parse(previous.date)).toBe(86_400_000);
    }
  });

  test("maps contributionLevel to 0-4 and never reads a colour", () => {
    const raw = userCalendar("owner-core.torvalds.json");
    const calendar = toCalendar(raw.weeks, TODAY, raw.totalContributions);
    const byLevel = [0, 1, 2, 3, 4].map(
      (level) => calendar.days.filter((day) => day.level === level).length,
    );
    expect(byLevel).toEqual([9, 255, 65, 23, 18]);
    expect(
      calendar.days.every((day) => (day.level === 0) === (day.count === 0)),
    ).toBe(true);

    const [day] = toCalendar(
      [
        {
          contributionDays: [
            {
              date: TODAY,
              contributionCount: 7,
              contributionLevel: "FOURTH_QUARTILE",
            },
          ],
        },
      ],
      TODAY,
    ).days;
    expect(day).toEqual({ date: TODAY, count: 7, level: 4 });
  });

  test("an unknown level does not hide activity", () => {
    const calendar = toCalendar(
      [
        {
          contributionDays: [
            {
              date: "2026-11-12",
              contributionCount: 3,
              contributionLevel: "FIFTH_QUARTILE",
            },
            {
              date: "2026-11-13",
              contributionCount: 0,
              contributionLevel: "FIFTH_QUARTILE",
            },
          ],
        },
      ],
      TODAY,
    );
    expect(calendar.days.map((day) => day.level)).toEqual([1, 0]);
  });

  test("drops the zero-filled future days of the current calendar year", () => {
    const raw = userCalendar("owner-core.torvalds.2026.json");
    const rawDays = raw.weeks.flatMap((week) => week.contributionDays);
    expect(rawDays).toHaveLength(365);
    expect(rawDays.at(-1)?.date).toBe("2026-12-31");

    const calendar = toCalendar(raw.weeks, TODAY, raw.totalContributions);
    expect(calendar.from).toBe("2026-01-01");
    expect(calendar.to).toBe(TODAY);
    expect(calendar.days).toHaveLength(317);
    expect(calendar.total).toBe(3558);
    // Without the cut the streak walk would start in a 48-day hole.
    expect(computeStreak(calendar.days, TODAY).current).toBe(26);
  });

  test("sorts, de-duplicates and fills holes", () => {
    const calendar = toCalendar(
      [
        {
          contributionDays: [
            {
              date: "2026-03-05",
              contributionCount: 2,
              contributionLevel: "FIRST_QUARTILE",
            },
            {
              date: "2026-03-01",
              contributionCount: 1,
              contributionLevel: "FIRST_QUARTILE",
            },
          ],
        },
        {
          contributionDays: [
            {
              date: "2026-03-05",
              contributionCount: 4,
              contributionLevel: "SECOND_QUARTILE",
            },
            {
              date: "2026-03-03",
              contributionCount: 0,
              contributionLevel: "NONE",
            },
          ],
        },
      ],
      TODAY,
    );
    expect(calendar).toEqual({
      total: 5,
      from: "2026-03-01",
      to: "2026-03-05",
      days: [
        { date: "2026-03-01", count: 1, level: 1 },
        { date: "2026-03-02", count: 0, level: 0 },
        { date: "2026-03-03", count: 0, level: 0 },
        { date: "2026-03-04", count: 0, level: 0 },
        { date: "2026-03-05", count: 4, level: 2 },
      ],
    });
  });

  test("crosses month, year and leap-day boundaries without gaps", () => {
    const calendar = calendarFromDays(
      [
        { date: "2023-12-30", count: 1, level: 1 },
        { date: "2024-03-01", count: 1, level: 1 },
      ],
      TODAY,
    );
    expect(calendar.days).toHaveLength(63);
    expect(calendar.days.map((day) => day.date)).toContain("2024-02-29");
    expect(calendar.days[2]?.date).toBe("2024-01-01");
  });

  test("no usable days gives an empty calendar anchored on today", () => {
    expect(toCalendar([], TODAY)).toEqual(emptyCalendar(TODAY, TODAY));
    expect(
      toCalendar(
        [
          {
            contributionDays: [
              {
                date: "2027-01-01",
                contributionCount: 0,
                contributionLevel: "NONE",
              },
            ],
          },
        ],
        TODAY,
      ).days,
    ).toEqual([]);
  });
});

describe("computeStreak", () => {
  test("16 years of torvalds: longest and current streak", () => {
    const calendar = toCalendar(allYears(), TODAY);
    expect(calendar.days).toHaveLength(5796);
    expect(calendar.total).toBe(39_314);
    expect(calendar.from).toBe("2011-01-01");

    const streak = computeStreak(calendar.days, TODAY);
    expect(StreakSchema.parse(streak)).toEqual(streak);
    expect(streak).toEqual({
      current: 26,
      currentStart: "2026-10-18",
      longest: 104,
      longestStart: "2026-06-30",
      longestEnd: "2026-10-11",
    });
  });

  test("an empty today does not break the current streak", () => {
    // 2026-11-13 has no contributions yet in the recording.
    const all = toCalendar(allYears(), TODAY).days;
    expect(all.at(-1)).toEqual({ date: TODAY, count: 0, level: 0 });
    expect(computeStreak(all, TODAY).current).toBe(26);
    // The day before, the same streak was already 26 days long.
    expect(computeStreak(all, "2026-11-12").current).toBe(26);
  });

  test("an empty yesterday does", () => {
    const all = toCalendar(allYears(), "2026-11-14").days;
    expect(computeStreak(all, "2026-11-14")).toMatchObject({
      current: 0,
      currentStart: null,
      longest: 104,
    });
  });

  test("the day after a long streak ends it still counts, the next day not", () => {
    const all = toCalendar(allYears(), TODAY).days;
    // 2026-10-11 closed the 104-day run; 2026-10-12 was empty.
    expect(computeStreak(all, "2026-10-11").current).toBe(104);
    expect(computeStreak(all, "2026-10-12")).toMatchObject({
      current: 104,
      currentStart: "2026-06-30",
    });
    expect(computeStreak(all, "2026-10-13")).toMatchObject({
      current: 1,
      currentStart: "2026-10-13",
    });
  });

  test("today with contributions extends the streak", () => {
    expect(computeStreak(days("2026-11-10", [1, 2, 0, 3]), TODAY)).toEqual({
      current: 1,
      currentStart: TODAY,
      longest: 2,
      longestStart: "2026-11-10",
      longestEnd: "2026-11-11",
    });
    expect(
      computeStreak(days("2026-11-10", [1, 2, 4, 3]), TODAY),
    ).toMatchObject({
      current: 4,
      currentStart: "2026-11-10",
      longest: 4,
    });
  });

  test("a calendar that ends yesterday keeps its streak", () => {
    // Today's cell is missing altogether (a response cached before midnight).
    expect(computeStreak(days("2026-11-10", [1, 1, 1]), TODAY)).toMatchObject({
      current: 3,
      currentStart: "2026-11-10",
    });
    expect(computeStreak(days("2026-11-10", [1, 1, 0]), TODAY).current).toBe(0);
  });

  test("a past year has a longest but no current streak", () => {
    const year = days("2025-12-25", [1, 1, 1, 1, 1, 1, 1]);
    expect(computeStreak(year, TODAY)).toEqual({
      current: 0,
      currentStart: null,
      longest: 7,
      longestStart: "2025-12-25",
      longestEnd: "2025-12-31",
    });
  });

  test("ignores days after today and treats a missing date as a break", () => {
    const future = days("2026-11-12", [2, 0, 5, 5]);
    expect(computeStreak(future, TODAY)).toMatchObject({
      current: 1,
      longest: 1,
    });

    const holed = [
      { date: "2026-11-09", count: 1, level: 1 },
      { date: "2026-11-10", count: 1, level: 1 },
      { date: "2026-11-12", count: 1, level: 1 },
      { date: "2026-11-13", count: 1, level: 1 },
    ];
    expect(computeStreak(holed, TODAY)).toEqual({
      current: 2,
      currentStart: "2026-11-12",
      longest: 2,
      longestStart: "2026-11-09",
      longestEnd: "2026-11-10",
    });
  });

  test("nothing at all", () => {
    const none = {
      current: 0,
      currentStart: null,
      longest: 0,
      longestStart: null,
      longestEnd: null,
    };
    expect(computeStreak([], TODAY)).toEqual(none);
    expect(computeStreak(days("2026-11-10", [0, 0, 0, 0]), TODAY)).toEqual(
      none,
    );
  });
});

describe("bestDay", () => {
  test("the busiest day of the range", () => {
    const raw = userCalendar("owner-core.torvalds.json");
    const calendar = toCalendar(raw.weeks, TODAY, raw.totalContributions);
    expect(bestDay(calendar.days)).toEqual({
      date: "2026-10-20",
      count: 68,
      level: 4,
    });
  });

  test("ties go to the earliest day, no contributions give null", () => {
    expect(bestDay(days("2026-11-10", [3, 5, 5, 1]))?.date).toBe("2026-11-11");
    expect(bestDay(days("2026-11-10", [0, 0]))).toBeNull();
    expect(bestDay([])).toBeNull();
  });
});

describe("years", () => {
  const now = new Date("2026-11-13T04:00:00Z");

  test("accepts 2008 through the current UTC year", () => {
    expect(MIN_YEAR).toBe(2008);
    expect(isValidYear(2008, now)).toBe(true);
    expect(isValidYear(2026, now)).toBe(true);
    expect(isValidYear(2007, now)).toBe(false);
    expect(isValidYear(2027, now)).toBe(false);
    expect(isValidYear(2025.5, now)).toBe(false);
    expect(isValidYear(Number.NaN, now)).toBe(false);
  });

  test("the current year follows UTC, not local time", () => {
    expect(isValidYear(2027, new Date("2026-12-31T23:59:59Z"))).toBe(false);
    expect(isValidYear(2027, new Date("2027-01-01T00:00:00Z"))).toBe(true);
  });

  test("yearWindow covers the whole year", () => {
    expect(yearWindow(2025)).toEqual({
      from: "2025-01-01T00:00:00Z",
      to: "2025-12-31T23:59:59Z",
    });
  });

  test("utcDate", () => {
    expect(utcDate(new Date("2026-11-13T23:59:59.999Z"))).toBe("2026-11-13");
    expect(utcDate(new Date("2026-11-14T00:00:00+02:00"))).toBe("2026-11-13");
  });
});
