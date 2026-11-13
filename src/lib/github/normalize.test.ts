import { describe, expect, test } from "bun:test";
import { fixture, fixtureData } from "./__fixtures__/mock";
import {
  FALLBACK_LANGUAGE_COLOR,
  isStatisticsPending,
  LIMITS,
  sumCommitActivity,
  toAvatarRefs,
  toCommitActivity,
  toContributors,
  toLanguageShares,
  toOrg,
  toOrgFromRest,
  toOwnerSuggestion,
  toRepo,
  toRepoSuggestion,
  toRepoSummary,
  toStarHistory,
  toUser,
  toUserFromRest,
  toUserRepos,
  toYearInReview,
  type UserSlowPath,
} from "./normalize";
import {
  decode,
  OrgExtrasDataSchema,
  OwnerCoreDataSchema,
  type RawOrgCore,
  type RawRepoCard,
  type RawRepoCore,
  type RawUserCore,
  type RawUserExtras,
  RepoCoreDataSchema,
  RestAccountsSchema,
  RestCommitActivitySchema,
  RestOrgSchema,
  RestStarHistorySchema,
  RestUserSchema,
  SearchOwnersDataSchema,
  SearchReposDataSchema,
  UserExtrasDataSchema,
  UserTotalsDataSchema,
  UserYearReviewDataSchema,
} from "./raw";
import {
  CommitActivitySchema,
  OrgSchema,
  OwnerSuggestionSchema,
  RepoSchema,
  UserSchema,
} from "./schema";

const NOW = new Date("2026-11-13T04:23:19.123Z");
const RECENT = { now: NOW, year: null };

function userCore(name: string): RawUserCore {
  const owner = decode(
    OwnerCoreDataSchema,
    fixtureData(name),
    name,
  ).repositoryOwner;
  if (owner?.__typename !== "User") throw new Error(`${name} is not a user`);
  return owner;
}

function orgCore(name: string): RawOrgCore {
  const owner = decode(
    OwnerCoreDataSchema,
    fixtureData(name),
    name,
  ).repositoryOwner;
  if (owner?.__typename !== "Organization") {
    throw new Error(`${name} is not an organization`);
  }
  return owner;
}

function userExtras(name: string): RawUserExtras {
  const user = decode(UserExtrasDataSchema, fixtureData(name), name).user;
  if (!user) throw new Error(`${name} has no user`);
  return user;
}

function repoCore(name: string): RawRepoCore {
  const repo = decode(RepoCoreDataSchema, fixtureData(name), name).repository;
  if (!repo) throw new Error(`${name} has no repository`);
  return repo;
}

function slowPath(login: "torvalds" | "sindresorhus"): UserSlowPath {
  return {
    extras: userExtras(`user-extras.${login}.json`),
    totals:
      decode(
        UserTotalsDataSchema,
        fixtureData(`user-totals.${login}.json`),
        "totals",
      ).user?.contributionsCollection ?? null,
    stars: 267_815,
    organizations: toAvatarRefs(
      decode(
        RestAccountsSchema,
        fixture(`user-orgs.${login}.json`),
        "organizations",
      ),
      LIMITS.organizations,
    ),
    review: null,
  };
}

/** A repository card that must never surface: not public. */
function privateCard(name: string): RawRepoCard {
  return {
    name,
    owner: { login: "torvalds" },
    description: "must not leak",
    stargazerCount: 999_999,
    forkCount: 1,
    isPrivate: true,
    visibility: "PRIVATE",
    isFork: false,
    isArchived: false,
    primaryLanguage: { name: "Secretlang", color: "#000000" },
    languages: {
      totalSize: 10_000_000_000,
      edges: [
        {
          size: 10_000_000_000,
          node: { name: "Secretlang", color: "#000000" },
        },
      ],
    },
  };
}

