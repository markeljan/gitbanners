import { describe, expect, test } from "bun:test";
import { contextOf } from "@/lib/banner/build";
import type { Ctx } from "@/lib/banner/context";
import { DEMO_NOW, demoEntity } from "@/lib/banner/demo";
import {
  activityOf,
  CALCULATING,
  chartStyle,
  commitsCaption,
  fullScale,
  graphOf,
  levelOf,
  recentWeeks,
  resolveSections,
} from "@/lib/banner/graph";
import { parseOptions, resolveOptions } from "@/lib/banner/options";
import type { Entity, Org, Repo } from "@/lib/github/schema";

function ctxOf(entity: Entity, preset: string | null, query = ""): Ctx {
  return contextOf(
    entity,
    resolveOptions(
      entity.kind,
      preset,
      parseOptions(new URLSearchParams(query)),
    ),
    { image: () => "", now: new Date(DEMO_NOW), host: "gitbanners.test" },
  );
}

function repo(patch: (repo: Repo) => void = () => {}): Repo {
  const entity = demoEntity("repo");
  patch(entity);
  return entity;
}

function org(patch: (org: Org) => void = () => {}): Org {
  const entity = demoEntity("org");
  patch(entity);
  return entity;
}

/** The demo activity with its weekdays removed: only weekly totals are known. */
function weeklyOnly(entity: Repo): void {
  if (!entity.activity) return;
  entity.activity = {
    ...entity.activity,
    weeks: entity.activity.weeks.map((week) => ({ ...week, days: null })),
  };
}

describe("fullScale and levelOf", () => {
  test("the scale tops out at the 97th percentile of the busy entries", () => {
    const steady = Array.from({ length: 99 }, (_, index) => index + 1);
    expect(fullScale(steady)).toBe(97);
    // One release-day outlier does not move it.
    expect(fullScale([...steady, 5000])).toBe(98);
    // Zeros are not entries: a mostly idle year is scaled by its busy days.
    expect(fullScale([0, 0, 0, 0, 12, 0, 0, 20, 0])).toBe(20);
  });

  test("a quiet range still needs four commits for the top level", () => {
    expect(fullScale([])).toBe(4);
    expect(fullScale([0, 0, 0])).toBe(4);
    expect(fullScale([1, 0, 1])).toBe(4);
    expect(levelOf(1, fullScale([1]))).toBe(1);
  });

  test("levels are quarters of the scale", () => {
    expect(levelOf(0, 40)).toBe(0);
    expect(levelOf(-3, 40)).toBe(0);
    expect(levelOf(1, 40)).toBe(1);
    expect(levelOf(10, 40)).toBe(1);
    expect(levelOf(11, 40)).toBe(2);
    expect(levelOf(20, 40)).toBe(2);
    expect(levelOf(30, 40)).toBe(3);
    expect(levelOf(31, 40)).toBe(4);
    expect(levelOf(4000, 40)).toBe(4);
  });
});

describe("recentWeeks", () => {
  test("keeps the last year of weeks and makes them safe", () => {
    const activity = {
      total: 9,
      weeks: [
        ...Array.from({ length: 60 }, (_, index) => ({
          week: `week-${index}`,
          commits: index,
          days: [1, 1, 1, 1, 1, 1, 1],
        })),
        { week: 7, commits: -4, days: [1, 2, 3] },
        null,
        { week: "2026-11-08", commits: 2.9, days: [0, 1, "x", 0, 0, 1, 0] },
      ],
    } as never;
    const weeks = recentWeeks(activity);
    expect(weeks).toHaveLength(52);
    expect(weeks[0]?.week).toBe("week-10");
    expect(weeks[50]).toEqual({ week: "", commits: 0, days: null });
    expect(weeks[51]).toEqual({ week: "2026-11-08", commits: 2, days: null });
    expect(recentWeeks({ total: 0, weeks: "none" } as never)).toEqual([]);
  });
});

