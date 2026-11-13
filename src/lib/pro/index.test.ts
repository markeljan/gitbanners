import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setEnv } from "../../../tests/e2e/auth/helpers";
import { upsertUser } from "../db/users";
import { site } from "../site";
import { MemoryStore } from "../store/memory";
import {
  decideProAtSignIn,
  FREE,
  getEntitlements,
  getProStatus,
  isAllowlisted,
  PRO,
  PRO_FRESH_MS,
  type ProDeps,
  type ProStatus,
  proRepo,
  proRepoSlug,
  proRequired,
  type StargazerLookup,
} from "./index";

const user = { id: "4242", login: "Octo-Test" };
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

type Verdict = Awaited<ReturnType<StargazerLookup>>;
type TokenAnswer = boolean | "unknown" | Error;

/** Deps with scripted answers and a record of what was asked. */
function harness(options: {
  stargazer?: Verdict | Error;
  token?: TokenAnswer;
  now?: number;
}) {
  const state = {
    store: new MemoryStore(),
    now: options.now ?? 1_800_000_000_000,
    stargazer: options.stargazer ?? ("unknown" as Verdict | Error),
    token: options.token ?? ("unknown" as TokenAnswer),
    stargazerCalls: [] as Parameters<StargazerLookup>[],
    tokenCalls: [] as [string, { owner: string; name: string }][],
  };
  const deps: ProDeps = {
    store: state.store,
    now: () => state.now,
    findStargazer: async (...args) => {
      state.stargazerCalls.push(args);
      if (state.stargazer instanceof Error) throw state.stargazer;
      return state.stargazer;
    },
    hasStarred: async (token, repo) => {
      state.tokenCalls.push([token, repo]);
      if (state.token instanceof Error) throw state.token;
      return state.token;
    },
  };
  const stored = async () =>
    (await state.store.get("pro:4242")) as ProStatus | null;
  return { state, deps, stored };
}

let restore = () => {};
beforeEach(() => {
  restore = setEnv({ PRO_REPO: "acme/gitbanners", PRO_LOGINS: undefined });
});
afterEach(() => restore());

describe("configuration", () => {
  test("PRO_REPO overrides the product repository", () => {
    expect(proRepo()).toEqual({ owner: "acme", name: "gitbanners" });
    setEnv({ PRO_REPO: undefined });
    expect(proRepo()).toEqual({
      owner: site.repo.owner,
      name: site.repo.name,
    });
  });

  test("a malformed PRO_REPO disables star checks instead of guessing", () => {
    for (const bad of ["acme", "acme/", "/x", "a/b/c", "ac me/x", "a/.."]) {
      setEnv({ PRO_REPO: bad });
      expect(proRepo()).toBeNull();
    }
  });

  test("a decision is trusted for six hours when Pro, a minute when not", () => {
    expect(PRO_FRESH_MS).toEqual({ pro: 6 * HOUR, free: MINUTE });
  });

  test("PRO_LOGINS is comma-separated and case-insensitive", () => {
    expect(isAllowlisted("octo-test")).toBe(false);
    setEnv({ PRO_LOGINS: "someone, Octo-Test ,," });
    expect(isAllowlisted("octo-test")).toBe(true);
    expect(isAllowlisted("OCTO-TEST")).toBe(true);
    expect(isAllowlisted("someone")).toBe(true);
    expect(isAllowlisted("octo")).toBe(false);
    setEnv({ PRO_LOGINS: "" });
    expect(isAllowlisted("")).toBe(false);
  });
});

