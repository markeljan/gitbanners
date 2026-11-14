import { describe, expect, test } from "bun:test";
import { demoEntity } from "@/lib/banner/demo";
import { STAT_IDS } from "@/lib/banner/options";
import { PRESET_DEFAULTS, PRESETS } from "@/lib/banner/presets";
import { PENDING, showsStat, statIds, statTiles } from "@/lib/banner/stats";

describe("statTiles", () => {
  test("users: every stat that applies, formatted and labelled", () => {
    const user = demoEntity("user");
    const tiles = statTiles(user, STAT_IDS);
    expect(tiles.map((tile) => tile.id)).toEqual([
      "contributions",
      "commits",
      "pullRequests",
      "issues",
      "reviews",
      "contributedTo",
      "followers",
      "streak",
      "stars",
      "repositories",
    ]);
    const byId = Object.fromEntries(tiles.map((tile) => [tile.id, tile]));
    expect(byId.followers).toEqual({
      id: "followers",
      label: "Followers",
      value: "1.3k",
    });
    expect(byId.stars).toEqual({ id: "stars", label: "Stars", value: "30.2k" });
    expect(byId.pullRequests.label).toBe("Pull requests");
    expect(byId.contributedTo.label).toBe("Contributed to");
    expect(byId.streak).toEqual({
      id: "streak",
      label: "Day streak",
      value: String(user.streak.current),
    });
  });

  test("organizations and repositories", () => {
    expect(statTiles(demoEntity("org"), STAT_IDS)).toEqual([
      { id: "followers", label: "Followers", value: "3.1k" },
      { id: "stars", label: "Stars", value: "48.2k" },
      { id: "repositories", label: "Repositories", value: "128" },
      { id: "forks", label: "Forks", value: "5.9k" },
      { id: "members", label: "Members", value: "36" },
    ]);
    const repo = demoEntity("repo");
    expect(statTiles(repo, STAT_IDS)).toEqual([
      {
        id: "stars",
        label: "Stars",
        value: "18.4k",
        trend: repo.starHistory?.map((point) => point.stars),
      },
      { id: "forks", label: "Forks", value: "912" },
      { id: "watchers", label: "Watchers", value: "187" },
      { id: "openIssues", label: "Open issues", value: "143" },
      { id: "openPullRequests", label: "Open pull requests", value: "27" },
      { id: "contributors", label: "Contributors", value: "214" },
      { id: "totalCommits", label: "Commits", value: "6.8k" },
      { id: "release", label: "Latest release", value: "v4.2.0" },
    ]);
  });

  test("keeps the caller's order and drops repeats", () => {
    const tiles = statTiles(demoEntity("user"), [
      "stars",
      "followers",
      "stars",
      "contributions",
    ]);
    expect(tiles.map((tile) => tile.id)).toEqual([
      "stars",
      "followers",
      "contributions",
    ]);
  });

  test("missing numbers: a dash while loading, gone once complete", () => {
    const user = demoEntity("user");
    user.stats = { ...user.stats, commits: null, stars: null };
    const ids = ["contributions", "commits", "stars", "followers"] as const;
    user.complete = false;
    expect(statTiles(user, ids).map((tile) => tile.value)).toEqual([
      "2.5k",
      PENDING,
      PENDING,
      "1.3k",
    ]);
    user.complete = true;
    expect(statTiles(user, ids).map((tile) => tile.id)).toEqual([
      "contributions",
      "followers",
    ]);
  });

  test("a hidden roster is never printed as zero members", () => {
    const org = demoEntity("org");
    org.stats = { ...org.stats, members: null, followers: null };
    expect(
      statTiles(org, ["repositories", "members", "followers", "stars"]).map(
        (tile) => tile.id,
      ),
    ).toEqual(["repositories", "stars"]);
    const repo = demoEntity("repo");
    Object.assign(repo, {
      latestRelease: null,
      commits: null,
      contributorCount: null,
    });
    expect(
      statTiles(repo, ["release", "totalCommits", "contributors", "stars"]).map(
        (tile) => tile.id,
      ),
    ).toEqual(["stars"]);
    // Outsiders only see public members: none visible means hidden, not zero.
    org.stats = { ...org.stats, members: 0 };
    expect(statTiles(org, ["members", "stars"]).map((tile) => tile.id)).toEqual(
      ["stars"],
    );
  });

  test("stars carry their history as a trend, when there is one", () => {
    const repo = demoEntity("repo");
    const [stars] = statTiles(repo, ["stars"]);
    expect(stars?.trend).toHaveLength(30);
    expect(stars?.trend?.at(-1)).toBe(repo.stars);
    expect(statTiles({ ...repo, starHistory: null }, ["stars"])[0]).toEqual({
      id: "stars",
      label: "Stars",
      value: "18.4k",
    });
    // Two points are a difference, not a trend.
    const short = { ...repo, starHistory: repo.starHistory?.slice(0, 2) ?? [] };
    expect(statTiles(short, ["stars"])[0]?.trend).toBeUndefined();
    const junk = {
      ...repo,
      starHistory: [null, { stars: Number.NaN }, { stars: 5 }] as never,
    };
    expect(statTiles(junk, ["stars"])[0]?.trend).toBeUndefined();
    // Users and organizations have stars, but no history of them.
    expect(statTiles(demoEntity("user"), ["stars"])[0]?.trend).toBeUndefined();
    expect(statTiles(demoEntity("org"), ["stars"])[0]?.trend).toBeUndefined();
  });

  test("a release says when it came out, given a clock", () => {
    const repo = demoEntity("repo");
    const at = (now: string) =>
      statTiles(repo, ["release"], new Date(now))[0]?.label;
    expect(at("2026-11-13T12:00:00Z")).toBe("Released last week");
    expect(at("2026-11-03T23:00:00Z")).toBe("Released today");
    expect(at("2026-11-04T01:00:00Z")).toBe("Released yesterday");
    expect(at("2027-03-01T00:00:00Z")).toBe("Released 3 months ago");
    // Without a clock, or without a date, it is simply the latest one.
    expect(statTiles(repo, ["release"])[0]).toEqual({
      id: "release",
      label: "Latest release",
      value: "v4.2.0",
    });
    const undated = {
      ...repo,
      latestRelease: { tag: "v1", name: null, publishedAt: null },
    };
    expect(statTiles(undated, ["release"], new Date())[0]?.label).toBe(
      "Latest release",
    );
    expect(statTiles(repo, ["release"], new Date(Number.NaN))[0]?.label).toBe(
      "Latest release",
    );
  });
});

