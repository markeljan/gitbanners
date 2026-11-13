/**
 * The two sign-in handlers, driven directly with a fake cookie jar and the
 * mock GitHub. This covers what the HTTP suite cannot reach under `next dev`:
 * production cookie flags, the canonical-origin redirect and the "accounts
 * are not configured" answers.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  type Mock,
  spyOn,
  test,
} from "bun:test";
import { NextRequest } from "next/server";
import {
  expectMethodGuards,
  installFakeCookies,
  installRealFetch,
  randomSecret,
  setEnv,
} from "../../../../../tests/e2e/auth/helpers";
import {
  MOCK_CLIENT_ID,
  MOCK_CLIENT_SECRET,
  type MockGitHub,
  startMockGitHub,
} from "../../../../../tests/e2e/auth/mock-github";

installRealFetch();

// Must be in place before the handlers are evaluated.
const cookies = installFakeCookies();

const { getUser } = await import("@/lib/db/users");
const { site } = await import("@/lib/site");
const { setStore } = await import("@/lib/store");
const { MemoryStore } = await import("@/lib/store/memory");
const startRoute = await import("./route");
const callbackRoute = await import("./callback/route");
const { GET: start } = startRoute;
const { GET: callback } = callbackRoute;

const CANONICAL = new URL(site.url).origin;
const canonicalHeaders = {
  host: new URL(site.url).host,
  "x-forwarded-proto": new URL(site.url).protocol.replace(":", ""),
};

let mock: MockGitHub;
let store = new MemoryStore();
let restore = () => {};
let errorLog: Mock<typeof console.error>;
beforeAll(() => {
  mock = startMockGitHub();
});
afterAll(() => mock.stop());
beforeEach(() => {
  // Failed sign-ins are logged; captured so the output stays readable and the
  // log lines themselves can be checked.
  errorLog = spyOn(console, "error").mockImplementation(() => {});
  restore = setEnv({
    NODE_ENV: "production",
    SESSION_SECRET: randomSecret(),
    SESSION_SECRET_PREVIOUS: undefined,
    GITHUB_CLIENT_ID: MOCK_CLIENT_ID,
    GITHUB_CLIENT_SECRET: MOCK_CLIENT_SECRET,
    GITHUB_WEB_URL: mock.url,
    GITHUB_API_URL: mock.url,
    // The server-side stargazer lookup must stay offline in unit tests.
    GITHUB_TOKEN: undefined,
    PRO_REPO: "acme/gitbanners",
    PRO_LOGINS: undefined,
    VERCEL: undefined,
    VERCEL_ENV: undefined,
    KV_REST_API_URL: undefined,
    KV_REST_API_TOKEN: undefined,
    UPSTASH_REDIS_REST_URL: undefined,
    UPSTASH_REDIS_REST_TOKEN: undefined,
  });
  store = new MemoryStore();
  setStore(store);
  cookies.request();
  // Starred, so every completed sign-in is decided by the user's own token
  // and the server-side lookup (another module, possibly the network) is
  // never reached from these tests.
  Object.assign(mock.state, {
    starred: true,
    deny: false,
    checkNeedsScope: false,
    starListTruncated: false,
    user: { id: 4242, login: "Octo-Test", name: null },
  });
  mock.requests.length = 0;
});
afterEach(() => {
  restore();
  setStore(undefined);
  errorLog.mockRestore();
});

function startRequest(
  query = "",
  headers: Record<string, string> = canonicalHeaders,
) {
  return start(
    new NextRequest(`http://localhost:3000/api/auth/github${query}`, {
      headers,
    }),
  );
}

function callbackRequest(url: string, ip = "198.51.100.1") {
  const { search } = new URL(url);
  return callback(
    new NextRequest(`http://localhost:3000/api/auth/github/callback${search}`, {
      headers: { ...canonicalHeaders, "x-forwarded-for": ip },
    }),
  );
}

/** start → consent on the mock. Leaves the transaction cookie in the jar. */
async function begin(query = "", ip?: string) {
  cookies.request();
  const started = await startRequest(query);
  const authorizeUrl = started.headers.get("location") ?? "";
  const consent = await fetch(authorizeUrl, { redirect: "manual" });
  const callbackUrl = consent.headers.get("location") ?? "";
  cookies.request(cookies.nextCookieHeader());
  return {
    authorizeUrl: new URL(authorizeUrl),
    callbackUrl,
    finish: () => callbackRequest(callbackUrl, ip),
  };
}

test("both routes are GET only: other methods are 405 problems, no cookie, no GitHub call", async () => {
  await expectMethodGuards(startRoute, "/api/auth/github", ["GET"]);
  await expectMethodGuards(callbackRoute, "/api/auth/github/callback", ["GET"]);
  expect(cookies.written()).toEqual([]);
  expect(mock.requests).toEqual([]);
});

