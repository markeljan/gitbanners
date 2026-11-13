import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  spyOn,
  test,
} from "bun:test";
import {
  type FakeGitHub,
  fakeGitHub,
  fixture,
  fixtureData,
  htmlTimeout,
  json,
  linkHeader,
  type Reply,
  type Routes,
} from "./__fixtures__/mock";
import { GitHubError } from "./errors";
import { decode, RepoCoreDataSchema } from "./raw";
import { fetchRepo } from "./repo";
import { type Repo, RepoSchema } from "./schema";

const NOW = new Date("2026-11-13T04:23:19Z");

/**
 * A repository name `fetchRepo` has never seen. It remembers per process
 * which names were missing, and that memory outlives a re-run of this file.
 */
const neverSeen = (prefix: string) =>
  `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const CONTRIBUTORS =
  "https://api.github.com/repositories/70107786/contributors";
const TOO_LARGE =
  "The history or contributor list is too large to list contributors for this repository via the API.";

type RestRoute = readonly [RegExp, Reply];

/** vercel/next.js as recorded: 40 contributors on page 1 of 11, 420 in total. */
function nextRoutes(rest: RestRoute[] = [], core?: Reply): Routes {
  return {
    graphql: {
      RepoCore: core ?? (fixture("repo-core.vercel-next.js.json") as object),
    },
    rest: [
      ...rest,
      [
        /\/contributors\?per_page=40$/,
        json(fixture("contributors.vercel-next.js.json"), {
          headers: { link: linkHeader(`${CONTRIBUTORS}?per_page=40`, 11) },
        }),
      ],
      [
        /\/contributors\?per_page=1$/,
        json([], {
          headers: { link: linkHeader(`${CONTRIBUTORS}?per_page=1`, 420) },
        }),
      ],
      [
        /\/stats\/commit_activity$/,
        fixture("commit-activity.vercel-next.js.json") as object,
      ],
      [
        /\/stargazers\/history$/,
        fixture("stargazers-history.vercel-next.js.json") as object,
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

function checked(repo: Repo | null): Repo {
  if (!repo) throw new Error("expected a repository");
  expect(RepoSchema.parse(repo)).toEqual(repo);
  return repo;
}

beforeEach(() => {
  process.env.GITHUB_TOKEN = "server-token";
  warn = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  fake?.restore();
  warn.mockRestore();
  delete process.env.GITHUB_TOKEN;
});

describe("fetchRepo", () => {
  test("a repository with all its parts", async () => {
    serve(nextRoutes());
    const repo = checked(await fetchRepo("vercel", "next.js", { now: NOW }));

    expect(fake.unexpected).toEqual([]);
    expect(
      fake.calls.map((call) => call.operation ?? call.path).sort(),
    ).toEqual([
      "/repos/vercel/next.js/contributors?per_page=1",
      "/repos/vercel/next.js/contributors?per_page=40",
      "/repos/vercel/next.js/stargazers/history",
      "/repos/vercel/next.js/stats/commit_activity",
      "RepoCore",
    ]);
    expect(fake.calls.find((call) => call.operation)?.variables).toEqual({
      owner: "vercel",
      name: "next.js",
    });
    expect(repo).toMatchObject({
      kind: "repo",
      fullName: "vercel/next.js",
      name: "next.js",
      owner: { login: "vercel", kind: "org" },
      license: "MIT",
      fetchedAt: "2026-11-13T04:23:19Z",
    });
    expect(repo.contributors).toHaveLength(30);
    expect(repo.contributors[0]?.login).toBe("ijjk");
    expect(repo.contributors.map((c) => c.login)).not.toContain(
      "vercel-release-bot",
    );
    expect(repo.contributorCount).toBe(420);
    expect(repo.activity?.weeks).toHaveLength(52);
    expect(repo.activity?.weeks[0]?.days).toHaveLength(7);
    expect(repo.starHistory).toHaveLength(30);
    expect(repo.starHistory?.at(-1)?.stars).toBe(repo.stars);
    expect(repo.starHistory?.[0]?.week).toBe("2026-04-19");
    expect(warn).not.toHaveBeenCalled();
  });

  test("anonymous contributor rows are never requested", async () => {
    serve(nextRoutes());
    await fetchRepo("vercel", "next.js", { now: NOW });
    expect(fake.calls.some((call) => call.path.includes("anon"))).toBe(false);
  });

  test("a short contributor list is counted without a second request", async () => {
    serve({
      graphql: {
        RepoCore: fixture("repo-core.sindresorhus-yocto-queue.json") as object,
      },
      rest: [
        [
          /\/contributors\?per_page=40$/,
          fixture("contributors.sindresorhus-yocto-queue.json") as object,
        ],
        [
          /\/stats\/commit_activity$/,
          fixture("commit-activity.sindresorhus-yocto-queue.json") as object,
        ],
        [
          /\/stargazers\/history$/,
          fixture("stargazers-history.sindresorhus-yocto-queue.json") as object,
        ],
      ],
    });
    const repo = checked(
      await fetchRepo("sindresorhus", "yocto-queue", { now: NOW }),
    );
    expect(fake.unexpected).toEqual([]);
    expect(fake.calls).toHaveLength(4);
    expect(repo.contributors).toHaveLength(4);
    expect(repo.contributorCount).toBe(4);
    expect(repo.owner.kind).toBe("user");
    expect(repo.starHistory?.at(-1)?.stars).toBe(repo.stars);
  });

  test("a renamed repository resolves to its new name", async () => {
    serve(nextRoutes([], fixture("repo-core.facebook-react.json") as object));
    const repo = checked(await fetchRepo("facebook", "react", { now: NOW }));
    expect(repo.fullName).toBe("react/react");
    expect(repo.owner.login).toBe("react");
    // The add-ons were requested under the old name; GitHub redirects them.
    expect(fake.matching(/^\/repos\/facebook\/react\//)).toHaveLength(4);
  });

  test("contributors GitHub refuses to list: empty list, unknown count, no noise", async () => {
    serve(
      nextRoutes(
        [
          [
            /\/contributors/,
            json(
              { message: TOO_LARGE, status: "403" },
              { status: 403, headers: { "x-ratelimit-remaining": "4821" } },
            ),
          ],
        ],
        fixture("repo-core.torvalds-linux.json") as object,
      ),
    );
    const repo = checked(await fetchRepo("torvalds", "linux", { now: NOW }));
    expect(repo.contributors).toEqual([]);
    expect(repo.contributorCount).toBeNull();
    expect(repo.activity).not.toBeNull();
    expect(repo.starHistory).not.toBeNull();
    expect(repo.license).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  test("an empty repository (204) has no contributors and no count", async () => {
    serve(
      nextRoutes([
        [/\/contributors/, new Response(null, { status: 204 })],
        [/\/stats\/commit_activity$/, new Response(null, { status: 204 })],
      ]),
    );
    const repo = checked(await fetchRepo("vercel", "next.js", { now: NOW }));
    expect(repo.contributors).toEqual([]);
    expect(repo.contributorCount).toBeNull();
    expect(repo.activity).toEqual({ total: 0, weeks: [] });
  });

  test("statistics still being computed (202): activity null, nothing waits", async () => {
    serve(
      nextRoutes([[/\/stats\/commit_activity$/, json({}, { status: 202 })]]),
    );
    const repo = checked(await fetchRepo("vercel", "next.js", { now: NOW }));
    expect(repo.activity).toBeNull();
    expect(fake.matching(/commit_activity/)).toHaveLength(1);
    expect(repo.contributors).toHaveLength(30);
    expect(warn).not.toHaveBeenCalled();
  });

  test("failing add-ons degrade the repository instead of failing it", async () => {
    serve(
      nextRoutes([
        [/\/contributors/, json({ message: "Server Error" }, { status: 500 })],
        [/\/stats\/commit_activity$/, htmlTimeout(504)],
        [
          /\/stargazers\/history$/,
          json({ message: "Not Found" }, { status: 404 }),
        ],
      ]),
    );
    const repo = checked(await fetchRepo("vercel", "next.js", { now: NOW }));
    expect(repo.contributors).toEqual([]);
    expect(repo.contributorCount).toBeNull();
    expect(repo.activity).toBeNull();
    expect(repo.starHistory).toBeNull();
    expect(repo.stars).toBeGreaterThan(100_000);
    // The 404 is an answer; the two real failures are logged.
    expect(warn).toHaveBeenCalledTimes(2);
  });

  test("an unknown contributor total keeps the list", async () => {
    serve(
      nextRoutes([
        [
          /\/contributors\?per_page=1$/,
          json({ message: "Server Error" }, { status: 500 }),
        ],
      ]),
    );
    const repo = checked(await fetchRepo("vercel", "next.js", { now: NOW }));
    expect(repo.contributors).toHaveLength(30);
    expect(repo.contributorCount).toBeNull();
  });

  test("a missing repository is null", async () => {
    const notFound = json({ message: "Not Found" }, { status: 404 });
    serve({
      graphql: { RepoCore: fixture("repo-core.missing.json") as object },
      rest: [[/.*/, notFound]],
    });
    expect(await fetchRepo("vercel", "nope-zz9", { now: NOW })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  test("a private repository is null even when the token can see it", async () => {
    const core = decode(
      RepoCoreDataSchema,
      fixtureData("repo-core.sindresorhus-yocto-queue.json"),
      "core",
    ).repository;
    serve(
      nextRoutes([], {
        data: {
          repository: { ...core, isPrivate: true, visibility: "PRIVATE" },
        },
      }),
    );
    expect(await fetchRepo("acme", "secret", { now: NOW })).toBeNull();
  });

  test("a repository known to be missing is checked with one request", async () => {
    // The banner of a deleted repository is re-checked every few minutes.
    const missing = (): Routes => ({
      graphql: { RepoCore: fixture("repo-core.missing.json") as object },
      rest: [[/.*/, json({ message: "Not Found" }, { status: 404 })]],
    });
    const name = neverSeen("Repo");
    serve(missing());
    expect(await fetchRepo("Gone", name, { now: NOW })).toBeNull();
    await Bun.sleep(5);
    // First sight: the add-ons were already on their way.
    expect(fake.calls).toHaveLength(4);
    fake.restore();

    for (const [owner, spelling] of [
      ["gone", name.toLowerCase()],
      ["GONE", name.toUpperCase()],
    ] as const) {
      serve(missing());
      expect(await fetchRepo(owner, spelling, { now: NOW })).toBeNull();
      await Bun.sleep(5);
      expect(fake.calls.map((call) => call.operation)).toEqual(["RepoCore"]);
      fake.restore();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  test("a private repository's add-ons are requested at most once", async () => {
    const core = decode(
      RepoCoreDataSchema,
      fixtureData("repo-core.sindresorhus-yocto-queue.json"),
      "core",
    ).repository;
    const secret = {
      data: { repository: { ...core, isPrivate: true, visibility: "PRIVATE" } },
    };
    serve(nextRoutes([], secret));
    expect(await fetchRepo("acme", "secret-2", { now: NOW })).toBeNull();
    await Bun.sleep(5);
    fake.restore();

    serve(nextRoutes([], secret));
    expect(await fetchRepo("acme", "secret-2", { now: NOW })).toBeNull();
    await Bun.sleep(5);
    expect(fake.calls.map((call) => call.operation)).toEqual(["RepoCore"]);
  });

  test("a repository that appears is complete at once, then fetched in parallel again", async () => {
    serve({
      graphql: { RepoCore: fixture("repo-core.missing.json") as object },
      rest: [[/.*/, json({ message: "Not Found" }, { status: 404 })]],
    });
    expect(await fetchRepo("gone", "repo-3", { now: NOW })).toBeNull();
    await Bun.sleep(5);
    fake.restore();

    // Created (or made public) in the meantime.
    serve(nextRoutes());
    const repo = checked(await fetchRepo("gone", "repo-3", { now: NOW }));
    // Remembered as missing: the add-ons follow the core this once.
    expect(fake.calls[0]?.operation).toBe("RepoCore");
    expect(fake.calls).toHaveLength(5);
    expect(repo.contributors).toHaveLength(30);
    expect(repo.activity?.weeks).toHaveLength(52);
    expect(repo.starHistory).toHaveLength(30);
    fake.restore();

    const gate = Promise.withResolvers<void>();
    serve(
      nextRoutes([], async () => {
        await gate.promise;
        return json(fixture("repo-core.vercel-next.js.json"));
      }),
    );
    const pending = fetchRepo("gone", "repo-3", { now: NOW });
    await Bun.sleep(5);
    // Known to exist again: the add-ons are in flight while the core is not
    // back yet (4 of the 5 requests; the contributor count follows the list).
    expect(fake.matching(/^\/repos\/gone\/repo-3\//).length).toBeGreaterThan(2);
    gate.resolve();
    checked(await pending);
  });

  test.each([
    ["not a login", "repo"],
    ["vercel", ""],
    ["vercel", ".."],
    ["vercel", "has space"],
    ["vercel", "a/b"],
    ["vercel", "x".repeat(101)],
  ])("%p / %p cannot be a repository: null without a request", async (owner, name) => {
    serve({});
    expect(await fetchRepo(owner, name)).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  test("a failing core request throws", async () => {
    serve(nextRoutes([], htmlTimeout()));
    const error = await fetchRepo("vercel", "next.js").catch((e) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error.code).toBe("unavailable");
  });

  test("without a token there is no fallback: unavailable, no request", async () => {
    delete process.env.GITHUB_TOKEN;
    serve({});
    const error = await fetchRepo("vercel", "next.js").catch((e) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error.code).toBe("unavailable");
    expect(fake.calls).toHaveLength(0);
  });

  test("a per-request token is used for every request", async () => {
    delete process.env.GITHUB_TOKEN;
    serve(nextRoutes());
    checked(
      await fetchRepo("vercel", "next.js", {
        now: NOW,
        token: "visitor-token",
      }),
    );
    expect(fake.calls).toHaveLength(5);
    for (const call of fake.calls) {
      expect(call.headers.get("authorization")).toBe("Bearer visitor-token");
    }
  });
});