describe("chartStyle", () => {
  test("users have a contribution graph, not a commit chart", () => {
    expect(chartStyle(ctxOf(demoEntity("user"), "overview"))).toBeNull();
  });

  test("the calendar on every standard size, bars for the release preset", () => {
    for (const size of ["readme", "x", "linkedin", "og", "social", "square"]) {
      expect(chartStyle(ctxOf(repo(), "activity", `size=${size}`))).toBe(
        "calendar",
      );
      expect(chartStyle(ctxOf(org(), "activity", `size=${size}`))).toBe(
        "calendar",
      );
      expect(chartStyle(ctxOf(repo(), "release", `size=${size}`))).toBe("bars");
    }
  });

  test("bars where a year of cells would be too small to read", () => {
    expect(chartStyle(ctxOf(repo(), "activity", "width=495"))).toBe("bars");
    expect(chartStyle(ctxOf(repo(), "activity", "width=640"))).toBe("calendar");
    expect(chartStyle(ctxOf(repo(), "activity", "size=x&width=400"))).toBe(
      "bars",
    );
  });

  test("bars when the data has no weekdays", () => {
    expect(chartStyle(ctxOf(repo(weeklyOnly), "activity"))).toBe("bars");
  });

  test("a repository holds the place of its chart, an organization shows none", () => {
    const computing = repo((entity) => {
      entity.activity = null;
    });
    expect(chartStyle(ctxOf(computing, "activity"))).toBe("calendar");
    expect(chartStyle(ctxOf(computing, "release"))).toBe("bars");
    const silent = org((entity) => {
      entity.activity = null;
    });
    expect(chartStyle(ctxOf(silent, "activity"))).toBeNull();
    const empty = org((entity) => {
      entity.activity = { total: 0, weeks: [] };
    });
    expect(chartStyle(ctxOf(empty, "activity"))).toBeNull();
  });
});

describe("graphOf", () => {
  test("a user's graph is the contribution calendar", () => {
    const user = demoEntity("user");
    const graph = graphOf(ctxOf(user, "overview"));
    expect(graph?.grid.cells).toBe(user.calendar.days.length);
    expect(graph?.total).toBe(user.calendar.total);
    expect(graph?.label).toBe("contributions in the last year");
    expect(graph?.note).toBeNull();
    expect(graph?.live).toBe(true);
  });

  test("a repository's graph is its commits, day by day, up to today", () => {
    const entity = repo();
    const graph = graphOf(ctxOf(entity, "activity"));
    // 52 weeks, minus the Saturday after the demo's Friday.
    expect(graph?.grid.cols).toBe(52);
    expect(graph?.grid.cells).toBe(52 * 7 - 1);
    expect(graph?.grid.levels[51]?.[6]).toBeNull();
    expect(graph?.grid.levels[51]?.[5]).not.toBeNull();
    expect(graph?.total).toBe(entity.activity?.total ?? -1);
    expect(graph?.label).toBe("commits in the last year");
    expect(graph?.caption).toBe(
      `${(entity.activity?.total ?? 0).toLocaleString("en-US")} commits in the last year`,
    );
    expect(graph?.grid.months[0]).toEqual({ col: 0, label: "Nov" });
    expect(graph?.live).toBe(true);
  });

  test("levels follow the commit counts", () => {
    const entity = repo((r) => {
      if (!r.activity) return;
      r.activity = {
        total: 0,
        weeks: r.activity.weeks.map((week, index) => ({
          ...week,
          commits: index === 0 ? 100 : 0,
          days:
            index === 0 ? [0, 1, 25, 50, 75, 100, 4000] : [0, 0, 0, 0, 0, 0, 0],
        })),
      };
    });
    const levels = graphOf(ctxOf(entity, "activity"))?.grid.levels[0];
    // Six busy days: the 97th percentile is the outlier itself, so only it
    // and the days near it reach the upper levels.
    expect(levels?.[0]).toBe(0);
    expect(levels?.[1]).toBe(1);
    expect(levels?.[6]).toBe(4);
    expect(levels?.every((level) => level !== null && level >= 0)).toBe(true);
  });

  test("a clock that disagrees with the data is not trusted", () => {
    const entity = repo();
    for (const now of ["1970-01-01T00:00:00Z", "2031-05-05T00:00:00Z"]) {
      const ctx = { ...ctxOf(entity, "activity"), now: new Date(now) };
      expect(graphOf(ctx)?.grid.cells).toBe(52 * 7);
    }
    const noClock = {
      ...ctxOf(entity, "activity"),
      now: new Date(Number.NaN),
    };
    expect(graphOf(noClock)?.grid.cells).toBe(52 * 7);
  });

  test("an organization's total says what it covers", () => {
    const entity = org();
    const graph = graphOf(ctxOf(entity, "activity"));
    expect(graph?.caption).toBe(
      `${(entity.activity?.total ?? 0).toLocaleString("en-US")} commits to top repositories in the last year`,
    );
    expect(graph?.note).toBe("Across top public repositories");
    expect(graphOf(ctxOf(entity, "activity", "hide=title"))?.note).toBeNull();
    expect(graphOf(ctxOf(entity, "activity", "title=Busy"))?.note).toBeNull();
  });

  test("while GitHub computes, a blank year holds the place", () => {
    const computing = repo((entity) => {
      entity.activity = null;
    });
    const graph = graphOf(ctxOf(computing, "activity"));
    expect(graph?.live).toBe(false);
    expect(graph?.total).toBeNull();
    expect(graph?.caption).toBe(CALCULATING);
    // A year of weeks ending today, with real month labels and no levels.
    expect(graph?.grid.cols).toBe(52);
    expect(graph?.grid.months.length).toBeGreaterThan(10);
    expect(graph?.grid.levels.flat().every((level) => !level)).toBe(true);
    // The message is a state, not a title: hiding titles keeps it.
    expect(graphOf(ctxOf(computing, "activity", "hide=title"))?.caption).toBe(
      CALCULATING,
    );
  });

  test("no graph where bars are drawn or there is nothing to draw", () => {
    expect(graphOf(ctxOf(repo(), "release"))).toBeNull();
    expect(graphOf(ctxOf(repo(weeklyOnly), "activity"))).toBeNull();
    const silent = org((entity) => {
      entity.activity = null;
    });
    expect(graphOf(ctxOf(silent, "activity"))).toBeNull();
  });
});