describe("decideProAtSignIn: first positive wins", () => {
  test("(a) the allowlist wins without asking GitHub", async () => {
    setEnv({ PRO_LOGINS: "octo-test" });
    const h = harness({ token: false, stargazer: "not_starred" });
    const status = await decideProAtSignIn(user, { accessToken: "t" }, h.deps);
    expect(status).toEqual({
      pro: true,
      at: h.state.now,
      source: "allowlist",
      verdict: "starred",
    });
    expect(status).toMatchObject((await h.stored()) ?? {});
    expect(h.state.tokenCalls).toEqual([]);
    expect(h.state.stargazerCalls).toEqual([]);
  });

  test("(b) the user's token finds the star; the server lookup is skipped", async () => {
    const h = harness({ token: true, stargazer: "not_starred" });
    const status = await decideProAtSignIn(
      user,
      { accessToken: "gho_x" },
      h.deps,
    );
    expect(status).toEqual({
      pro: true,
      at: h.state.now,
      source: "user_token",
      verdict: "starred",
    });
    expect(status).toMatchObject((await h.stored()) ?? {});
    expect(h.state.tokenCalls).toEqual([
      ["gho_x", { owner: "acme", name: "gitbanners" }],
    ]);
    expect(h.state.stargazerCalls).toEqual([]);
  });

  test("(c) the server lookup finds a star the token could not see", async () => {
    for (const token of [false, "unknown", new Error("network")] as const) {
      const h = harness({ token, stargazer: "starred" });
      const status = await decideProAtSignIn(
        user,
        { accessToken: "t" },
        h.deps,
      );
      expect(status).toEqual({
        pro: true,
        at: h.state.now,
        source: "stargazers",
        verdict: "starred",
      });
      expect(h.state.tokenCalls.length).toBe(1);
      expect(h.state.stargazerCalls.length).toBe(1);
    }
  });

  test("(c) is asked with the repository, the numeric id and a signal", async () => {
    const h = harness({ stargazer: "starred" });
    await decideProAtSignIn(user, {}, h.deps);
    const [repo, id, opts] = h.state.stargazerCalls[0];
    expect(repo).toEqual({ owner: "acme", name: "gitbanners" });
    expect(id).toBe(4242);
    expect(opts?.signal).toBeInstanceOf(AbortSignal);
  });

  test("without a token (development sign-in) only (a) and (c) run", async () => {
    const h = harness({ token: true, stargazer: "starred" });
    const status = await decideProAtSignIn(user, {}, h.deps);
    expect(status.source).toBe("stargazers");
    expect(h.state.tokenCalls).toEqual([]);
  });

  test("a definite 'no' from either check stores not-Pro", async () => {
    const cases: [TokenAnswer, Verdict][] = [
      [false, "unknown"],
      ["unknown", "not_starred"],
      [false, "not_starred"],
    ];
    for (const [token, stargazer] of cases) {
      const h = harness({ token, stargazer });
      const status = await decideProAtSignIn(
        user,
        { accessToken: "t" },
        h.deps,
      );
      expect(status).toEqual({
        pro: false,
        at: h.state.now,
        source: null,
        verdict: "not_starred",
      });
      expect(status).toMatchObject((await h.stored()) ?? {});
    }
  });

  test("a definite 'no' downgrades a previous Pro", async () => {
    const h = harness({ token: false, stargazer: "unknown" });
    await h.state.store.set("pro:4242", {
      pro: true,
      at: h.state.now - HOUR,
      source: "user_token",
    });
    expect(
      (await decideProAtSignIn(user, { accessToken: "t" }, h.deps)).pro,
    ).toBe(false);
  });

  test("a definite 'no' ends Pro whichever check granted it", async () => {
    const cases: [TokenAnswer, Verdict][] = [
      [false, "unknown"],
      ["unknown", "not_starred"],
    ];
    for (const source of ["user_token", "stargazers", "allowlist"] as const) {
      for (const [token, stargazer] of cases) {
        const h = harness({ token, stargazer });
        await h.state.store.set("pro:4242", {
          pro: true,
          at: h.state.now - HOUR,
          source,
        });
        expect(
          await decideProAtSignIn(user, { accessToken: "t" }, h.deps),
        ).toEqual({
          pro: false,
          at: h.state.now,
          source: null,
          verdict: "not_starred",
        });
      }
    }
  });

  test("nothing could answer and nothing is known: not Pro, retried soon", async () => {
    const h = harness({ token: "unknown", stargazer: new Error("boom") });
    const status = await decideProAtSignIn(user, { accessToken: "t" }, h.deps);
    expect(status).toEqual({
      pro: false,
      at: h.state.now,
      source: null,
      verdict: "unknown",
    });
    expect(status).toMatchObject((await h.stored()) ?? {});
  });

  test("nothing could answer: the last known Pro stays (stale-if-error)", async () => {
    const h = harness({
      token: new Error("github down"),
      stargazer: "unknown",
    });
    await h.state.store.set("pro:4242", {
      pro: true,
      at: h.state.now - 7 * HOUR,
      source: "user_token",
    });
    const status = await decideProAtSignIn(user, { accessToken: "t" }, h.deps);
    expect(status.pro).toBe(true);
    expect(status.source).toBe("user_token");
    // Trusted for a full window again: see keepLastKnown() for why not sooner.
    expect(status.at).toBe(h.state.now);
    expect(status).toMatchObject((await h.stored()) ?? {});
  });

  test("a malformed PRO_REPO leaves only the allowlist", async () => {
    setEnv({ PRO_REPO: "not-a-repo" });
    const h = harness({ token: true, stargazer: "starred" });
    expect(
      (await decideProAtSignIn(user, { accessToken: "t" }, h.deps)).pro,
    ).toBe(false);
    expect(h.state.tokenCalls).toEqual([]);
    expect(h.state.stargazerCalls).toEqual([]);
  });
});

