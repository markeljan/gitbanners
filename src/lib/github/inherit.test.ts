import { describe, expect, test } from "bun:test";
import { inheritOwner, inheritRepo } from "./inherit";
import { SAMPLE_ORG, SAMPLE_REPO, SAMPLE_USER } from "./samples";
import type { Org, Repo, User } from "./schema";

/** The sample user as the fast path alone returns it. */
function degraded(user: User): User {
  return {
    ...user,
    stats: {
      ...user.stats,
      commits: null,
      pullRequests: null,
      issues: null,
      reviews: null,
      contributedTo: null,
      stars: null,
    },
    repos: [],
    languages: [],
    organizations: [],
    complete: false,
    fetchedAt: "2026-11-14T00:00:00.000Z",
  };
}

describe("inheritOwner", () => {
  test("a complete user is returned as it is", () => {
    const fresh: User = { ...SAMPLE_USER, followers: 999 };
    expect(inheritOwner(fresh, SAMPLE_USER)).toBe(fresh);
  });

  test("a user whose slow path failed keeps totals and lists, and the fresh rest", () => {
    expect(SAMPLE_USER.complete).toBe(true);
    const loaded = { ...degraded(SAMPLE_USER), followers: 999 };
    const merged = inheritOwner(loaded, SAMPLE_USER) as User;
    expect(merged.stats.commits).toBe(SAMPLE_USER.stats.commits);
    expect(merged.stats.stars).toBe(SAMPLE_USER.stats.stars);
    expect(merged.repos).toEqual(SAMPLE_USER.repos);
    expect(merged.languages).toEqual(SAMPLE_USER.languages);
    expect(merged.organizations).toEqual(SAMPLE_USER.organizations);
    // Fresh data wins wherever it exists.
    expect(merged.followers).toBe(999);
    expect(merged.calendar).toBe(loaded.calendar);
    expect(merged.fetchedAt).toBe(loaded.fetchedAt);
    // The carried-over parts are one refresh behind: still not complete.
    expect(merged.complete).toBe(false);
  });

  test("only the missing totals are filled", () => {
    const loaded: User = {
      ...degraded(SAMPLE_USER),
      stats: { ...degraded(SAMPLE_USER).stats, commits: 7 },
      repos: SAMPLE_USER.repos.slice(0, 1),
    };
    const merged = inheritOwner(loaded, SAMPLE_USER) as User;
    expect(merged.stats.commits).toBe(7);
    expect(merged.stats.pullRequests).toBe(SAMPLE_USER.stats.pullRequests);
    expect(merged.repos).toHaveLength(1);
  });

  test("nothing is carried over from an incomplete snapshot", () => {
    const loaded = degraded(SAMPLE_USER);
    const previous: User = { ...SAMPLE_USER, complete: false };
    expect(inheritOwner(loaded, previous)).toBe(loaded);
  });

  test("another account, or another kind, starts over", () => {
    const loaded = degraded(SAMPLE_USER);
    expect(inheritOwner(loaded, { ...SAMPLE_USER, login: "someone" })).toBe(
      loaded,
    );
    expect(inheritOwner(loaded, SAMPLE_ORG)).toBe(loaded);
  });

  test("an organization keeps its chart when the new one is missing", () => {
    expect(SAMPLE_ORG.activity).not.toBeNull();
    const loaded: Org = { ...SAMPLE_ORG, activity: null };
    const merged = inheritOwner(loaded, SAMPLE_ORG) as Org;
    expect(merged.activity).toBe(SAMPLE_ORG.activity);
    const fresh: Org = { ...SAMPLE_ORG };
    expect(inheritOwner(fresh, { ...SAMPLE_ORG, activity: null })).toBe(fresh);
  });
});

describe("inheritRepo", () => {
  test("a complete repository is returned as it is", () => {
    const fresh: Repo = { ...SAMPLE_REPO, stars: 1 };
    expect(inheritRepo(fresh, SAMPLE_REPO)).toBe(fresh);
  });

  test("missing statistics are kept from the previous snapshot", () => {
    expect(SAMPLE_REPO.activity).not.toBeNull();
    expect(SAMPLE_REPO.contributors.length).toBeGreaterThan(0);
    const loaded: Repo = {
      ...SAMPLE_REPO,
      stars: 1,
      activity: null,
      starHistory: null,
      contributors: [],
      contributorCount: null,
    };
    const merged = inheritRepo(loaded, SAMPLE_REPO);
    expect(merged.activity).toBe(SAMPLE_REPO.activity);
    expect(merged.starHistory).toBe(SAMPLE_REPO.starHistory);
    expect(merged.contributors).toBe(SAMPLE_REPO.contributors);
    expect(merged.contributorCount).toBe(SAMPLE_REPO.contributorCount);
    expect(merged.stars).toBe(1);
  });

  test("a counted but empty contributor list is a fact, not a hole", () => {
    const loaded: Repo = {
      ...SAMPLE_REPO,
      contributors: [],
      contributorCount: 0,
    };
    expect(inheritRepo(loaded, SAMPLE_REPO)).toBe(loaded);
  });

  test("a renamed repository starts over", () => {
    const loaded: Repo = { ...SAMPLE_REPO, activity: null };
    const previous: Repo = { ...SAMPLE_REPO, fullName: "vercel/old-name" };
    expect(inheritRepo(loaded, previous)).toBe(loaded);
  });
});