describe("GET /api/auth/github", () => {
  test("302 to GitHub with state, PKCE and no scope; a ten-minute cookie", async () => {
    const response = await startRequest("?returnTo=/studio");
    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const url = new URL(response.headers.get("location") ?? "");
    expect(url.origin + url.pathname).toBe(`${mock.url}/login/oauth/authorize`);
    expect([...url.searchParams.keys()].sort()).toEqual([
      "allow_signup",
      "client_id",
      "code_challenge",
      "code_challenge_method",
      "redirect_uri",
      "state",
    ]);
    expect(url.searchParams.get("client_id")).toBe(MOCK_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${CANONICAL}/api/auth/github/callback`,
    );
    expect(url.searchParams.get("state")).toMatch(/^[\w-]{43}$/);
    expect(url.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");

    const written = cookies.written();
    expect(written.length).toBe(1);
    expect(
      written[0].replace(/=[^;]*/, "=<jwt>").replace(/ Expires=[^;]+;/, ""),
    ).toBe(
      "__Host-gb_signin=<jwt>; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=lax",
    );
  });

  test("state and verifier differ on every request", async () => {
    const first = new URL((await startRequest()).headers.get("location") ?? "");
    const second = new URL(
      (await startRequest()).headers.get("location") ?? "",
    );
    expect(first.searchParams.get("state")).not.toBe(
      second.searchParams.get("state"),
    );
    expect(first.searchParams.get("code_challenge")).not.toBe(
      second.searchParams.get("code_challenge"),
    );
  });

  test("production: another host is sent to the canonical origin first, without a cookie", async () => {
    const response = await startRequest("?returnTo=/studio%3Fx=1", {
      host: "gitbanners-git-feature.vercel.app",
      "x-forwarded-proto": "https",
    });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `${CANONICAL}/api/auth/github?returnTo=%2Fstudio%3Fx%3D1&canonical=1`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(cookies.written()).toEqual([]);
    expect(mock.requests).toEqual([]);
  });

  test("production: arriving on the wrong host twice is an error, not a loop", async () => {
    const response = await startRequest("?returnTo=/&canonical=1", {
      host: "www.gitbanners.example",
      "x-forwarded-proto": "https",
    });
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json",
    );
    expect(await response.json()).toMatchObject({ code: "origin_mismatch" });
    expect(cookies.written()).toEqual([]);
  });

  test("development: the flow stays on whatever address was used", async () => {
    setEnv({ NODE_ENV: "development" });
    const response = await startRequest("", {
      host: "127.0.0.1:3111",
      "x-forwarded-proto": "http",
    });
    expect(response.status).toBe(302);
    const url = new URL(response.headers.get("location") ?? "");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:3111/api/auth/github/callback",
    );
    expect(cookies.written()[0]).toStartWith("gb_signin=");
    expect(cookies.written()[0]).not.toContain("Secure");
  });

  describe("accounts not configured", () => {
    const cases: [string, Record<string, string | undefined>][] = [
      ["no database on Vercel", { VERCEL: "1" }],
      ["no session secret", { SESSION_SECRET: undefined }],
      ["no GitHub app credentials", { GITHUB_CLIENT_ID: undefined }],
      ["no GitHub app secret", { GITHUB_CLIENT_SECRET: undefined }],
    ];
    for (const [label, vars] of cases) {
      test(`${label}: a clear 503 instead of pretending to work`, async () => {
        setEnv(vars);
        setStore(undefined);
        const response = await startRequest("?returnTo=/studio");
        expect(response.status).toBe(503);
        expect(response.headers.get("content-type")).toBe(
          "application/problem+json",
        );
        expect(response.headers.get("cache-control")).toBe("no-store");
        const text = await response.text();
        expect(JSON.parse(text)).toMatchObject({
          status: 503,
          code: "accounts_unavailable",
          title: "Accounts are not configured on this deployment",
          instance: "/api/auth/github",
        });
        expect(text).not.toMatch(/oauth/i);
        expect(cookies.written()).toEqual([]);
        expect(mock.requests).toEqual([]);
      });
    }
  });
});

describe("GET /api/auth/github/callback", () => {
  test("completes the sign-in: 303 back, cookies swapped, account stored", async () => {
    const flow = await begin("?returnTo=/studio%3Fx=1%23top");
    const response = await flow.finish();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/studio?x=1#top");
    expect(response.headers.get("cache-control")).toBe("no-store");

    expect(
      cookies
        .written()
        .map((line) =>
          line.replace(/=[^;]*/, "=<v>").replace(/ Expires=[^;]+;/, ""),
        ),
    ).toEqual([
      "__Host-gb_signin=<v>; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=lax",
      "__Host-gb_session=<v>; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=lax",
      "__Host-gb_in=<v>; Path=/; Max-Age=2592000; Secure; SameSite=lax",
    ]);
    expect(cookies.nextCookieHeader()).toMatch(
      /^__Host-gb_session=[^;]+; __Host-gb_in=1$/,
    );

    expect(await getUser("4242")).toMatchObject({
      id: "4242",
      login: "Octo-Test",
      avatarUrl: "https://avatars.githubusercontent.com/u/4242?v=4",
    });
    expect(await store.get("login:octo-test")).toEqual({ id: "4242" });
    expect(await store.get("pro:4242")).toMatchObject({
      pro: true,
      source: "user_token",
    });
  });

  test("GitHub is asked for the code exchange, the identity and the star, nothing else", async () => {
    await (await begin()).finish();
    expect(mock.requests).toEqual([
      "GET /login/oauth/authorize",
      "POST /login/oauth/access_token",
      "GET /user",
      "GET /user/starred/acme/gitbanners",
    ]);
  });

  test("the access token is neither stored nor sent to the browser", async () => {
    const response = await (await begin()).finish();
    const everything = JSON.stringify([
      await store.mget(["user:4242", "pro:4242", "login:octo-test"]),
      cookies.written(),
      [...response.headers],
    ]);
    expect(everything).not.toContain("gho_mock_");
    expect(await store.get("tok:4242")).toBeNull();
  });

  test("an allowlisted login is Pro without a star request", async () => {
    setEnv({ PRO_LOGINS: "octo-test" });
    mock.state.starred = false;
    await (await begin()).finish();
    expect(await store.get("pro:4242")).toMatchObject({
      pro: true,
      source: "allowlist",
    });
    expect(mock.requests).not.toContain("GET /user/starred/acme/gitbanners");
  });

  test("the star is found through the list when the check endpoint hides it", async () => {
    mock.state.checkNeedsScope = true;
    await (await begin()).finish();
    expect(await store.get("pro:4242")).toMatchObject({
      pro: true,
      source: "user_token",
    });
    expect(mock.requests.slice(-2)).toEqual([
      "GET /user/starred/acme/gitbanners",
      "GET /user/starred",
    ]);
  });

  test("no transaction cookie, or a state that does not match: state_mismatch", async () => {
    const flow = await begin("?returnTo=/studio");
    const signedInJar = cookies.nextCookieHeader();

    // Someone else's browser opens the callback URL.
    cookies.request();
    const stranger = await callbackRequest(flow.callbackUrl);
    expect(stranger.status).toBe(303);
    expect(stranger.headers.get("location")).toBe(
      "/?auth_error=state_mismatch",
    );

    // The right cookie, a forged state.
    cookies.request(signedInJar);
    const forged = await callbackRequest(
      flow.callbackUrl.replace(/state=[^&]+/, "state=attacker"),
    );
    expect(forged.headers.get("location")).toBe(
      "/studio?auth_error=state_mismatch",
    );
    // The cookie is spent either way.
    expect(cookies.written()[0]).toStartWith("__Host-gb_signin=;");
    expect(await getUser("4242")).toBeNull();
    expect(mock.requests).not.toContain("POST /login/oauth/access_token");
  });

  test("the callback URL cannot be replayed", async () => {
    const flow = await begin();
    expect((await flow.finish()).headers.get("location")).toBe("/");
    cookies.request(cookies.nextCookieHeader());
    const replay = await flow.finish();
    expect(replay.headers.get("location")).toBe("/?auth_error=state_mismatch");
  });

  test("the user declined: access_denied, and an off-site returnTo is neutralised", async () => {
    mock.state.deny = true;
    const flow = await begin("?returnTo=https://evil.example/phish");
    const response = await flow.finish();
    expect(response.headers.get("location")).toBe("/?auth_error=access_denied");
    expect(await getUser("4242")).toBeNull();
  });

  test("returnTo values that normalise to another host end up at /", async () => {
    for (const target of ["/.//evil.example", "/%2e//evil.example/x", "//x"]) {
      const flow = await begin(`?returnTo=${encodeURIComponent(target)}`);
      expect((await flow.finish()).headers.get("location")).toBe("/");
    }
  });

  test("the error is appended without disturbing the query and fragment", async () => {
    mock.state.deny = true;
    const flow = await begin("?returnTo=/studio%3Ftheme=dark%23preview");
    expect((await flow.finish()).headers.get("location")).toBe(
      "/studio?theme=dark&auth_error=access_denied#preview",
    );
  });

  test("other GitHub errors, a missing code and a dead code", async () => {
    const withQuery = async (edit: (url: URL) => void) => {
      const flow = await begin("?returnTo=/studio");
      const url = new URL(flow.callbackUrl);
      edit(url);
      return (await callbackRequest(url.toString())).headers.get("location");
    };
    expect(
      await withQuery((url) =>
        url.searchParams.set("error", "application_suspended"),
      ),
    ).toBe("/studio?auth_error=github_error");
    expect(await withQuery((url) => url.searchParams.delete("code"))).toBe(
      "/studio?auth_error=missing_code",
    );
    expect(
      await withQuery((url) => url.searchParams.set("code", "x".repeat(300))),
    ).toBe("/studio?auth_error=missing_code");
    expect(
      await withQuery((url) => url.searchParams.set("code", "not-the-code")),
    ).toBe("/studio?auth_error=expired_code");
    expect(await getUser("4242")).toBeNull();
  });

  test("a failed sign-in is logged by reason only: no code, state, token or secret", async () => {
    const flow = await begin("?returnTo=/studio");
    const url = new URL(flow.callbackUrl);
    const realCode = url.searchParams.get("code") ?? "";
    url.searchParams.set("code", "SECRET-LOOKING-CODE");
    await callbackRequest(url.toString());
    expect(errorLog.mock.calls).toEqual([
      ["GitHub sign-in callback failed:", "bad_verification_code"],
    ]);
    const logged = JSON.stringify(errorLog.mock.calls);
    for (const sensitive of [
      "SECRET-LOOKING-CODE",
      realCode,
      url.searchParams.get("state") ?? "",
      MOCK_CLIENT_SECRET,
      "gho_",
    ]) {
      expect(logged).not.toContain(sensitive);
    }
  });

  test("an error code that is not a plain word never reaches the log", async () => {
    // The code is whatever the token endpoint answered. Line breaks or a
    // novel in it must not become log lines of their own.
    for (const error of [
      "bad\nINFO forged log line",
      "x".repeat(500),
      "<script>alert(1)</script>",
    ]) {
      const flow = await begin("?returnTo=/studio");
      const odd = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: () => Response.json({ error, error_description: error }),
      });
      const undo = setEnv({ GITHUB_WEB_URL: `http://127.0.0.1:${odd.port}` });
      errorLog.mockClear();
      try {
        const response = await flow.finish();
        expect(response.headers.get("location")).toBe(
          "/studio?auth_error=sign_in_failed",
        );
      } finally {
        undo();
        odd.stop(true);
      }
      expect(errorLog.mock.calls).toEqual([
        ["GitHub sign-in callback failed:", "unrecognised_error"],
      ]);
    }
  });

  test("a successful sign-in logs nothing", async () => {
    await (await begin()).finish();
    expect(errorLog.mock.calls).toEqual([]);
  });

  test("GitHub unreachable after the redirect: sign_in_failed, no session", async () => {
    const flow = await begin("?returnTo=/studio");
    setEnv({ GITHUB_WEB_URL: "http://127.0.0.1:9" });
    const response = await flow.finish();
    expect(response.headers.get("location")).toBe(
      "/studio?auth_error=sign_in_failed",
    );
    expect(cookies.nextCookieHeader()).toBe("");
  });

  test("accounts switched off between start and callback", async () => {
    const flow = await begin("?returnTo=/studio");
    setEnv({ VERCEL: "1" });
    setStore(undefined);
    expect((await flow.finish()).headers.get("location")).toBe(
      "/studio?auth_error=accounts_unavailable",
    );
  });

  test("the 21st sign-in from one address within ten minutes is rate limited", async () => {
    const ip = "203.0.113.50";
    for (let i = 0; i < 20; i++) {
      const flow = await begin("?returnTo=/studio", ip);
      const url = new URL(flow.callbackUrl);
      // A wrong code: gets past the limiter, then fails at GitHub.
      url.searchParams.set("code", "junk");
      expect(
        (await callbackRequest(url.toString(), ip)).headers.get("location"),
      ).toBe("/studio?auth_error=expired_code");
    }
    const blocked = await (await begin("?returnTo=/studio", ip)).finish();
    expect(blocked.status).toBe(303);
    expect(blocked.headers.get("location")).toBe(
      "/studio?auth_error=rate_limited",
    );
    expect(await getUser("4242")).toBeNull();
    // Another address is unaffected.
    const other = await (
      await begin("?returnTo=/studio", "203.0.113.51")
    ).finish();
    expect(other.headers.get("location")).toBe("/studio");
  });

  test("no error code spells out the protocol", async () => {
    mock.state.deny = true;
    const location =
      (await (await begin()).finish()).headers.get("location") ?? "";
    expect(location).not.toMatch(/oauth/i);
  });
});
