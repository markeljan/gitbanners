import { describe, expect, test } from "bun:test";
import { demoEntity } from "@/lib/banner/demo";
import { reviewOf } from "@/lib/banner/review";
import type { ContributionDay, User } from "@/lib/github/schema";

/** A user whose calendar is exactly these days, starting on `from`. */
function userWith(
  counts: readonly number[],
  from = "2026-01-01",
  patch: Partial<User> = {},
): User {
  const start = new Date(`${from}T00:00:00Z`);
  const days: ContributionDay[] = counts.map((count, index) => ({
    date: new Date(start.getTime() + index * 86_400_000)
      .toISOString()
      .slice(0, 10),
    count,
    level: count > 0 ? 1 : 0,
  }));
  const total = counts.reduce((sum, count) => sum + count, 0);
  return {
    ...demoEntity("user"),
    calendar: {
      total,
      from,
      to: days[days.length - 1]?.date ?? from,
      days,
    },
    wrapped: null,
    ...patch,
  };
}

describe("reviewOf", () => {
  test("totals, active days and the best day", () => {
    // Thu 1 Jan 2026 .. Sat 10 Jan 2026
    const review = reviewOf(userWith([0, 3, 9, 0, 0, 9, 1, 0, 2, 0]), 2026);
    expect(review.year).toBe(2026);
    expect(review.total).toBe(24);
    expect(review.days).toBe(10);
    expect(review.activeDays).toBe(5);
    // The earliest of two equally good days.
    expect(review.bestDay).toEqual({ date: "2026-01-03", count: 9 });
  });

  test("the longest streak, with its dates", () => {
    const review = reviewOf(userWith([1, 1, 0, 2, 2, 2, 2, 0, 5, 5, 5]), 2026);
    expect(review.streak).toEqual({
      days: 4,
      from: "2026-01-04",
      to: "2026-01-07",
    });
    // A streak that runs to the last day counts in full.
    expect(reviewOf(userWith([0, 1, 1, 1]), 2026).streak).toEqual({
      days: 3,
      from: "2026-01-02",
      to: "2026-01-04",
    });
    expect(reviewOf(userWith([0, 0, 0]), 2026).streak).toBeNull();
  });

  test("the busiest month and weekday", () => {
    // 31 days of January with one contribution each, then one big day in
    // February: January still has more.
    const counts = [...Array.from({ length: 31 }, () => 1), 20];
    const review = reviewOf(userWith(counts), 2026);
    expect(review.busiestMonth).toEqual({
      name: "January",
      short: "Jan",
      total: 31,
    });
    // 1 Feb 2026 is a Sunday: 4 Sundays of January plus 20.
    expect(review.busiestWeekday).toEqual({
      name: "Sunday",
      short: "Sun",
      total: 24,
    });
  });

  test("the same month of two years is two months", () => {
    // 20 Nov 2025 .. 19 Nov 2026 would sum both Novembers under one name.
    const days = 365;
    const counts = Array.from({ length: days }, (_, index) =>
      index < 11 || index >= days - 19 ? 3 : index === 100 ? 40 : 0,
    );
    const review = reviewOf(userWith(counts, "2025-11-20"), null);
    // November 2025 has 33, November 2026 has 57, February 2026 has 40.
    expect(review.busiestMonth?.name).toBe("November");
    expect(review.busiestMonth?.total).toBe(57);
    expect(review.year).toBeNull();
  });

  test("GitHub's total wins over the sum of the days", () => {
    const user = userWith([1, 2, 3]);
    user.calendar = { ...user.calendar, total: 50 };
    expect(reviewOf(user, 2026).total).toBe(50);
    user.calendar = { ...user.calendar, total: 0 };
    expect(reviewOf(user, 2026).total).toBe(6);
  });

  test("the comparison and the top repositories come from the extras", () => {
    const user = userWith([10, 10, 10], "2026-01-01", {
      login: "Mona-Demo",
      wrapped: {
        year: 2026,
        previousTotal: 25,
        topRepos: [
          { fullName: "mona-demo/rocket", commits: 12 },
          { fullName: "acme-labs/tide", commits: 5 },
          { fullName: "mona-demo/empty", commits: 0 },
          { fullName: "", commits: 9 },
        ],
      },
    });
    const review = reviewOf(user, 2026);
    expect(review.change).toEqual({ text: "+20%", up: true, against: 2025 });
    // The owner's own repositories go by name alone; empty entries are dropped.
    expect(review.topRepos).toEqual([
      { name: "rocket", commits: 12 },
      { name: "acme-labs/tide", commits: 5 },
    ]);
    // Ranked by commits, whatever order they arrive in.
    const unranked = {
      ...user,
      wrapped: {
        year: 2026,
        previousTotal: null,
        topRepos: [
          { fullName: "mona-demo/b", commits: 3 },
          { fullName: "mona-demo/a", commits: 30 },
          { fullName: "mona-demo/c", commits: 3 },
        ],
      },
    };
    expect(reviewOf(unranked, 2026).topRepos.map((repo) => repo.name)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("a slower year is a change too, and a first year is not one", () => {
    const slower = userWith([5], "2026-01-01", {
      wrapped: { year: 2026, previousTotal: 20, topRepos: [] },
    });
    expect(reviewOf(slower, 2026).change).toEqual({
      text: "-75%",
      up: false,
      against: 2025,
    });
    const first = userWith([5], "2026-01-01", {
      wrapped: { year: 2026, previousTotal: 0, topRepos: [] },
    });
    expect(reviewOf(first, 2026).change).toBeNull();
    const unknown = userWith([5], "2026-01-01", {
      wrapped: { year: 2026, previousTotal: null, topRepos: [] },
    });
    expect(reviewOf(unknown, 2026).change).toBeNull();
    expect(reviewOf(userWith([5]), 2026).change).toBeNull();
  });

  test("the demo year in review", () => {
    const user = demoEntity("user", { year: 2026 });
    const review = reviewOf(user, 2026);
    expect(review.total).toBe(user.calendar.total);
    expect(review.days).toBe(317);
    expect(review.change?.text).toBe("+22%");
    expect(review.topRepos.map((repo) => repo.name)).toEqual([
      "rocket",
      "paper-lantern",
      "acme-labs/tide",
      "atlas",
      "quill",
    ]);
    expect(review.streak?.days).toBeGreaterThan(20);
    expect(review.busiestMonth).not.toBeNull();
    expect(review.busiestWeekday).not.toBeNull();
  });

  test("is total", () => {
    const broken = demoEntity("user");
    Object.assign(broken, {
      calendar: {
        total: Number.NaN,
        from: "",
        to: "",
        days: [
          { date: "garbage", count: 3, level: 9 },
          { date: "", count: -4, level: 0 },
          { date: "2026-02-30", count: Number.NaN, level: 1 },
          null,
        ],
      },
      wrapped: { year: "soon", previousTotal: "many", topRepos: "none" },
    });
    const review = reviewOf(broken, null);
    expect(review.total).toBe(3);
    expect(review.activeDays).toBe(1);
    expect(review.busiestMonth).toBeNull();
    expect(review.busiestWeekday).toBeNull();
    expect(review.change).toBeNull();
    expect(review.topRepos).toEqual([]);

    const empty = demoEntity("user");
    Object.assign(empty, { calendar: null, wrapped: undefined });
    expect(reviewOf(empty, 2026)).toEqual({
      year: 2026,
      total: 0,
      days: 0,
      activeDays: 0,
      streak: null,
      bestDay: null,
      busiestMonth: null,
      busiestWeekday: null,
      change: null,
      topRepos: [],
    });
  });
});