describe("toUser", () => {
  test("preview: fast path only, slow stats null, not complete", () => {
    const user = toUser(userCore("owner-core.torvalds.json"), null, RECENT);

    expect(UserSchema.parse(user)).toEqual(user);
    expect(user).toMatchObject({
      kind: "user",
      login: "torvalds",
      id: 1024025,
      name: "Linus Torvalds",
      bio: null,
      company: "Linux Foundation",
      location: "Portland, OR",
      websiteUrl: null,
      twitter: null,
      pronouns: null,
      createdAt: "2011-09-03T15:26:22Z",
      repos: [],
      languages: [],
      organizations: [],
      wrapped: null,
      complete: false,
      fetchedAt: "2026-11-13T04:23:19Z",
    });
    expect(user.stats).toEqual({
      contributions: 4015,
      commits: null,
      pullRequests: null,
      issues: null,
      reviews: null,
      contributedTo: null,
      repositories: 12,
      stars: null,
    });
    expect(user.calendar.days).toHaveLength(370);
    expect(user.streak).toMatchObject({ current: 26, longest: 104 });
    expect(user.bestDay).toEqual({ date: "2026-10-20", count: 68, level: 4 });
    expect(user.years[0]).toBe(2026);
    expect(user.years.at(-1)).toBe(2011);
  });

  test("complete: every slow-path field filled", () => {
    const user = toUser(
      userCore("owner-core.torvalds.json"),
      slowPath("torvalds"),
      RECENT,
    );

    expect(UserSchema.parse(user)).toEqual(user);
    expect(user.complete).toBe(true);
    expect(user.stats).toEqual({
      contributions: 4015,
      commits: 4006,
      pullRequests: 1,
      issues: 3,
      reviews: 2,
      contributedTo: 6,
      repositories: 12,
      stars: 267_815,
    });
    expect(user.organizations).toEqual([]);
    expect(user.repos).toHaveLength(6);
    expect(user.repos[0]).toEqual({
      owner: "torvalds",
      name: "linux",
      description: "Linux kernel source tree",
      stars: 255_542,
      forks: 67_168,
      language: { name: "C", color: "#555555" },
      isFork: false,
      isArchived: false,
      pinned: true,
    });
    expect(user.languages[0]).toMatchObject({ name: "C", color: "#555555" });
    expect(user.languages.length).toBeLessThanOrEqual(LIMITS.languages);
  });

  test("a second account: organizations, pronouns, empty strings", () => {
    const user = toUser(
      userCore("owner-core.sindresorhus.json"),
      slowPath("sindresorhus"),
      RECENT,
    );
    expect(UserSchema.parse(user)).toEqual(user);
    expect(user.login).toBe("sindresorhus");
    expect(user.organizations).toHaveLength(8);
    expect(user.organizations[0]).toEqual({
      login: "h5bp",
      avatarUrl: "https://avatars.githubusercontent.com/u/1136800?v=4",
    });
    // GitHub sends "" for unset text; the model only knows null.
    for (const value of [
      user.bio,
      user.company,
      user.location,
      user.pronouns,
    ]) {
      expect(value).not.toBe("");
    }
  });

  test("one missing slow-path part makes the user incomplete, not broken", () => {
    const user = toUser(
      userCore("owner-core.torvalds.json"),
      { ...slowPath("torvalds"), totals: null, stars: null },
      RECENT,
    );
    expect(UserSchema.parse(user)).toEqual(user);
    expect(user.complete).toBe(false);
    expect(user.stats.commits).toBeNull();
    expect(user.stats.stars).toBeNull();
    expect(user.repos).toHaveLength(6);
  });

  test("a calendar year: wrapped is set, a past year has no current streak", () => {
    const review = decode(
      UserYearReviewDataSchema,
      fixtureData("user-year-review.torvalds.2025.json"),
      "review",
    ).user;
    const context = { now: NOW, year: 2025 };
    const core = userCore("owner-core.torvalds.json");

    const full = toUser(core, { ...slowPath("torvalds"), review }, context);
    expect(UserSchema.parse(full)).toEqual(full);
    expect(full.complete).toBe(true);
    expect(full.wrapped).toEqual({
      year: 2025,
      previousTotal: 2892,
      topRepos: [
        { fullName: "torvalds/linux", commits: 2786 },
        { fullName: "torvalds/GuitarPedal", commits: 80 },
        { fullName: "torvalds/1590A", commits: 56 },
      ],
    });

    const withoutReview = toUser(core, slowPath("torvalds"), context);
    expect(withoutReview.complete).toBe(false);
    expect(withoutReview.wrapped).toEqual({
      year: 2025,
      previousTotal: null,
      topRepos: [],
    });

    const preview = toUser(core, null, context);
    expect(UserSchema.parse(preview)).toEqual(preview);
    expect(preview.wrapped?.year).toBe(2025);
  });
});

