/**
 * `cached.ts` under `bun test`: `server-only` and `next/cache` are inert
 * stand-ins (tests/setup.ts), so the `'use cache'` directive does nothing
 * here. What is exercised is everything around it: argument normalization,
 * samples without a token, and the snapshot behaviour the wrappers configure.
 */
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
  htmlTimeout,
  json,
  type Routes,
} from "./__fixtures__/mock";
import {
  getEntity,
  getOwner,
  getOwnerPreview,
  getRepo,
  getSuggestions,
  hasPageData,
} from "./cached";
import { GitHubError } from "./errors";
import * as ownerModule from "./owner";
import * as repoModule from "./repo";
import { SAMPLE_ORG, SAMPLE_REPO, SAMPLE_USER } from "./samples";
import * as searchModule from "./search";
import { createMemorySnapshotStore, setSnapshotStore } from "./snapshot";

const START = new Date("2026-11-13T04:00:00Z");
const later = (seconds: number) =>
  setSystemTime(new Date(START.getTime() + seconds * 1000));

const userRoutes = (): Routes => ({
  graphql: {
    OwnerCore: fixture("owner-core.torvalds.json") as object,
    UserExtras: fixture("user-extras.torvalds.json") as object,
    UserTotals: fixture("user-totals.torvalds.json") as object,
    UserRepoStats: fixture("user-repo-stats.torvalds.json") as object,
    UserYearReview: fixture("user-year-review.torvalds.2025.json") as object,
  },
  rest: [[/^\/users\/[^/]+\/orgs/, []]],
});

const repoRoutes = (activity: Response | object): Routes => ({
  graphql: {
    RepoCore: fixture("repo-core.sindresorhus-yocto-queue.json") as object,
  },
  rest: [
    [
      /\/contributors/,
      fixture("contributors.sindresorhus-yocto-queue.json") as object,
    ],
    [/\/stats\/commit_activity$/, activity],
    [
      /\/stargazers\/history$/,
      fixture("stargazers-history.sindresorhus-yocto-queue.json") as object,
    ],
  ],
});

let fake: FakeGitHub;
let warn: Mock<typeof console.warn>;

function serve(routes: Routes): FakeGitHub {
  fake?.restore();
  fake = fakeGitHub(routes);
  return fake;
}

beforeEach(() => {
  setSystemTime(START);
  setSnapshotStore(createMemorySnapshotStore());
  process.env.GITHUB_TOKEN = "server-token";
  warn = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  fake?.restore();
  warn.mockRestore();
  setSystemTime();
  setSnapshotStore(createMemorySnapshotStore());
  delete process.env.GITHUB_TOKEN;
});