describe("getProStatus", () => {
  async function seeded(
    cached: ProStatus | null,
    options: Parameters<typeof harness>[0] = {},
  ) {
    const h = harness(options);
    await upsertUser({ ...user, name: null, avatarUrl: "" }, h.state.store);
    if (cached) await h.state.store.set("pro:4242", cached);
    return h;
  }

  test("a fresh decision is returned without asking anyone", async () => {
    const now = 1_800_000_000_000;
    const pro = {
      pro: true,
      at: now - 5 * HOUR,
      source: "user_token",
    } as const;
    const h = await seeded(pro, { now, stargazer: "not_starred" });
    expect(await getProStatus("4242", h.deps)).toEqual(pro);

    const free = { pro: false, at: now - 59_000, source: null };
    await h.state.store.set("pro:4242", free);
    expect(await getProStatus("4242", h.deps)).toEqual(free);
    expect(h.state.stargazerCalls).toEqual([]);
  });

  test("not-Pro goes stale after a minute and is re-checked through (c) only", async () => {
    const now = 1_800_000_000_000;
    const h = await seeded(
      { pro: false, at: now - 61_000, source: null },
      { now, stargazer: "starred", token: true },
    );
    const status = await getProStatus("4242", h.deps);
    expect(status).toEqual({ pro: true, at: now, source: "stargazers" });
    expect(status).toMatchObject((await h.stored()) ?? {});
    expect(h.state.stargazerCalls.length).toBe(1);
    expect(h.state.stargazerCalls[0][1]).toBe(4242);
    // No stored token exists, so the user-token check can never run here.
    expect(h.state.tokenCalls).toEqual([]);
  });

  test("Pro goes stale after six hours; an un-star downgrades", async () => {
    const now = 1_800_000_000_000;
    const h = await seeded(
      { pro: true, at: now - 6 * HOUR - 1, source: "user_token" },
      { now, stargazer: "not_starred" },
    );
    expect(await getProStatus("4242", h.deps)).toEqual({
      pro: false,
      at: now,
      source: null,
    });
  });

  test("stale Pro survives a lookup that cannot answer, without hammering", async () => {
    const now = 1_800_000_000_000;
    for (const stargazer of ["unknown", new Error("502")] as const) {
      const h = await seeded(
        { pro: true, at: now - 30 * HOUR, source: "stargazers" },
        { now, stargazer },
      );
      const kept = await getProStatus("4242", h.deps);
      expect(kept).toEqual({ pro: true, at: now, source: "stargazers" });
      expect(h.state.stargazerCalls.length).toBe(1);

      // An inconclusive lookup may be the steady state (a token that cannot
      // list stargazers, a list too long to read): it must not be repeated
      // every minute. The kept value answers for a full Pro window.
      for (const later of [61_000, HOUR, 6 * HOUR - 1]) {
        h.state.now = now + later;
        expect((await getProStatus("4242", h.deps)).pro).toBe(true);
      }
      expect(h.state.stargazerCalls.length).toBe(1);

      // Then it asks again, and a real answer is taken.
      h.state.now = now + 6 * HOUR;
      h.state.stargazer = "not_starred";
      expect(await getProStatus("4242", h.deps)).toEqual({
        pro: false,
        at: now + 6 * HOUR,
        source: null,
      });
      expect(h.state.stargazerCalls.length).toBe(2);
    }
  });

  test("a lookup that never answers costs one request per window, not per read", async () => {
    const now = 1_800_000_000_000;
    const h = await seeded(
      { pro: true, at: now - 7 * HOUR, source: "user_token" },
      { now, stargazer: "unknown" },
    );
    // A day of page views, one a minute.
    for (let minute = 0; minute < 24 * 60; minute++) {
      h.state.now = now + minute * MINUTE;
      expect((await getProStatus("4242", h.deps)).pro).toBe(true);
    }
    expect(h.state.stargazerCalls.length).toBe(4);
  });

  test("no cached decision and no answer: not Pro, checked again in a minute", async () => {
    const now = 1_800_000_000_000;
    const h = await seeded(null, { now, stargazer: "unknown" });
    expect(await getProStatus("4242", h.deps)).toEqual({
      pro: false,
      at: now,
      source: null,
    });
    h.state.now = now + 30_000;
    await getProStatus("4242", h.deps);
    expect(h.state.stargazerCalls.length).toBe(1);
    h.state.now = now + 61_000;
    await getProStatus("4242", h.deps);
    expect(h.state.stargazerCalls.length).toBe(2);
  });

  test("the allowlist is honoured on a re-check, before any lookup", async () => {
    const now = 1_800_000_000_000;
    setEnv({ PRO_LOGINS: "OCTO-TEST" });
    const h = await seeded(
      { pro: false, at: now - 2 * MINUTE, source: null },
      { now, stargazer: "not_starred" },
    );
    expect(await getProStatus("4242", h.deps)).toEqual({
      pro: true,
      at: now,
      source: "allowlist",
    });
    expect(h.state.stargazerCalls).toEqual([]);
  });

  test("leaving the allowlist ends Pro unless a star speaks for it", async () => {
    const now = 1_800_000_000_000;
    const allowlisted = { pro: true, at: now - 7 * HOUR, source: "allowlist" };
    const h = await seeded(allowlisted as ProStatus, { now });
    // The lookup cannot answer: an allowlist grant has no star behind it.
    expect(await getProStatus("4242", h.deps)).toEqual({
      pro: false,
      at: now,
      source: null,
    });

    const starred = await seeded(allowlisted as ProStatus, {
      now,
      stargazer: "starred",
    });
    expect((await getProStatus("4242", starred.deps)).source).toBe(
      "stargazers",
    );
  });

  test("an id without an account is not Pro and nothing is stored for it", async () => {
    const h = harness({ stargazer: "starred" });
    expect(await getProStatus("999", h.deps)).toEqual({
      pro: false,
      at: 0,
      source: null,
    });
    expect(await h.state.store.get("pro:999")).toBeNull();
    expect(h.state.stargazerCalls).toEqual([]);
  });

  test("concurrent readers share one re-check", async () => {
    const h = await seeded(null, { stargazer: "starred" });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => getProStatus("4242", h.deps)),
    );
    expect(results.every((status) => status.pro)).toBe(true);
    expect(h.state.stargazerCalls.length).toBe(1);
    // The in-flight entry is gone afterwards: a later stale read checks again.
    h.state.now += 7 * HOUR;
    await getProStatus("4242", h.deps);
    expect(h.state.stargazerCalls.length).toBe(2);
  });

  test("a cached document of the wrong shape is ignored", async () => {
    const h = await seeded(null, { stargazer: "starred" });
    await h.state.store.set("pro:4242", { pro: "yes", at: "now" });
    expect((await getProStatus("4242", h.deps)).source).toBe("stargazers");
  });

  test("getEntitlements maps the status to a plan", async () => {
    const now = 1_800_000_000_000;
    const h = await seeded(
      { pro: true, at: now, source: "stargazers" },
      { now },
    );
    expect(await getEntitlements("4242", h.deps)).toBe(PRO);
    await h.state.store.set("pro:4242", { pro: false, at: now, source: null });
    expect(await getEntitlements("4242", h.deps)).toBe(FREE);
  });
});