describe("privacy", () => {
  test("a private repository never reaches repos or languages", () => {
    const extras = userExtras("user-extras.torvalds.json");
    extras.pinnedItems.nodes?.unshift(privateCard("secret-pinned"));
    extras.topRepos.nodes?.unshift(privateCard("secret-top"));
    // "internal" repositories of an enterprise are not public either.
    extras.topRepos.nodes?.push({
      ...privateCard("secret-internal"),
      isPrivate: false,
      visibility: "INTERNAL",
    });

    const user = toUser(
      userCore("owner-core.torvalds.json"),
      { ...slowPath("torvalds"), extras },
      RECENT,
    );
    const serialized = JSON.stringify(user);
    expect(serialized).not.toContain("secret-");
    expect(serialized).not.toContain("Secretlang");
    expect(serialized).not.toContain("must not leak");
    expect(user.repos).toHaveLength(6);
    expect(user.languages[0]?.name).toBe("C");
    expect(toRepoSummary(privateCard("secret"), true)).toBeNull();
  });

  test("the year in review only lists public repositories", () => {
    const review = decode(
      UserYearReviewDataSchema,
      fixtureData("user-year-review.torvalds.2025.json"),
      "review",
    ).user;
    if (!review) throw new Error("fixture has no user");
    review.contributionsCollection.commitContributionsByRepository.unshift(
      {
        repository: {
          nameWithOwner: "torvalds/secret-work",
          isPrivate: true,
          visibility: "PRIVATE",
        },
        contributions: { totalCount: 9000 },
      },
      {
        repository: {
          nameWithOwner: "acme/secret-internal",
          isPrivate: false,
          visibility: "INTERNAL",
        },
        contributions: { totalCount: 8000 },
      },
    );
    const wrapped = toYearInReview(2025, review);
    expect(wrapped.topRepos.map((repo) => repo.fullName)).toEqual([
      "torvalds/linux",
      "torvalds/GuitarPedal",
      "torvalds/1590A",
    ]);
  });

  test("the year in review keeps at most five repositories, busiest first", () => {
    const entry = (name: string, commits: number) => ({
      repository: {
        nameWithOwner: name,
        isPrivate: false,
        visibility: "PUBLIC",
      },
      contributions: { totalCount: commits },
    });
    const wrapped = toYearInReview(2025, {
      contributionsCollection: {
        commitContributionsByRepository: [
          entry("a/one", 1),
          entry("a/seven", 7),
          entry("a/zero", 0),
          entry("a/three", 3),
          entry("a/nine", 9),
          entry("a/five", 5),
          entry("a/two", 2),
        ],
      },
      previous: { contributionCalendar: { totalContributions: 0 } },
    });
    expect(wrapped.previousTotal).toBe(0);
    expect(wrapped.topRepos.map((repo) => repo.commits)).toEqual([
      9, 7, 5, 3, 2,
    ]);
  });

  test("a private repository is no repository and no suggestion", () => {
    const core = repoCore("repo-core.sindresorhus-yocto-queue.json");
    const parts = {
      contributors: [],
      contributorCount: null,
      activity: null,
      starHistory: null,
    };
    expect(toRepo(core, parts, RECENT)).not.toBeNull();
    expect(
      toRepo(
        { ...core, isPrivate: true, visibility: "PRIVATE" },
        parts,
        RECENT,
      ),
    ).toBeNull();
    expect(
      toRepo({ ...core, visibility: "INTERNAL" }, parts, RECENT),
    ).toBeNull();
    expect(
      toRepoSuggestion({
        nameWithOwner: "acme/secret",
        description: null,
        stargazerCount: 1,
        isPrivate: true,
        visibility: "PRIVATE",
        owner: { avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" },
      }),
    ).toBeNull();
  });
});

describe("toUserRepos", () => {
  test("pinned first, then top by stars, de-duplicated, at most six", () => {
    const repos = toUserRepos(userExtras("user-extras.torvalds.json"));
    expect(repos.map((repo) => `${repo.name}:${repo.pinned}`)).toEqual([
      "linux:true",
      "GuitarPedal:true",
      "uemacs:true",
      "AudioNoise:true",
      "HunspellColorize:true",
      "test-tlb:false",
    ]);
    const keys = repos.map((repo) =>
      `${repo.owner}/${repo.name}`.toLowerCase(),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("six pinned repositories leave no room for others", () => {
    const repos = toUserRepos(userExtras("user-extras.sindresorhus.json"));
    expect(repos).toHaveLength(6);
    expect(repos.every((repo) => repo.pinned)).toBe(true);
  });

  test("unreadable nodes are skipped", () => {
    const extras = userExtras("user-extras.torvalds.json");
    extras.pinnedItems.nodes?.unshift(null);
    expect(toUserRepos(extras)[0]?.name).toBe("linux");
  });
});

describe("toLanguageShares", () => {
  const repo = (
    totalSize: number,
    ...edges: [name: string, size: number, color?: string | null][]
  ) => ({
    languages: {
      totalSize,
      edges: edges.map(([name, size, color]) => ({
        size,
        node: { name, color: color === undefined ? "#123456" : color },
      })),
    },
  });

  test("one decimal, largest first, sums to exactly 100", () => {
    const shares = toLanguageShares([repo(3, ["A", 1], ["B", 1], ["C", 1])]);
    expect(shares.map((share) => share.percent)).toEqual([33.4, 33.3, 33.3]);
    expect(shares.reduce((sum, share) => sum + share.percent * 10, 0)).toBe(
      1000,
    );
    expect(shares.map((share) => share.bytes)).toEqual([1, 1, 1]);
  });

  test("aggregates bytes across repositories", () => {
    const shares = toLanguageShares([
      repo(100, ["TypeScript", 60], ["CSS", 40]),
      repo(300, ["Rust", 200], ["TypeScript", 100]),
    ]);
    expect(shares).toEqual([
      { name: "Rust", color: "#123456", percent: 50, bytes: 200 },
      { name: "TypeScript", color: "#123456", percent: 40, bytes: 160 },
      { name: "CSS", color: "#123456", percent: 10, bytes: 40 },
    ]);
  });

  test("the share is of all bytes, including languages GitHub did not list", () => {
    const shares = toLanguageShares([repo(1000, ["Go", 600], ["Shell", 150])]);
    expect(shares.map((share) => share.percent)).toEqual([60, 15]);
  });

  test("a missing colour becomes GitHub's grey", () => {
    const [share] = toLanguageShares([repo(10, ["Brainfuck", 10, null])]);
    expect(share?.color).toBe(FALLBACK_LANGUAGE_COLOR);
    expect(FALLBACK_LANGUAGE_COLOR).toBe("#8b949e");
  });

  test("at most eight, and nothing that rounds to zero", () => {
    const many = Array.from({ length: 12 }, (_, index): [string, number] => [
      `L${index}`,
      1000 - index,
    ]);
    expect(toLanguageShares([repo(11_934, ...many)])).toHaveLength(8);

    const tiny = toLanguageShares([
      repo(1_000_000, ["Big", 999_999], ["Tiny", 1]),
    ]);
    expect(tiny).toEqual([
      { name: "Big", color: "#123456", percent: 100, bytes: 999_999 },
    ]);
  });

  test("no bytes, no languages", () => {
    expect(toLanguageShares([])).toEqual([]);
    expect(toLanguageShares([{ languages: null }, repo(0)])).toEqual([]);
  });

  test("real repositories: every fixture stays within 100", () => {
    for (const name of [
      "repo-core.vercel-next.js.json",
      "repo-core.sindresorhus-yocto-queue.json",
      "repo-core.facebook-react.json",
      "repo-core.torvalds-linux.json",
    ]) {
      const shares = toLanguageShares([repoCore(name)]);
      const sum = shares.reduce((total, share) => total + share.percent, 0);
      expect(sum).toBeGreaterThan(99);
      expect(sum).toBeLessThanOrEqual(100.0001);
      expect(shares.map((s) => s.bytes)).toEqual(
        [...shares.map((s) => s.bytes)].sort((a, b) => b - a),
      );
    }
  });
});

describe("toOrg", () => {
  const parts = () => ({
    followers: decode(RestOrgSchema, fixture("rest-org.vercel.json"), "org")
      .followers as number,
    members: 72,
    people: toAvatarRefs(
      decode(
        RestAccountsSchema,
        fixture("public-members.vercel.json"),
        "members",
      ),
      LIMITS.people,
    ),
    extras: decode(
      OrgExtrasDataSchema,
      fixtureData("org-extras.vercel.json"),
      "extras",
    ).organization,
    activity: toCommitActivity(
      decode(
        RestCommitActivitySchema,
        fixture("commit-activity.vercel-next.js.json"),
        "activity",
      ),
    ),
  });

  test("a complete organization", () => {
    const org = toOrg(orgCore("owner-core.vercel.json"), parts(), RECENT);

    expect(OrgSchema.parse(org)).toEqual(org);
    expect(org).toMatchObject({
      kind: "org",
      login: "vercel",
      id: 14_985_020,
      name: "Vercel",
      location: null,
      websiteUrl: "https://vercel.com",
      twitter: "vercel",
      isVerified: true,
      createdAt: "2015-10-05T19:40:30Z",
    });
    expect(org.stats.repositories).toBe(244);
    expect(org.stats.members).toBe(72);
    expect(org.stats.followers).toBeGreaterThan(30_000);
    // Totals come from the top 100 repositories, not just the six shown.
    const shown = org.repos.reduce((sum, repo) => sum + repo.stars, 0);
    expect(org.stats.stars).toBeGreaterThan(shown);
    expect(org.repos.map((repo) => repo.name)).toEqual([
      "next.js",
      "hyper",
      "swr",
      "turborepo",
      "ai",
      "pkg",
    ]);
    expect(
      org.repos.filter((repo) => repo.pinned).map((repo) => repo.name),
    ).toEqual(["next.js", "swr", "turborepo", "ai"]);
    expect(org.people).toHaveLength(24);
    expect(org.languages[0]?.name).toBe("TypeScript");
    expect(org.activity?.weeks).toHaveLength(52);
  });

  test("failed extras degrade instead of breaking", () => {
    const org = toOrg(
      orgCore("owner-core.vercel.json"),
      {
        followers: null,
        members: null,
        people: null,
        extras: null,
        activity: null,
      },
      RECENT,
    );
    expect(OrgSchema.parse(org)).toEqual(org);
    expect(org.stats.members).toBeNull();
    expect(org.stats.followers).toBeNull();
    expect(org.people).toEqual([]);
    expect(org.languages).toEqual([]);
    expect(org.activity).toBeNull();
    // Falls back to the six repositories that came with the core.
    expect(org.stats.stars).toBe(
      org.repos.reduce((sum, repo) => sum + repo.stars, 0),
    );
    expect(org.stats.forks).toBe(
      org.repos.reduce((sum, repo) => sum + repo.forks, 0),
    );
  });
});

describe("toRepo", () => {
  const parts = {
    contributors: [],
    contributorCount: null,
    activity: null,
    starHistory: null,
  };

  test.each([
    "repo-core.vercel-next.js.json",
    "repo-core.sindresorhus-yocto-queue.json",
    "repo-core.facebook-react.json",
    "repo-core.torvalds-linux.json",
  ])("%s satisfies the schema", (name) => {
    const repo = toRepo(repoCore(name), parts, RECENT);
    expect(repo).not.toBeNull();
    expect(RepoSchema.parse(repo)).toEqual(repo as NonNullable<typeof repo>);
  });

  test("an organization's repository", () => {
    const repo = toRepo(
      repoCore("repo-core.vercel-next.js.json"),
      parts,
      RECENT,
    );
    expect(repo).toMatchObject({
      kind: "repo",
      owner: { login: "vercel", kind: "org" },
      name: "next.js",
      fullName: "vercel/next.js",
      description: "The React Framework",
      homepageUrl: "https://nextjs.org",
      language: { name: "JavaScript", color: "#f1e05a" },
      license: "MIT",
      isArchived: false,
      isFork: false,
      fetchedAt: "2026-11-13T04:23:19Z",
    });
    expect(repo?.latestRelease?.tag).toMatch(/^v\d+\./);
    expect(repo?.commits).toBeGreaterThan(30_000);
    expect(repo?.topics.length).toBeGreaterThan(0);
  });

  test("a renamed repository reports its current name and owner", () => {
    // Requested as facebook/react; React has moved to its own organization.
    const repo = toRepo(
      repoCore("repo-core.facebook-react.json"),
      parts,
      RECENT,
    );
    expect(repo?.fullName).toBe("react/react");
    expect(repo?.owner.login).toBe("react");
    expect(repo?.name).toBe("react");
  });

  test("a user's repository without release, licence name or homepage", () => {
    const repo = toRepo(
      repoCore("repo-core.torvalds-linux.json"),
      parts,
      RECENT,
    );
    expect(repo?.owner.kind).toBe("user");
    // GitHub reports the kernel's licence as NOASSERTION.
    expect(repo?.license).toBeNull();
    expect(repo?.latestRelease).toBeNull();
    expect(repo?.homepageUrl).toBeNull();
    expect(repo?.topics).toEqual([]);
    expect(repo?.commits).toBeGreaterThan(1_000_000);
  });

  test("an empty repository has no branch, no commits, no languages", () => {
    const core = repoCore("repo-core.sindresorhus-yocto-queue.json");
    const repo = toRepo(
      {
        ...core,
        defaultBranchRef: null,
        primaryLanguage: null,
        languages: null,
        pushedAt: null,
        licenseInfo: null,
      },
      parts,
      RECENT,
    );
    expect(RepoSchema.parse(repo)).toEqual(repo as NonNullable<typeof repo>);
    expect(repo).toMatchObject({
      commits: null,
      language: null,
      languages: [],
      pushedAt: null,
      license: null,
    });
  });
});

describe("REST add-ons", () => {
  const nextActivity = () =>
    decode(
      RestCommitActivitySchema,
      fixture("commit-activity.vercel-next.js.json"),
      "activity",
    );

  test("commit activity: 52 weeks, oldest first, weekdays kept", () => {
    const activity = toCommitActivity(nextActivity());
    expect(CommitActivitySchema.parse(activity)).toEqual(activity);
    expect(activity.weeks).toHaveLength(52);
    expect(activity.weeks[0]?.week).toBe("2025-11-16");
    expect(activity.weeks.at(-1)?.week).toBe("2026-11-08");
    expect(activity.total).toBe(
      activity.weeks.reduce((sum, week) => sum + week.commits, 0),
    );
    for (const week of activity.weeks) {
      expect(week.days).toHaveLength(7);
      expect(week.days?.reduce((sum, day) => sum + day, 0)).toBe(week.commits);
      // Weeks start on Sunday (UTC).
      expect(new Date(`${week.week}T00:00:00Z`).getUTCDay()).toBe(0);
    }
  });

  test("commit activity without usable weekdays keeps the weekly total", () => {
    const activity = toCommitActivity([
      { week: 1_794_096_000, total: 5, days: [1, 4] },
      { week: 1_793_491_200, total: 2 },
    ]);
    expect(activity).toEqual({
      total: 7,
      weeks: [
        { week: "2026-11-01", commits: 2, days: null },
        { week: "2026-11-08", commits: 5, days: null },
      ],
    });
  });

  test("organization activity is the week-by-week sum", () => {
    const next = toCommitActivity(nextActivity());
    const yocto = toCommitActivity(
      decode(
        RestCommitActivitySchema,
        fixture("commit-activity.sindresorhus-yocto-queue.json"),
        "activity",
      ),
    );
    const sum = sumCommitActivity([next, yocto]);
    expect(CommitActivitySchema.parse(sum)).toEqual(sum);
    expect(sum.weeks).toHaveLength(52);
    expect(sum.total).toBe(next.total + yocto.total);
    const last = sum.weeks.at(-1);
    expect(last?.commits).toBe(
      (next.weeks.at(-1)?.commits ?? 0) + (yocto.weeks.at(-1)?.commits ?? 0),
    );
    expect(last?.days?.reduce((a, b) => a + b, 0)).toBe(last?.commits);
    // Inputs are not modified.
    expect(next).toEqual(toCommitActivity(nextActivity()));
  });

  test("activities one week apart are matched by date, newest 52 kept", () => {
    const next = toCommitActivity(nextActivity());
    const stale = { ...next, weeks: next.weeks.slice(0, -1) };
    const sum = sumCommitActivity([next, stale]);
    expect(sum.weeks).toHaveLength(52);
    expect(sum.weeks.at(-1)).toEqual(
      next.weeks.at(-1) as (typeof next.weeks)[0],
    );
    expect(sum.weeks[0]?.commits).toBe((next.weeks[0]?.commits ?? 0) * 2);

    const noDays = {
      total: 1,
      weeks: [{ week: next.weeks[0]?.week ?? "", commits: 1, days: null }],
    };
    expect(sumCommitActivity([next, noDays]).weeks[0]?.days).toBeNull();
    expect(sumCommitActivity([])).toEqual({ total: 0, weeks: [] });
  });

  test("star history: cumulative, oldest first, ends on today's count", () => {
    const weeks = decode(
      RestStarHistorySchema,
      fixture("stargazers-history.vercel-next.js.json"),
      "stars",
    );
    const history = toStarHistory(weeks, 143_498);
    expect(history).toHaveLength(30);
    expect(history.at(-1)).toEqual({ week: "2026-11-08", stars: 143_498 });
    expect(history[0]?.week).toBe("2026-04-19");
    for (const [index, point] of history.entries()) {
      const previous = history[index - 1];
      if (previous) expect(point.stars).toBeGreaterThanOrEqual(previous.stars);
    }
    // Each step is exactly that week's new stars.
    const newest = [...weeks].sort((a, b) => b.week - a.week)[0];
    expect((history.at(-1)?.stars ?? 0) - (history.at(-2)?.stars ?? 0)).toBe(
      newest?.total ?? Number.NaN,
    );
  });

  test("star history never goes below zero and tolerates no data", () => {
    expect(
      toStarHistory(
        [
          { week: 1_794_096_000, total: 10 },
          { week: 1_793_491_200, total: 10 },
        ],
        5,
      ),
    ).toEqual([
      { week: "2026-11-01", stars: 0 },
      { week: "2026-11-08", stars: 5 },
    ]);
    expect(toStarHistory([], 5)).toEqual([]);
  });

  test("contributors: bots out, most commits first, at most 30", () => {
    const raw = decode(
      RestAccountsSchema,
      fixture("contributors.vercel-next.js.json"),
      "contributors",
    );
    expect(raw).toHaveLength(40);
    const contributors = toContributors(raw);
    expect(contributors).toHaveLength(30);
    expect(contributors[0]).toEqual({
      login: "ijjk",
      avatarUrl: "https://avatars.githubusercontent.com/u/22380829?v=4",
      contributions: 3296,
    });
    const logins = contributors.map((contributor) => contributor.login);
    for (const bot of [
      "vercel-release-bot",
      "nextjs-bot",
      "next-js-bot[bot]",
      "greenkeeper[bot]",
    ]) {
      expect(logins).not.toContain(bot);
    }
    expect(contributors.map((c) => c.contributions)).toEqual(
      [...contributors.map((c) => c.contributions)].sort((a, b) => b - a),
    );
  });

  test("avatar references are capped and skip unreadable rows", () => {
    const members = decode(
      RestAccountsSchema,
      [
        {
          login: "a",
          avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
        },
        { nonsense: true },
        {
          login: "b",
          avatar_url: "https://avatars.githubusercontent.com/u/2?v=4",
        },
        {
          login: "c",
          avatar_url: "https://avatars.githubusercontent.com/u/3?v=4",
        },
      ],
      "members",
    );
    expect(toAvatarRefs(members, 2)).toEqual([
      {
        login: "a",
        avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      },
      {
        login: "b",
        avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
      },
    ]);
  });
});

describe("tokenless profiles", () => {
  test("a user from REST is a valid, incomplete user", () => {
    const profile = decode(
      RestUserSchema,
      fixture("rest-user.torvalds.json"),
      "profile",
    );
    const user = toUserFromRest(profile, null, RECENT);
    expect(UserSchema.parse(user)).toEqual(user);
    expect(user).toMatchObject({
      login: "torvalds",
      id: 1024025,
      name: "Linus Torvalds",
      websiteUrl: null,
      complete: false,
      years: [],
    });
    expect(user.calendar).toEqual({
      total: 0,
      from: "2026-11-13",
      to: "2026-11-13",
      days: [],
    });
    expect(user.streak.current).toBe(0);
    expect(user.bestDay).toBeNull();
    expect(user.stats.repositories).toBe(12);
  });

  test("an organization from REST", () => {
    const org = toOrgFromRest(
      decode(RestOrgSchema, fixture("rest-org.vercel.json"), "org"),
      RECENT,
    );
    expect(OrgSchema.parse(org)).toEqual(org);
    expect(org).toMatchObject({
      login: "vercel",
      name: "Vercel",
      isVerified: true,
      repos: [],
      people: [],
      activity: null,
    });
    expect(org.stats.repositories).toBe(244);
    expect(org.stats.members).toBeNull();
  });
});

describe("suggestions", () => {
  test("accounts", () => {
    const hits = decode(
      SearchOwnersDataSchema,
      fixtureData("search-owners.verc.json"),
      "search",
    ).search.nodes;
    const suggestions = (hits ?? []).flatMap((hit) =>
      hit ? [toOwnerSuggestion(hit)] : [],
    );
    expect(suggestions).toHaveLength(6);
    for (const suggestion of suggestions) {
      expect(OwnerSuggestionSchema.parse(suggestion)).toEqual(suggestion);
    }
    expect(suggestions[0]).toEqual({
      kind: "org",
      slug: "vercel",
      title: "Vercel",
      avatarUrl: "https://avatars.githubusercontent.com/u/14985020?s=64&v=4",
      stars: null,
    });
    expect(suggestions.some((suggestion) => suggestion.kind === "user")).toBe(
      true,
    );
  });

  test("repositories", () => {
    const hits = decode(
      SearchReposDataSchema,
      fixtureData("search-repos.vercel-ne.json"),
      "search",
    ).search.nodes;
    const [first] = (hits ?? []).flatMap((hit) => {
      const suggestion = hit && toRepoSuggestion(hit);
      return suggestion ? [suggestion] : [];
    });
    expect(first).toMatchObject({
      kind: "repo",
      slug: "vercel/next.js",
      title: "The React Framework",
    });
    expect(first?.stars).toBeGreaterThan(100_000);
  });
});

describe("isStatisticsPending", () => {
  const repo = toRepo(
    repoCore("repo-core.vercel-next.js.json"),
    {
      contributors: [],
      contributorCount: null,
      activity: null,
      starHistory: [],
    },
    RECENT,
  );
  if (!repo) throw new Error("fixture is not public");

  test("a repository whose chart is missing while REST works", () => {
    expect(isStatisticsPending(repo)).toBe(true);
    expect(
      isStatisticsPending({ ...repo, activity: { total: 0, weeks: [] } }),
    ).toBe(false);
  });

  test("not when REST as a whole failed", () => {
    expect(isStatisticsPending({ ...repo, starHistory: null })).toBe(false);
  });

  test("organizations likewise, users never", () => {
    const org = toOrg(
      orgCore("owner-core.vercel.json"),
      { followers: 1, members: 1, people: [], extras: null, activity: null },
      RECENT,
    );
    expect(isStatisticsPending(org)).toBe(true);
    expect(
      isStatisticsPending({ ...org, stats: { ...org.stats, followers: null } }),
    ).toBe(false);
    expect(
      isStatisticsPending({ ...org, activity: { total: 0, weeks: [] } }),
    ).toBe(false);
    expect(
      isStatisticsPending(
        toUser(userCore("owner-core.torvalds.json"), null, RECENT),
      ),
    ).toBe(false);
  });

  test("a tokenless organization has no statistics to wait for", () => {
    // Otherwise it would be re-fetched every minute on a 60-per-hour budget.
    const org = toOrgFromRest(
      decode(RestOrgSchema, fixture("rest-org.vercel.json"), "org"),
      RECENT,
    );
    expect(org.activity).toBeNull();
    expect(org.stats.followers).not.toBeNull();
    expect(isStatisticsPending(org)).toBe(false);
  });
});