describe("argument normalization", () => {
  test("every spelling of a login shares one entry", async () => {
    serve(userRoutes());
    const first = await getOwnerPreview("Cached-Case");
    const second = await getOwnerPreview("  cached-case ");
    const third = await getOwnerPreview("CACHED-CASE");

    expect(fake.count("OwnerCore")).toBe(1);
    expect(fake.calls[0]?.variables?.login).toBe("cached-case");
    expect(first?.kind).toBe("user");
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  test("preview, complete and each year are separate entries", async () => {
    serve(userRoutes());
    const preview = await getOwnerPreview("cached-entries");
    const complete = await getOwner("cached-entries");
    const year = await getOwner("cached-entries", 2025);
    await getOwner("Cached-Entries", null);
    await getOwner("cached-entries", 2025);

    expect(fake.count("OwnerCore")).toBe(3);
    expect(preview?.kind === "user" && preview.complete).toBe(false);
    expect(complete?.kind === "user" && complete.complete).toBe(true);
    expect(year?.kind === "user" && year.wrapped?.year).toBe(2025);
  });

  test("repositories are keyed case-insensitively on owner and name", async () => {
    serve(
      repoRoutes(
        fixture("commit-activity.sindresorhus-yocto-queue.json") as object,
      ),
    );
    const first = await getRepo("SindreSorhus", "Yocto-Queue");
    const second = await getRepo(" sindresorhus", "yocto-queue ");

    expect(fake.count("RepoCore")).toBe(1);
    expect(fake.calls.find((call) => call.operation)?.variables).toEqual({
      owner: "sindresorhus",
      name: "yocto-queue",
    });
    expect(first?.fullName).toBe("sindresorhus/yocto-queue");
    expect(second).toEqual(first);
  });

  test("input that cannot exist never reaches GitHub or the cache", async () => {
    serve({});
    expect(await getOwner("not a login")).toBeNull();
    expect(await getOwnerPreview("a/b")).toBeNull();
    expect(await getRepo("vercel", "..")).toBeNull();
    expect(await getRepo("-bad", "repo")).toBeNull();
    expect(await getEntity({ kind: "owner", login: "" })).toBeNull();
    expect(await getSuggestions("v")).toEqual([]);
    expect(await getSuggestions("two words")).toEqual([]);
    expect(fake.calls).toHaveLength(0);
  });

  test("getEntity dispatches on the target", async () => {
    serve({
      ...userRoutes(),
      ...{
        graphql: {
          ...userRoutes().graphql,
          ...repoRoutes({}).graphql,
        },
        rest: [...(repoRoutes([]).rest ?? []), ...(userRoutes().rest ?? [])],
      },
    });
    const owner = await getEntity({ kind: "owner", login: "Cached-Entity" });
    const repo = await getEntity({
      kind: "repo",
      owner: "cached-entity",
      name: "repo",
    });
    expect(owner?.kind).toBe("user");
    expect(repo?.kind).toBe("repo");
  });
});

describe("resilience", () => {
  test("a stale snapshot is served while GitHub is down", async () => {
    serve(userRoutes());
    const fresh = await getOwner("cached-stale");
    expect(fresh?.kind).toBe("user");

    later(3 * 86_400);
    serve({ graphql: { OwnerCore: htmlTimeout() } });
    expect(await getOwner("cached-stale")).toEqual(fresh);
    expect(fake.count("OwnerCore")).toBe(1);
  });

  test("without a snapshot the GitHubError propagates", async () => {
    serve({ graphql: { OwnerCore: htmlTimeout() } });
    const error = await getOwnerPreview("cached-cold").catch((e) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error.code).toBe("unavailable");
  });

  test("a snapshot older than a week is not served", async () => {
    serve(userRoutes());
    await getOwnerPreview("cached-week");
    later(604_800);
    serve({ graphql: { OwnerCore: htmlTimeout() } });
    const error = await getOwnerPreview("cached-week").catch((e) => e);
    expect(error).toBeInstanceOf(GitHubError);
  });

  test("an unknown login is re-checked after five minutes, not fifteen", async () => {
    const missing: Routes = {
      graphql: { OwnerCore: fixture("owner-core.missing.json") as object },
    };
    serve(missing);
    expect(await getOwnerPreview("cached-missing")).toBeNull();
    later(299);
    expect(await getOwnerPreview("cached-missing")).toBeNull();
    expect(fake.count("OwnerCore")).toBe(1);
    later(300);
    expect(await getOwnerPreview("cached-missing")).toBeNull();
    expect(fake.count("OwnerCore")).toBe(2);
  });

  test("a repository whose statistics were still computing is refreshed after a minute", async () => {
    serve(repoRoutes(json({}, { status: 202 })));
    const pending = await getRepo("cached-pending", "repo");
    expect(pending?.activity).toBeNull();

    later(59);
    await getRepo("cached-pending", "repo");
    expect(fake.count("RepoCore")).toBe(1);

    later(60);
    serve(
      repoRoutes(
        fixture("commit-activity.sindresorhus-yocto-queue.json") as object,
      ),
    );
    const settled = await getRepo("cached-pending", "repo");
    expect(fake.count("RepoCore")).toBe(1);
    expect(settled?.activity?.weeks).toHaveLength(52);

    // Settled: now it lives the full fifteen minutes.
    later(60 + 899);
    await getRepo("cached-pending", "repo");
    expect(fake.count("RepoCore")).toBe(1);
  });

  test("statistics GitHub never finishes computing do not cause a fetch a minute", async () => {
    serve(repoRoutes(json({}, { status: 202 })));
    await getRepo("cached-stuck", "repo");
    // One quick re-check after a minute...
    later(60);
    await getRepo("cached-stuck", "repo");
    expect(fake.count("RepoCore")).toBe(2);
    // ...then the normal fifteen minutes, however often the banner is asked for.
    for (let seconds = 120; seconds < 960; seconds += 60) {
      later(seconds);
      const repo = await getRepo("cached-stuck", "repo");
      expect(repo?.activity).toBeNull();
    }
    expect(fake.count("RepoCore")).toBe(2);
    later(960);
    await getRepo("cached-stuck", "repo");
    expect(fake.count("RepoCore")).toBe(3);
  });

  test("a snapshot of another shape (an older deployment) is refetched", async () => {
    const store = createMemorySnapshotStore();
    setSnapshotStore(store);
    // An entity that no longer satisfies the schema, as the snapshot layer
    // stores it (in its envelope)...
    await store.set(
      "owner-preview:cached-shape",
      { value: { kind: "user", login: "x" }, rechecked: false },
      1000,
    );
    // ...and one from before there was an envelope.
    await store.set("repo:cached-shape/repo", { kind: "repo" }, 1000);
    serve({
      ...userRoutes(),
      graphql: { ...userRoutes().graphql, ...repoRoutes([]).graphql },
      rest: [...(repoRoutes([]).rest ?? []), ...(userRoutes().rest ?? [])],
    });
    const owner = await getOwnerPreview("cached-shape");
    expect(fake.count("OwnerCore")).toBe(1);
    expect(owner?.login).toBe("torvalds");
    const repo = await getRepo("cached-shape", "repo");
    expect(fake.count("RepoCore")).toBe(1);
    expect(repo?.fullName).toBe("sindresorhus/yocto-queue");
  });

  test("a stored entity that still satisfies the schema is used", async () => {
    serve(userRoutes());
    const first = await getOwnerPreview("cached-kept");
    // What the store holds is the envelope around exactly that entity.
    const store = createMemorySnapshotStore();
    await store.set(
      "owner-preview:cached-kept",
      { value: first, rechecked: false },
      1000,
    );
    setSnapshotStore(store);
    fake.restore();
    serve({});
    expect(await getOwnerPreview("cached-kept")).toEqual(first);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("errors that crossed the cache boundary", () => {
  /**
   * What `await cachedX()` rejects with in a production build: React
   * re-creates an error thrown inside `'use cache'` and keeps only its
   * digest. Under `bun test` the directive is inert, so the fetcher is made
   * to throw that re-created error itself; it reaches the same catch.
   */
  const transported = (original: GitHubError): Error =>
    Object.assign(
      new Error(
        "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.",
      ),
      { digest: original.digest },
    );
  const limited = new GitHubError("rate_limited", "API rate limit exceeded", {
    retryAfter: 42,
  });

  test("every wrapper rebuilds the GitHubError from its digest", async () => {
    const spies = [
      spyOn(ownerModule, "fetchOwner").mockRejectedValue(transported(limited)),
      spyOn(ownerModule, "fetchOwnerPreview").mockRejectedValue(
        transported(limited),
      ),
      spyOn(repoModule, "fetchRepo").mockRejectedValue(transported(limited)),
      spyOn(searchModule, "searchGitHub").mockRejectedValue(
        transported(limited),
      ),
    ];
    try {
      const calls = [
        () => getOwner("cached-boundary"),
        () => getOwner("cached-boundary", 2025),
        () => getOwnerPreview("cached-boundary"),
        () => getRepo("cached-boundary", "repo"),
        () => getEntity({ kind: "owner", login: "cached-boundary" }),
        () => getEntity({ kind: "repo", owner: "cached-boundary", name: "r" }),
        () => getSuggestions("cached-boundary"),
      ];
      for (const call of calls) {
        const error = await call().catch((e) => e);
        expect(error).toBeInstanceOf(GitHubError);
        expect(error.code).toBe("rate_limited");
        expect(error.status).toBe(429);
        expect(error.retryAfter).toBe(42);
      }
      for (const spy of spies) expect(spy).toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  test("any other error is rethrown untouched", async () => {
    // e.g. the digest errors Next.js uses for its own control flow.
    const foreign = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    const spy = spyOn(ownerModule, "fetchOwnerPreview").mockRejectedValue(
      foreign,
    );
    try {
      const error = await getOwnerPreview("cached-foreign").catch((e) => e);
      expect(error).toBe(foreign);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("suggestions", () => {
  test("cached per normalized query", async () => {
    serve({
      graphql: {
        SearchOwners: fixture("search-owners.verc.json") as object,
        SearchRepos: fixture("search-repos.vercel-ne.json") as object,
      },
    });
    const first = await getSuggestions(" Verc");
    const second = await getSuggestions("@verc ");
    expect(first).toHaveLength(6);
    expect(second).toEqual(first);
    expect(fake.count("SearchOwners")).toBe(1);

    await getSuggestions("vercel/ne");
    await getSuggestions("https://github.com/Vercel/NE");
    expect(fake.count("SearchRepos")).toBe(1);
  });
});

describe("without a token", () => {
  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  test("bundled samples answer without any request", async () => {
    serve({});
    expect(await getOwner("markeljan")).toBe(SAMPLE_USER);
    expect(await getOwner(" MarkelJan ")).toBe(SAMPLE_USER);
    expect(await getOwnerPreview("markeljan")).toBe(SAMPLE_USER);
    expect(await getOwner("Vercel")).toBe(SAMPLE_ORG);
    expect(await getRepo("Vercel", "Next.js")).toBe(SAMPLE_REPO);
    expect(
      await getEntity({ kind: "repo", owner: "vercel", name: "next.js" }),
    ).toBe(SAMPLE_REPO);
    expect(await getEntity({ kind: "owner", login: "torvalds" })).toMatchObject(
      {
        kind: "user",
        login: "torvalds",
        complete: true,
      },
    );
    expect(fake.calls).toHaveLength(0);
  });

  test("a sample is never passed off as another year", async () => {
    serve({
      rest: [
        [/^\/users\/markeljan$/, fixture("rest-user.torvalds.json") as object],
      ],
      web: [
        [
          /contributions\?from=2025-01-01&to=2025-12-31$/,
          new Response(fixtureText("contributions.torvalds.html")),
        ],
      ],
    });
    const owner = await getOwner("markeljan", 2025);
    expect(owner).not.toBe(SAMPLE_USER);
    expect(owner?.kind === "user" && owner.wrapped?.year).toBe(2025);
    expect(fake.unexpected).toEqual([]);
  });

  test("everything else degrades to the public fallback", async () => {
    serve({
      rest: [
        [
          /^\/users\/cached-tokenless$/,
          fixture("rest-user.torvalds.json") as object,
        ],
      ],
      web: [
        [
          /^\/users\/cached-tokenless\/contributions$/,
          new Response(fixtureText("contributions.torvalds.html")),
        ],
      ],
    });
    const owner = await getOwner("Cached-Tokenless");
    expect(owner?.kind === "user" && owner.complete).toBe(false);
    expect(owner?.kind === "user" && owner.calendar.total).toBe(4015);

    const error = await getRepo("cached-tokenless", "repo").catch((e) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error.code).toBe("unavailable");
    expect(await getSuggestions("verc")).toEqual([]);
  });

  test("token-less results never stand in for authenticated ones", async () => {
    serve({
      rest: [
        [
          /^\/users\/cached-scope$/,
          fixture("rest-user.torvalds.json") as object,
        ],
      ],
      web: [
        [
          /contributions/,
          new Response(fixtureText("contributions.torvalds.html")),
        ],
      ],
    });
    const degraded = await getOwner("cached-scope");
    expect(degraded?.kind === "user" && degraded.complete).toBe(false);

    // The same store, now read by a deployment that has a token.
    process.env.GITHUB_TOKEN = "server-token";
    serve(userRoutes());
    const complete = await getOwner("cached-scope");
    expect(fake.count("OwnerCore")).toBe(1);
    expect(complete?.kind === "user" && complete.complete).toBe(true);
  });

  test("with a token the samples are not used", async () => {
    process.env.GITHUB_TOKEN = "server-token";
    serve(userRoutes());
    const owner = await getOwnerPreview("markeljan");
    expect(owner).not.toBe(SAMPLE_USER);
    expect(fake.count("OwnerCore")).toBe(1);
  });
});

describe("hasPageData", () => {
  const other = { kind: "repo", owner: "react", name: "react" } as const;
  const sample = {
    kind: "repo",
    owner: SAMPLE_REPO.owner.login,
    name: SAMPLE_REPO.name,
  } as const;

  test("accounts always, any repository with a token", () => {
    process.env.GITHUB_TOKEN = "server-token";
    expect(hasPageData({ kind: "owner", login: "torvalds" })).toBe(true);
    expect(hasPageData(other)).toBe(true);
  });

  test("without a token, only repositories with a bundled sample", () => {
    delete process.env.GITHUB_TOKEN;
    expect(hasPageData({ kind: "owner", login: "torvalds" })).toBe(true);
    expect(hasPageData(sample)).toBe(true);
    expect(hasPageData(other)).toBe(false);
  });
});
