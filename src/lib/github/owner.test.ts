import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  setSystemTime,
  spyOn,
  test,
} from "bun:test";
import {
  type FakeGitHub,
  fakeGitHub,
  fixture,
  fixtureText,
  type Handler,
  htmlTimeout,
  json,
  linkHeader,
  type Reply,
  type Routes,
} from "./__fixtures__/mock";
import { GitHubError } from "./errors";
import { fetchOwner, fetchOwnerPreview } from "./owner";
import { OrgSchema, type Owner, UserSchema } from "./schema";

const NOW = new Date("2026-11-13T04:23:19Z");

/**
 * A login the fetchers have never seen. They remember per process what a
 * login resolved to, and that memory outlives a re-run of this file.
 */
const neverSeen = (prefix: string) =>
  `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

const PAGE_FILES = [
  "user-repo-stats.sindresorhus.page1.json",
  "user-repo-stats.sindresorhus.page2.json",
  "user-repo-stats.sindresorhus.page3.json",
];

interface StatsPage {
  data: {
    user: {
      repositories: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: { stargazerCount: number }[];
      };
    };
  };
}

const statsPage = (name: string) => fixture(name) as StatsPage;
const starsOn = (name: string) =>
  statsPage(name).data.user.repositories.nodes.reduce(
    (sum, node) => sum + node.stargazerCount,
    0,
  );

/** Serves the three recorded pages of sindresorhus' repositories by cursor. */
const pagedStats: Handler = (call) => {
  const cursors = PAGE_FILES.map(
    (name) => statsPage(name).data.user.repositories.pageInfo.endCursor,
  );
  const after = call.variables?.after ?? null;
  const index = after === null ? 0 : cursors.indexOf(String(after)) + 1;
  return json(fixture(PAGE_FILES[index] ?? "missing"));
};

function userRoutes(
  login: "torvalds" | "sindresorhus",
  graphql: Record<string, Reply> = {},
): Routes {
  return {
    graphql: {
      OwnerCore: fixture(`owner-core.${login}.json`) as object,
      UserExtras: fixture(`user-extras.${login}.json`) as object,
      UserTotals: fixture(`user-totals.${login}.json`) as object,
      UserRepoStats:
        login === "torvalds"
          ? (fixture("user-repo-stats.torvalds.json") as object)
          : pagedStats,
      UserYearReview: fixture("user-year-review.torvalds.2025.json") as object,
      ...graphql,
    },
    rest: [
      [
        /^\/users\/[^/]+\/orgs\?per_page=8$/,
        fixture(`user-orgs.${login}.json`) as object,
      ],
    ],
  };
}

const MEMBERS = "https://api.github.com/organizations/14985020/public_members";

function orgRoutes(overrides: Partial<Routes> = {}): Routes {
  return {
    graphql: {
      OwnerCore: fixture("owner-core.vercel.json") as object,
      OrgExtras: fixture("org-extras.vercel.json") as object,
      // What the user documents answer for a login that is not a user.
      UserExtras: fixture("user-extras.not-a-user.json") as object,
      UserTotals: fixture("user-extras.not-a-user.json") as object,
      UserRepoStats: fixture("user-extras.not-a-user.json") as object,
      ...overrides.graphql,
    },
    rest: [
      ...(overrides.rest ?? []),
      [/^\/users\/[^/]+\/orgs\?/, []],
      [/^\/orgs\/vercel$/, fixture("rest-org.vercel.json") as object],
      [
        /^\/orgs\/vercel\/public_members\?per_page=24$/,
        json(fixture("public-members.vercel.json"), {
          headers: { link: linkHeader(`${MEMBERS}?per_page=24`, 3) },
        }),
      ],
      [
        /^\/orgs\/vercel\/public_members\?per_page=1$/,
        json([], {
          headers: { link: linkHeader(`${MEMBERS}?per_page=1`, 72) },
        }),
      ],
      [
        /^\/repos\/vercel\/next\.js\/stats\/commit_activity$/,
        fixture("commit-activity.vercel-next.js.json") as object,
      ],
      [
        /^\/repos\/vercel\/[^/]+\/stats\/commit_activity$/,
        fixture("commit-activity.sindresorhus-yocto-queue.json") as object,
      ],
    ],
  };
}

let fake: FakeGitHub;
let warn: Mock<typeof console.warn>;

function serve(routes: Routes): FakeGitHub {
  fake = fakeGitHub(routes);
  return fake;
}

/** What was requested, GraphQL by operation and REST by path, sorted. */
const requested = () =>
  fake.calls.map((call) => call.operation ?? call.path).sort();

function asUser(owner: Owner | null) {
  if (owner?.kind !== "user")
    throw new Error(`expected a user, got ${owner?.kind}`);
  expect(UserSchema.parse(owner)).toEqual(owner);
  return owner;
}

function asOrg(owner: Owner | null) {
  if (owner?.kind !== "org")
    throw new Error(`expected an org, got ${owner?.kind}`);
  expect(OrgSchema.parse(owner)).toEqual(owner);
  return owner;
}

beforeEach(() => {
  process.env.GITHUB_TOKEN = "server-token";
  warn = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  fake?.restore();
  warn.mockRestore();
  setSystemTime();
  delete process.env.GITHUB_TOKEN;
});

describe("fetchOwnerPreview", () => {
  test("a user costs exactly one request", async () => {
    serve(userRoutes("torvalds"));
    const user = asUser(await fetchOwnerPreview("torvalds", { now: NOW }));

    expect(requested()).toEqual(["OwnerCore"]);
    expect(fake.calls[0]?.variables).toEqual({ login: "torvalds" });
    expect(user.complete).toBe(false);
    expect(user.calendar.days).toHaveLength(370);
    expect(user.calendar.total).toBe(4015);
    expect(user.streak.current).toBe(26);
    expect(user.bestDay?.count).toBe(68);
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
    expect(user.repos).toEqual([]);
    expect(user.languages).toEqual([]);
    expect(user.organizations).toEqual([]);
    expect(user.wrapped).toBeNull();
    expect(user.fetchedAt).toBe("2026-11-13T04:23:19Z");
  });

  test("an organization comes back complete", async () => {
    serve(orgRoutes());
    const org = asOrg(await fetchOwnerPreview("vercel", { now: NOW }));

    expect(fake.unexpected).toEqual([]);
    expect(fake.count("OwnerCore")).toBe(1);
    expect(fake.count("OrgExtras")).toBe(1);
    // The preview never speculates on user documents.
    expect(fake.count("UserExtras")).toBe(0);
    expect(org.stats.members).toBe(72);
    expect(org.stats.followers).toBeGreaterThan(30_000);
    expect(org.people).toHaveLength(24);
    expect(org.repos).toHaveLength(6);
    expect(org.languages.length).toBeGreaterThan(0);
    expect(org.activity?.weeks).toHaveLength(52);
  });

  test("the login keeps GitHub's casing, not the caller's", async () => {
    serve(userRoutes("torvalds"));
    const user = asUser(await fetchOwnerPreview("TORVALDS", { now: NOW }));
    expect(fake.calls[0]?.variables?.login).toBe("TORVALDS");
    expect(user.login).toBe("torvalds");
  });

  test("an unknown login is null", async () => {
    serve({
      graphql: { OwnerCore: fixture("owner-core.missing.json") as object },
    });
    expect(await fetchOwnerPreview("this-user-does-not-exist-zz9")).toBeNull();
    expect(requested()).toEqual(["OwnerCore"]);
  });

  test.each([
    "",
    "-leading",
    "has space",
    "dots.are.not.logins",
    "under_score",
    "dependabot[bot]",
    "a/b",
    "x".repeat(40),
  ])("%p cannot be a login: null without a request", async (login) => {
    serve({});
    expect(await fetchOwnerPreview(login)).toBeNull();
    expect(await fetchOwner(login)).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  test("a failing core request throws", async () => {
    serve({ graphql: { OwnerCore: htmlTimeout() } });
    const error = await fetchOwnerPreview("failing-core").catch((e) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error.code).toBe("unavailable");
  });

  test("a response GitHub changed the shape of is unavailable, not a crash", async () => {
    serve({
      graphql: {
        OwnerCore: {
          data: { repositoryOwner: { __typename: "User", login: "x" } },
        },
      },
    });
    const error = await fetchOwnerPreview("shape-drift").catch((e) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error.code).toBe("unavailable");
    expect(error.message).toContain("OwnerCore");
  });
});

describe("fetchOwner (user)", () => {
  test("complete user from five parallel requests", async () => {
    serve(userRoutes("torvalds"));
    const user = asUser(await fetchOwner("torvalds", { now: NOW }));

    expect(fake.unexpected).toEqual([]);
    expect(requested()).toEqual([
      "/users/torvalds/orgs?per_page=8",
      "OwnerCore",
      "UserExtras",
      "UserRepoStats",
      "UserTotals",
    ]);
    expect(user.complete).toBe(true);
    expect(user.stats).toEqual({
      contributions: 4015,
      commits: 4006,
      pullRequests: 1,
      issues: 3,
      reviews: 2,
      contributedTo: 6,
      repositories: 12,
      stars: starsOn("user-repo-stats.torvalds.json"),
    });
    expect(user.repos.map((repo) => repo.name)).toEqual([
      "linux",
      "GuitarPedal",
      "uemacs",
      "AudioNoise",
      "HunspellColorize",
      "test-tlb",
    ]);
    expect(user.languages[0]?.name).toBe("C");
    expect(user.organizations).toEqual([]);
    expect(user.wrapped).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  test("the slow path is in flight before OwnerCore answers", async () => {
    const gate = Promise.withResolvers<void>();
    serve(
      userRoutes("torvalds", {
        OwnerCore: async () => {
          await gate.promise;
          return json(fixture("owner-core.torvalds.json"));
        },
      }),
    );
    const pending = fetchOwner("torvalds", { now: NOW });
    await Bun.sleep(5);
    // Everything was sent while the core is still pending: one round trip.
    expect(requested()).toEqual([
      "/users/torvalds/orgs?per_page=8",
      "OwnerCore",
      "UserExtras",
      "UserRepoStats",
      "UserTotals",
    ]);
    gate.resolve();
    expect(asUser(await pending).complete).toBe(true);
    expect(fake.calls).toHaveLength(5);
  });

  test("stars are summed over pages, at most three", async () => {
    serve(userRoutes("sindresorhus"));
    const user = asUser(await fetchOwner("sindresorhus", { now: NOW }));

    expect(fake.unexpected).toEqual([]);
    expect(fake.count("UserRepoStats")).toBe(3);
    // The third page still ends on a starred repository and has a next page:
    // the cap, not the data, ends the loop.
    const last = statsPage(PAGE_FILES[2] ?? "").data.user.repositories;
    expect(last.pageInfo.hasNextPage).toBe(true);
    expect(last.nodes.at(-1)?.stargazerCount).toBeGreaterThan(0);
    expect(user.stats.stars).toBe(
      PAGE_FILES.reduce((sum, name) => sum + starsOn(name), 0),
    );
    expect(user.complete).toBe(true);
    expect(user.organizations).toHaveLength(8);
    expect(user.repos).toHaveLength(6);
  });

  test("paging stops at the first page that ends without stars", async () => {
    const page = statsPage(PAGE_FILES[0] ?? "");
    const nodes = page.data.user.repositories.nodes;
    nodes[nodes.length - 1] = { stargazerCount: 0 };
    serve(userRoutes("sindresorhus", { UserRepoStats: page }));
    const user = asUser(await fetchOwner("sindresorhus", { now: NOW }));
    expect(fake.count("UserRepoStats")).toBe(1);
    expect(user.stats.stars).toBe(
      nodes.reduce((sum, node) => sum + node.stargazerCount, 0),
    );
  });

  test("a failed slow-path request degrades the user instead of throwing", async () => {
    serve(userRoutes("torvalds", { UserTotals: htmlTimeout() }));
    const user = asUser(await fetchOwner("torvalds", { now: NOW }));

    expect(user.complete).toBe(false);
    expect(user.stats.commits).toBeNull();
    expect(user.stats.pullRequests).toBeNull();
    expect(user.stats.contributedTo).toBeNull();
    // Everything else is still there.
    expect(user.stats.stars).toBe(starsOn("user-repo-stats.torvalds.json"));
    expect(user.repos).toHaveLength(6);
    expect(user.calendar.total).toBe(4015);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      "UserTotals unavailable for torvalds: unavailable",
    );
  });

  test("a slow-path request that runs out of time degrades the user too", async () => {
    serve(
      userRoutes("torvalds", {
        // Answers only when its request is aborted.
        UserTotals: (call) =>
          new Promise<Response>((_resolve, reject) => {
            call.signal?.addEventListener("abort", () =>
              reject(call.signal?.reason),
            );
          }),
      }),
    );
    const started = Date.now();
    const user = asUser(
      await fetchOwner("torvalds", {
        now: NOW,
        signal: AbortSignal.timeout(40),
      }),
    );
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(user.complete).toBe(false);
    expect(user.stats.commits).toBeNull();
    expect(user.stats.stars).toBe(starsOn("user-repo-stats.torvalds.json"));
    expect(user.repos).toHaveLength(6);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      "UserTotals unavailable for torvalds: unavailable",
    );
  });

  test("every slow-path request failing still returns the fast path", async () => {
    serve({
      graphql: {
        OwnerCore: fixture("owner-core.torvalds.json") as object,
        UserExtras: json({ message: "Server Error" }, { status: 500 }),
        UserTotals: json({ message: "Server Error" }, { status: 500 }),
        UserRepoStats: json({ message: "Server Error" }, { status: 500 }),
      },
      rest: [[/orgs/, json({ message: "Server Error" }, { status: 500 })]],
    });
    const user = asUser(await fetchOwner("torvalds", { now: NOW }));
    expect(user.complete).toBe(false);
    expect(user.stats.stars).toBeNull();
    expect(user.repos).toEqual([]);
    expect(user.languages).toEqual([]);
    expect(user.organizations).toEqual([]);
    expect(user.streak.current).toBe(26);
    expect(warn).toHaveBeenCalledTimes(4);
  });

  test("a failing star page leaves stars unknown rather than half-counted", async () => {
    let page = 0;
    serve(
      userRoutes("sindresorhus", {
        UserRepoStats: (call) => {
          page += 1;
          return page === 2 ? htmlTimeout(504) : pagedStats(call);
        },
      }),
    );
    const user = asUser(await fetchOwner("sindresorhus", { now: NOW }));
    expect(user.stats.stars).toBeNull();
    expect(user.complete).toBe(false);
  });

  test("a failing core request throws even though the slow path succeeded", async () => {
    serve(userRoutes("torvalds", { OwnerCore: htmlTimeout() }));
    const error = await fetchOwner("core-down").catch((e) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error.code).toBe("unavailable");
  });

  test("an unknown login is null", async () => {
    serve({
      graphql: {
        OwnerCore: fixture("owner-core.missing.json") as object,
        UserExtras: fixture("user-extras.not-a-user.json") as object,
        UserTotals: fixture("user-extras.not-a-user.json") as object,
        UserRepoStats: fixture("user-extras.not-a-user.json") as object,
      },
      rest: [[/orgs/, json({ message: "Not Found" }, { status: 404 })]],
    });
    expect(await fetchOwner("this-user-does-not-exist-zz9")).toBeNull();
    await Bun.sleep(5);
    expect(fake.unexpected).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("a per-request token is used for every request", async () => {
    serve(userRoutes("torvalds"));
    await fetchOwner("torvalds", { now: NOW, token: "visitor-token" });
    expect(fake.calls).toHaveLength(5);
    for (const call of fake.calls) {
      expect(call.headers.get("authorization")).toBe("Bearer visitor-token");
    }
  });

  test("the caller's signal reaches every request", async () => {
    serve(userRoutes("torvalds"));
    const controller = new AbortController();
    await fetchOwner("torvalds", { now: NOW, signal: controller.signal });
    expect(fake.calls).toHaveLength(5);
    controller.abort();
    for (const call of fake.calls) expect(call.signal?.aborted).toBe(true);
  });
});

describe("fetchOwner (unknown login)", () => {
  const missing = (): Routes => ({
    graphql: {
      OwnerCore: fixture("owner-core.missing.json") as object,
      UserExtras: fixture("user-extras.not-a-user.json") as object,
      UserTotals: fixture("user-extras.not-a-user.json") as object,
      UserRepoStats: fixture("user-extras.not-a-user.json") as object,
    },
    rest: [[/orgs/, json({ message: "Not Found" }, { status: 404 })]],
  });

  test("first sight speculates, every later check costs one request", async () => {
    // A banner of a deleted account is re-checked every five minutes for as
    // long as it stays embedded somewhere.
    const login = neverSeen("Gone-Account");
    serve(missing());
    expect(await fetchOwner(login, { now: NOW })).toBeNull();
    await Bun.sleep(5);
    expect(fake.calls).toHaveLength(5);
    fake.restore();

    for (const spelling of [login.toLowerCase(), login.toUpperCase()]) {
      serve(missing());
      expect(await fetchOwner(spelling, { now: NOW })).toBeNull();
      await Bun.sleep(5);
      expect(requested()).toEqual(["OwnerCore"]);
      fake.restore();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  test("the preview's verdict is enough to skip the speculation", async () => {
    const login = neverSeen("gone-account");
    serve(missing());
    expect(await fetchOwnerPreview(login, { now: NOW })).toBeNull();
    expect(await fetchOwner(login, { now: NOW })).toBeNull();
    await Bun.sleep(5);
    expect(requested()).toEqual(["OwnerCore", "OwnerCore"]);
  });

  test("a login that gets registered is a complete user at once", async () => {
    const login = neverSeen("gone-account");
    serve(missing());
    expect(await fetchOwnerPreview(login, { now: NOW })).toBeNull();
    fake.restore();

    serve(userRoutes("torvalds"));
    const user = asUser(await fetchOwner(login, { now: NOW }));
    // Remembered as missing: the slow path follows the core this once.
    expect(fake.calls[0]?.operation).toBe("OwnerCore");
    expect(fake.calls).toHaveLength(5);
    expect(user.complete).toBe(true);
    fake.restore();

    const gate = Promise.withResolvers<void>();
    serve(
      userRoutes("torvalds", {
        OwnerCore: async () => {
          await gate.promise;
          return json(fixture("owner-core.torvalds.json"));
        },
      }),
    );
    const pending = fetchOwner(login, { now: NOW });
    await Bun.sleep(5);
    // Known as a user again: everything is in flight with the core.
    expect(fake.calls).toHaveLength(5);
    gate.resolve();
    asUser(await pending);
  });
});

describe("fetchOwner (year)", () => {
  const WINDOW = { from: "2025-01-01T00:00:00Z", to: "2025-12-31T23:59:59Z" };

  test("the year window reaches calendar, totals and the year review", async () => {
    serve(
      userRoutes("torvalds", {
        OwnerCore: fixture("owner-core.torvalds.2026.json") as object,
      }),
    );
    const user = asUser(await fetchOwner("torvalds", { now: NOW, year: 2025 }));

    expect(fake.unexpected).toEqual([]);
    const variables = (operation: string) =>
      fake.calls.find((call) => call.operation === operation)?.variables;
    expect(variables("OwnerCore")).toEqual({ login: "torvalds", ...WINDOW });
    expect(variables("UserTotals")).toEqual({ login: "torvalds", ...WINDOW });
    expect(variables("UserYearReview")).toEqual({
      login: "torvalds",
      ...WINDOW,
      previousFrom: "2024-01-01T00:00:00Z",
      previousTo: "2024-12-31T23:59:59Z",
    });
    expect(user.complete).toBe(true);
    expect(user.wrapped).toEqual({
      year: 2025,
      previousTotal: 2892,
      topRepos: [
        { fullName: "torvalds/linux", commits: 2786 },
        { fullName: "torvalds/GuitarPedal", commits: 80 },
        { fullName: "torvalds/1590A", commits: 56 },
      ],
    });
  });

  test("the current year stops at today", async () => {
    serve(
      userRoutes("torvalds", {
        OwnerCore: fixture("owner-core.torvalds.2026.json") as object,
      }),
    );
    const user = asUser(await fetchOwner("torvalds", { now: NOW, year: 2026 }));
    expect(user.calendar.from).toBe("2026-01-01");
    expect(user.calendar.to).toBe("2026-11-13");
    expect(user.calendar.days).toHaveLength(317);
    expect(user.stats.contributions).toBe(3558);
    expect(user.streak.current).toBe(26);
  });

  test("without the year review the user is incomplete but has `wrapped`", async () => {
    serve(userRoutes("torvalds", { UserYearReview: htmlTimeout() }));
    const user = asUser(await fetchOwner("torvalds", { now: NOW, year: 2025 }));
    expect(user.complete).toBe(false);
    expect(user.wrapped).toEqual({
      year: 2025,
      previousTotal: null,
      topRepos: [],
    });
    expect(user.stats.commits).toBe(4006);
  });

  test("the preview takes the window too, at one request", async () => {
    serve(userRoutes("torvalds"));
    const user = asUser(
      await fetchOwnerPreview("torvalds", { now: NOW, year: 2025 }),
    );
    expect(requested()).toEqual(["OwnerCore"]);
    expect(fake.calls[0]?.variables).toEqual({ login: "torvalds", ...WINDOW });
    expect(user.wrapped).toEqual({
      year: 2025,
      previousTotal: null,
      topRepos: [],
    });
  });

  test.each([
    2007,
    2027,
    2025.5,
    Number.NaN,
  ])("year %p is invalid: no request", async (year) => {
    serve({});
    for (const run of [fetchOwner, fetchOwnerPreview]) {
      const error = await run("torvalds", { now: NOW, year }).catch((e) => e);
      expect(error).toBeInstanceOf(GitHubError);
      expect(error.code).toBe("invalid");
      expect(error.status).toBe(400);
    }
    expect(fake.calls).toHaveLength(0);
  });

  test("null means the last 12 months", async () => {
    serve(userRoutes("torvalds"));
    const user = asUser(await fetchOwner("torvalds", { now: NOW, year: null }));
    expect(
      fake.calls.find((c) => c.operation === "OwnerCore")?.variables,
    ).toEqual({ login: "torvalds" });
    expect(user.wrapped).toBeNull();
    expect(fake.count("UserYearReview")).toBe(0);
  });
});

describe("fetchOwner (organization)", () => {
  test("first sight speculates on user documents, later fetches do not", async () => {
    // Routes answer by operation, so any login works: use one no other test
    // has taught the module about.
    const login = neverSeen("First-Sight-Org");
    serve(orgRoutes());
    const first = asOrg(await fetchOwner(login, { now: NOW }));
    await Bun.sleep(5);
    expect(fake.unexpected).toEqual([]);
    expect(first.login).toBe("vercel");
    expect(fake.count("UserExtras")).toBe(1);
    expect(fake.count("UserTotals")).toBe(1);
    expect(fake.count("UserRepoStats")).toBe(1);
    expect(fake.count("OrgExtras")).toBe(1);
    expect(warn).not.toHaveBeenCalled();

    fake.restore();
    serve(orgRoutes());
    // Case-insensitive: the same account in another spelling.
    const again = asOrg(await fetchOwner(login.toLowerCase(), { now: NOW }));
    expect(fake.unexpected).toEqual([]);
    expect(fake.count("UserExtras")).toBe(0);
    expect(fake.count("UserTotals")).toBe(0);
    expect(fake.count("UserRepoStats")).toBe(0);
    expect(fake.matching(/^\/users\//)).toHaveLength(0);
    expect(fake.count("OwnerCore")).toBe(1);
    expect(again).toEqual(first);
  });

  test("a login that stops being an organization is a user again", async () => {
    serve(orgRoutes());
    asOrg(await fetchOwnerPreview("changes-hands", { now: NOW }));
    fake.restore();

    serve(userRoutes("torvalds"));
    asUser(await fetchOwner("changes-hands", { now: NOW }));
    // Known as an organization: no speculation, the slow path follows the core.
    expect(fake.calls[0]?.operation).toBe("OwnerCore");
    expect(fake.calls).toHaveLength(5);
    fake.restore();

    const gate = Promise.withResolvers<void>();
    serve(
      userRoutes("torvalds", {
        OwnerCore: async () => {
          await gate.promise;
          return json(fixture("owner-core.torvalds.json"));
        },
      }),
    );
    const pending = fetchOwner("changes-hands", { now: NOW });
    await Bun.sleep(5);
    // The stale verdict is gone: speculation is back.
    expect(fake.calls).toHaveLength(5);
    gate.resolve();
    asUser(await pending);
  });

  test("the member count needs a second request only for long lists", async () => {
    serve(
      orgRoutes({
        rest: [
          [
            /^\/orgs\/vercel\/public_members\?per_page=24$/,
            json(
              (fixture("public-members.vercel.json") as unknown[]).slice(0, 5),
            ),
          ],
        ],
      }),
    );
    const org = asOrg(await fetchOwnerPreview("vercel", { now: NOW }));
    expect(org.stats.members).toBe(5);
    expect(org.people).toHaveLength(5);
    expect(fake.matching(/public_members/)).toHaveLength(1);
  });

  test("activity is null while GitHub computes one repository's statistics", async () => {
    serve(
      orgRoutes({
        rest: [
          [
            /^\/repos\/vercel\/swr\/stats\/commit_activity$/,
            json({}, { status: 202 }),
          ],
        ],
      }),
    );
    const org = asOrg(await fetchOwnerPreview("vercel", { now: NOW }));
    expect(fake.matching(/commit_activity/)).toHaveLength(6);
    expect(org.activity).toBeNull();
    expect(org.repos).toHaveLength(6);
    // 202 is a normal state, not a failure worth a log line.
    expect(warn).not.toHaveBeenCalled();
  });

  test("activity sums the six top repositories week by week", async () => {
    serve(orgRoutes());
    const org = asOrg(await fetchOwnerPreview("vercel", { now: NOW }));
    const next = fixture("commit-activity.vercel-next.js.json") as {
      total: number;
    }[];
    const yocto = fixture("commit-activity.sindresorhus-yocto-queue.json") as {
      total: number;
    }[];
    const sum = (weeks: { total: number }[]) =>
      weeks.reduce((total, week) => total + week.total, 0);
    expect(org.activity?.total).toBe(sum(next) + 5 * sum(yocto));
    expect(org.activity?.weeks).toHaveLength(52);
  });

  test("failed extras degrade the organization", async () => {
    serve({
      graphql: {
        OwnerCore: fixture("owner-core.vercel.json") as object,
        OrgExtras: htmlTimeout(),
      },
      rest: [[/.*/, json({ message: "Server Error" }, { status: 500 })]],
    });
    const org = asOrg(await fetchOwnerPreview("vercel", { now: NOW }));
    expect(org.stats.followers).toBeNull();
    expect(org.stats.members).toBeNull();
    expect(org.people).toEqual([]);
    expect(org.languages).toEqual([]);
    expect(org.activity).toBeNull();
    expect(org.stats.stars).toBe(
      org.repos.reduce((sum, repo) => sum + repo.stars, 0),
    );
    expect(warn).toHaveBeenCalled();
  });

  test("a year is ignored for organizations", async () => {
    serve(
      orgRoutes({
        graphql: {
          UserYearReview: fixture("user-extras.not-a-user.json") as object,
        },
      }),
    );
    asOrg(await fetchOwner("vercel", { now: NOW, year: 2025 }));
    expect(fake.unexpected).toEqual([]);
  });
});

describe("without a token", () => {
  const profile = (name: string) => fixture(name) as object;
  const html = () =>
    new Response(fixtureText("contributions.torvalds.html"), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });

  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  test("a user is assembled from the REST profile and the public calendar", async () => {
    serve({
      rest: [[/^\/users\/torvalds$/, profile("rest-user.torvalds.json")]],
      web: [[/^\/users\/torvalds\/contributions$/, html()]],
    });
    for (const run of [fetchOwner, fetchOwnerPreview]) {
      const user = asUser(await run("torvalds", { now: NOW }));
      expect(user.login).toBe("torvalds");
      expect(user.id).toBe(1024025);
      expect(user.complete).toBe(false);
      expect(user.calendar.total).toBe(4015);
      expect(user.calendar.days).toHaveLength(370);
      expect(user.streak).toMatchObject({ current: 26, longest: 104 });
      expect(user.stats.commits).toBeNull();
      expect(user.stats.repositories).toBe(12);
    }
    expect(fake.unexpected).toEqual([]);
    for (const call of fake.calls) {
      expect(call.headers.has("authorization")).toBe(false);
      expect(call.operation).toBeNull();
    }
  });

  test("a year asks the public calendar for that year", async () => {
    serve({
      rest: [[/^\/users\/torvalds$/, profile("rest-user.torvalds.json")]],
      web: [
        [
          /^\/users\/torvalds\/contributions\?from=2026-01-01&to=2026-12-31$/,
          html(),
        ],
      ],
    });
    const user = asUser(await fetchOwner("torvalds", { now: NOW, year: 2026 }));
    expect(fake.unexpected).toEqual([]);
    expect(user.wrapped).toEqual({
      year: 2026,
      previousTotal: null,
      topRepos: [],
    });
  });

  test("without a readable calendar the user still renders", async () => {
    serve({
      rest: [[/^\/users\/torvalds$/, profile("rest-user.torvalds.json")]],
      web: [[/contributions/, new Response("<div>redesigned</div>")]],
    });
    const user = asUser(await fetchOwner("torvalds", { now: NOW }));
    expect(user.calendar.days).toEqual([]);
    expect(user.calendar.total).toBe(0);
    expect(user.bestDay).toBeNull();
  });

  test("an organization gets its REST profile and nothing else", async () => {
    serve({
      rest: [
        [/^\/users\/vercel$/, profile("rest-user.vercel.json")],
        [/^\/orgs\/vercel$/, profile("rest-org.vercel.json")],
      ],
      web: [[/contributions/, new Response("Not Found", { status: 404 })]],
    });
    const org = asOrg(await fetchOwnerPreview("vercel", { now: NOW }));
    expect(fake.unexpected).toEqual([]);
    expect(org).toMatchObject({
      login: "vercel",
      name: "Vercel",
      isVerified: true,
      description: "Agentic infrastructure for every app and agent.",
      repos: [],
      people: [],
      activity: null,
    });
  });

  test("an organization survives its second request failing", async () => {
    serve({
      rest: [
        [/^\/users\/vercel$/, profile("rest-user.vercel.json")],
        [
          /^\/orgs\/vercel$/,
          json({ message: "Server Error" }, { status: 500 }),
        ],
      ],
      web: [[/contributions/, new Response("Not Found", { status: 404 })]],
    });
    const org = asOrg(await fetchOwner("vercel", { now: NOW }));
    expect(org.description).toBe(
      "Agentic infrastructure for every app and agent.",
    );
    expect(org.isVerified).toBe(false);
  });

  test("an unknown login is null", async () => {
    serve({
      rest: [[/^\/users\//, json({ message: "Not Found" }, { status: 404 })]],
      web: [[/contributions/, new Response("Not Found", { status: 404 })]],
    });
    expect(await fetchOwner("this-user-does-not-exist-zz9")).toBeNull();
  });

  test("an exhausted anonymous budget is `unavailable`, with the wait", async () => {
    // The client now refuses anonymous REST requests until the reset. On a
    // clock in the past that moment is long gone once the test is over.
    setSystemTime(new Date("2020-01-01T00:00:00Z"));
    serve({
      rest: [
        [
          /^\/users\//,
          json(
            { message: "API rate limit exceeded for 203.0.113.7." },
            {
              status: 403,
              headers: {
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": String(
                  Math.floor(Date.now() / 1000) + 120,
                ),
              },
            },
          ),
        ],
      ],
      web: [[/contributions/, html()]],
    });
    const error = await fetchOwner("torvalds", { now: NOW }).catch((e) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error.code).toBe("unavailable");
    expect(error.retryAfter).toBeGreaterThan(100);
  });
});