describe("commitsCaption", () => {
  const ctx = ctxOf(repo(), "activity");
  test("counts, singular and none", () => {
    expect(commitsCaption(ctx, 6213)).toBe("6,213 commits in the last year");
    expect(commitsCaption(ctx, 1)).toBe("1 commit in the last year");
    expect(commitsCaption(ctx, 0)).toBe("No commits in the last year");
    expect(commitsCaption(ctx, null)).toBe(CALCULATING);
  });

  test("a custom title replaces it and hide=title removes it", () => {
    expect(
      commitsCaption(ctxOf(repo(), "activity", "title=Shipping"), 12),
    ).toBe("Shipping");
    expect(
      commitsCaption(ctxOf(repo(), "activity", "hide=title"), 12),
    ).toBeNull();
  });
});

describe("resolveSections", () => {
  test("commit activity drawn as a calendar becomes the heatmap section", () => {
    expect(
      resolveSections(ctxOf(repo(), "activity"), [
        "header",
        "activity",
        "stats",
      ]),
    ).toEqual(["header", "heatmap", "stats"]);
    expect(
      resolveSections(ctxOf(repo(), "release"), [
        "header",
        "stats",
        "activity",
      ]),
    ).toEqual(["header", "stats", "activity"]);
  });

  test("users keep their sections, and nothing is drawn twice", () => {
    const user = ctxOf(demoEntity("user"), "overview");
    expect(resolveSections(user, ["header", "activity", "heatmap"])).toEqual([
      "header",
      "activity",
      "heatmap",
    ]);
    expect(
      resolveSections(ctxOf(repo(), "activity"), [
        "heatmap",
        "activity",
        "header",
        "header",
      ]),
    ).toEqual(["heatmap", "header"]);
  });

  test("activityOf is the entity's own, or nothing", () => {
    expect(activityOf(ctxOf(demoEntity("user"), "overview"))).toBeNull();
    expect(activityOf(ctxOf(repo(), "activity"))?.weeks).toHaveLength(52);
    const odd = repo((entity) => {
      Object.assign(entity, { activity: "soon" });
    });
    expect(activityOf(ctxOf(odd, "activity"))).toBeNull();
  });
});