describe("showsStat", () => {
  test("true only when the stat row is drawn and holds the tile", () => {
    const repo = demoEntity("repo");
    const base = { stats: null, sections: null };
    expect(showsStat(repo, { ...base, preset: "release" }, "release")).toBe(
      true,
    );
    expect(showsStat(repo, { ...base, preset: "overview" }, "release")).toBe(
      false,
    );
    expect(
      showsStat(
        repo,
        { preset: "overview", stats: ["release"], sections: null },
        "release",
      ),
    ).toBe(true);
    // The tile is configured, but the banner has no stat row.
    expect(
      showsStat(
        repo,
        { preset: "release", stats: null, sections: ["header", "activity"] },
        "release",
      ),
    ).toBe(false);
  });
});

describe("statIds", () => {
  test("the caller's list, else the preset's, else the kind's default", () => {
    const user = demoEntity("user");
    expect(statIds(user, { preset: "overview", stats: ["stars"] })).toEqual([
      "stars",
    ]);
    expect(statIds(user, { preset: "card", stats: null })).toEqual(
      PRESET_DEFAULTS["user/card"]?.stats ?? [],
    );
    // `repos` has no stat row of its own: `show=stats` still shows numbers.
    expect(statIds(user, { preset: "repos", stats: null })).toEqual(
      PRESET_DEFAULTS["user/overview"]?.stats ?? [],
    );
    expect(statIds(user, { preset: "nope", stats: [] })).toEqual(
      PRESET_DEFAULTS["user/overview"]?.stats ?? [],
    );
  });

  test("every preset's default tiles exist for its kind", () => {
    for (const preset of PRESETS) {
      const entity = demoEntity(preset.kind);
      const ids = PRESET_DEFAULTS[`${preset.kind}/${preset.id}`]?.stats ?? [];
      expect(statTiles(entity, ids).map((tile) => tile.id)).toEqual([...ids]);
    }
  });
});