test("the default lookup is the GitHub data layer; without a server token it cannot answer", async () => {
  // Nothing injected: `@/lib/github/stargazers` is imported lazily. With no
  // token it answers "unknown" before any request, so this stays offline.
  const undo = setEnv({ GITHUB_TOKEN: undefined, NODE_ENV: "test" });
  try {
    const store = new MemoryStore();
    const status = await decideProAtSignIn(user, {}, { store });
    expect(status).toMatchObject({ pro: false, source: null });
    expect(status).toMatchObject((await store.get("pro:4242")) ?? {});
  } finally {
    undo();
  }
});

test("proRequired is a 403 problem that says how to unlock Pro", async () => {
  const response = proRequired("Only Pro accounts can animate banners.");
  expect(response.status).toBe(403);
  expect(response.headers.get("content-type")).toBe("application/problem+json");
  const body = await response.json();
  expect(body).toMatchObject({
    status: 403,
    code: "pro_required",
    title: "Pro required",
    detail: "Only Pro accounts can animate banners.",
  });
  // Names the repository that actually unlocks Pro, also when overridden.
  expect(body.resolution).toContain("acme/gitbanners");
  setEnv({ PRO_REPO: undefined });
  expect((await proRequired("x").json()).resolution).toContain(site.repo.slug);
  setEnv({ PRO_REPO: "broken" });
  expect(proRepoSlug()).toBe(site.repo.slug);
  expect(JSON.stringify(body)).not.toMatch(/oauth/i);
});
