import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { installRealFetch, setEnv } from "../../../tests/e2e/auth/helpers";
import {
  MOCK_CLIENT_ID,
  MOCK_CLIENT_SECRET,
  type MockGitHub,
  startMockGitHub,
} from "../../../tests/e2e/auth/mock-github";
import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchGitHubUser,
  GitHubSignInError,
  hasStarred,
  randomToken,
  safeReturnTo,
  timingSafeEqual,
} from "./github";

installRealFetch();

const REDIRECT_URI = "http://localhost:3000/api/auth/github/callback";
const REPO = { owner: "acme", name: "gitbanners" };

let mock: MockGitHub;
let restore = () => {};
beforeAll(() => {
  mock = startMockGitHub();
  restore = setEnv({ GITHUB_WEB_URL: mock.url, GITHUB_API_URL: mock.url });
});
afterAll(() => {
  restore();
  mock.stop();
});
beforeEach(() => {
  Object.assign(mock.state, {
    starred: false,
    deny: false,
    checkNeedsScope: false,
    starListTruncated: false,
    repoPrivate: false,
    user: { id: 4242, login: "Octo-Test", name: null },
  });
  mock.requests.length = 0;
});

/** Runs authorize → code against the mock and returns the pieces. */
async function authorize(codeVerifier = randomToken()) {
  const url = await buildAuthorizeUrl({
    clientId: MOCK_CLIENT_ID,
    redirectUri: REDIRECT_URI,
    state: randomToken(),
    codeVerifier,
  });
  const response = await fetch(url, { redirect: "manual" });
  const location = new URL(response.headers.get("location") ?? "");
  return { code: location.searchParams.get("code") ?? "", codeVerifier };
}

async function signIn(): Promise<string> {
  const { code, codeVerifier } = await authorize();
  return exchangeCode({
    clientId: MOCK_CLIENT_ID,
    clientSecret: MOCK_CLIENT_SECRET,
    code,
    codeVerifier,
    redirectUri: REDIRECT_URI,
  });
}

describe("authorize URL", () => {
  test("PKCE S256, state, no scope", async () => {
    const state = randomToken();
    const url = new URL(
      await buildAuthorizeUrl({
        clientId: "client-1",
        redirectUri: REDIRECT_URI,
        state,
        codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      }),
    );
    expect(url.origin + url.pathname).toBe(`${mock.url}/login/oauth/authorize`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-1",
      redirect_uri: REDIRECT_URI,
      state,
      // The RFC 7636 appendix B test vector.
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
      allow_signup: "true",
    });
    // No scope: GitHub then grants read access to public data only.
    expect(url.searchParams.has("scope")).toBe(false);
  });

  test("defaults to github.com, also when the variable is left empty", async () => {
    for (const value of [undefined, ""]) {
      const undo = setEnv({ GITHUB_WEB_URL: value });
      try {
        const url = await buildAuthorizeUrl({
          clientId: "c",
          redirectUri: REDIRECT_URI,
          state: "s",
          codeVerifier: "v",
        });
        expect(
          url.startsWith("https://github.com/login/oauth/authorize?"),
        ).toBe(true);
      } finally {
        undo();
      }
    }
  });

  test("random tokens are 43 URL-safe characters and unique", () => {
    const tokens = new Set(Array.from({ length: 200 }, randomToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("code exchange", () => {
  test("returns the access token and nothing else", async () => {
    const token = await signIn();
    expect(token).toStartWith("gho_mock_");
    expect((await fetchGitHubUser(token)).login).toBe("Octo-Test");
  });

  test("a wrong PKCE verifier is rejected (GitHub answers 200 with an error body)", async () => {
    const { code } = await authorize();
    const attempt = exchangeCode({
      clientId: MOCK_CLIENT_ID,
      clientSecret: MOCK_CLIENT_SECRET,
      code,
      codeVerifier: randomToken(),
      redirectUri: REDIRECT_URI,
    });
    await expect(attempt).rejects.toBeInstanceOf(GitHubSignInError);
    await expect(attempt).rejects.toMatchObject({
      name: "GitHubSignInError",
      code: "bad_verification_code",
    });
  });

  test("a code works once", async () => {
    const { code, codeVerifier } = await authorize();
    const exchange = () =>
      exchangeCode({
        clientId: MOCK_CLIENT_ID,
        clientSecret: MOCK_CLIENT_SECRET,
        code,
        codeVerifier,
        redirectUri: REDIRECT_URI,
      });
    expect(await exchange()).toStartWith("gho_mock_");
    await expect(exchange()).rejects.toMatchObject({
      code: "bad_verification_code",
    });
  });

  test("a different redirect URI or a wrong secret fails", async () => {
    const first = await authorize();
    await expect(
      exchangeCode({
        clientId: MOCK_CLIENT_ID,
        clientSecret: MOCK_CLIENT_SECRET,
        ...first,
        redirectUri: "http://localhost:3000/elsewhere",
      }),
    ).rejects.toMatchObject({ code: "redirect_uri_mismatch" });
    const second = await authorize();
    await expect(
      exchangeCode({
        clientId: MOCK_CLIENT_ID,
        clientSecret: "wrong",
        ...second,
        redirectUri: REDIRECT_URI,
      }),
    ).rejects.toMatchObject({ code: "incorrect_client_credentials" });
  });

  test("error messages never contain the code or the secret", async () => {
    const { code } = await authorize();
    const error = await exchangeCode({
      clientId: MOCK_CLIENT_ID,
      clientSecret: MOCK_CLIENT_SECRET,
      code,
      codeVerifier: "wrong",
      redirectUri: REDIRECT_URI,
    }).catch((caught: Error) => caught);
    expect(String(error)).not.toContain(code);
    expect(String(error)).not.toContain(MOCK_CLIENT_SECRET);
  });

  test("the client secret is never re-sent to where a redirect points", async () => {
    const received: string[] = [];
    const elsewhere = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        received.push(await request.text());
        return Response.json({ access_token: "gho_from_elsewhere" });
      },
    });
    // 307 and 308 make a client repeat the POST, body included.
    for (const status of [307, 308, 302]) {
      const redirecting = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: () =>
          new Response(null, {
            status,
            headers: { Location: `http://127.0.0.1:${elsewhere.port}/steal` },
          }),
      });
      const undo = setEnv({
        GITHUB_WEB_URL: `http://127.0.0.1:${redirecting.port}`,
      });
      try {
        await expect(
          exchangeCode({
            clientId: "c",
            clientSecret: "TOP-SECRET",
            code: "x",
            codeVerifier: "v",
            redirectUri: REDIRECT_URI,
          }),
        ).rejects.toThrow();
      } finally {
        undo();
        redirecting.stop(true);
      }
    }
    elsewhere.stop(true);
    expect(received).toEqual([]);
  });

  test("an unreachable or broken token endpoint is a sign-in error, not a crash", async () => {
    const broken = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request) =>
        new URL(request.url).pathname === "/login/oauth/access_token"
          ? new Response("<html>502</html>", { status: 502 })
          : new Response("not json"),
    });
    const undo = setEnv({ GITHUB_WEB_URL: `http://127.0.0.1:${broken.port}` });
    try {
      await expect(
        exchangeCode({
          clientId: "c",
          clientSecret: "s",
          code: "x",
          codeVerifier: "v",
          redirectUri: REDIRECT_URI,
        }),
      ).rejects.toMatchObject({ code: "token_endpoint_http_error" });
    } finally {
      undo();
      broken.stop(true);
    }
  });
});

describe("fetchGitHubUser", () => {
  test("maps the profile", async () => {
    mock.state.user = { id: 4242, login: "Octo-Test", name: "Octo" };
    expect(await fetchGitHubUser(await signIn())).toEqual({
      id: 4242,
      login: "Octo-Test",
      name: "Octo",
      avatarUrl: "https://avatars.githubusercontent.com/u/4242?v=4",
    });
    mock.state.user = { id: 4242, login: "Octo-Test", name: null };
    expect((await fetchGitHubUser(await signIn())).name).toBeNull();
  });

  test("a dead token is a sign-in error", async () => {
    await expect(fetchGitHubUser("gho_revoked")).rejects.toMatchObject({
      code: "user_fetch_failed",
    });
  });

  test("refuses a profile it cannot use as an account key", async () => {
    const token = await signIn();
    const bad = [
      { id: 0, login: "x" },
      { id: 1.5, login: "x" },
      { id: 4242, login: "" },
      { id: 4242, login: "has space" },
      { id: 4242, login: "a/b" },
      { id: 4242, login: "x".repeat(40) },
    ];
    for (const user of bad) {
      mock.state.user = { ...user, name: null };
      await expect(fetchGitHubUser(token)).rejects.toMatchObject({
        code: "invalid_user_response",
      });
    }
    // Enterprise Managed Users have an underscore; they may sign in.
    mock.state.user = { id: 9, login: "mona_corp", name: null };
    expect((await fetchGitHubUser(token)).login).toBe("mona_corp");
  });

  test("sends a User-Agent and a pinned API version", async () => {
    let seen: Headers | undefined;
    const spy = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        seen = request.headers;
        return Response.json({ id: 1, login: "a", name: null, avatar_url: "" });
      },
    });
    const undo = setEnv({ GITHUB_API_URL: `http://127.0.0.1:${spy.port}` });
    try {
      await fetchGitHubUser("gho_x");
    } finally {
      undo();
      spy.stop(true);
    }
    expect(seen?.get("user-agent")).toBe("gitbanners");
    expect(seen?.get("authorization")).toBe("Bearer gho_x");
    expect(seen?.get("x-github-api-version")).toBe("2022-11-28");
    expect(seen?.get("accept")).toBe("application/vnd.github+json");
  });
});

describe("hasStarred", () => {
  test("204 from the check endpoint is a star; one request", async () => {
    const token = await signIn();
    mock.state.starred = true;
    mock.requests.length = 0;
    expect(await hasStarred(token, REPO)).toBe(true);
    expect(mock.requests).toEqual(["GET /user/starred/acme/gitbanners"]);
  });

  test("404, and not in the complete list: not starred", async () => {
    const token = await signIn();
    mock.requests.length = 0;
    expect(await hasStarred(token, REPO)).toBe(false);
    expect(mock.requests).toEqual([
      "GET /user/starred/acme/gitbanners",
      "GET /repos/acme/gitbanners",
      "GET /user/starred",
    ]);
  });

  test("a private repository the token cannot see: 'unknown', not 'no'", async () => {
    const token = await signIn();
    Object.assign(mock.state, { starred: true, repoPrivate: true });
    mock.state.checkNeedsScope = true;
    expect(await hasStarred(token, REPO)).toBe("unknown");
  });

  test("the check endpoint hides the star (scope): the list still finds it, any casing", async () => {
    const token = await signIn();
    Object.assign(mock.state, { starred: true, checkNeedsScope: true });
    expect(await hasStarred(token, REPO)).toBe(true);
    expect(await hasStarred(token, { owner: "ACME", name: "GitBanners" })).toBe(
      true,
    );
  });

  test("only the star of the right repository counts", async () => {
    const token = await signIn();
    Object.assign(mock.state, { starred: true, checkNeedsScope: true });
    expect(await hasStarred(token, { owner: "acme", name: "other" })).toBe(
      false,
    );
    expect(await hasStarred(token, { owner: "acme", name: "gitbanner" })).toBe(
      false,
    );
  });

  test("a miss on a truncated list proves nothing", async () => {
    const token = await signIn();
    mock.state.starListTruncated = true;
    expect(await hasStarred(token, REPO)).toBe("unknown");
    // A hit on the first page is still a hit.
    Object.assign(mock.state, { starred: true, checkNeedsScope: true });
    expect(await hasStarred(token, REPO)).toBe(true);
  });

  test("a dead token or an unreachable API is 'unknown', never 'no'", async () => {
    expect(await hasStarred("gho_revoked", REPO)).toBe("unknown");
    const undo = setEnv({ GITHUB_API_URL: "http://127.0.0.1:9" });
    try {
      expect(await hasStarred("gho_x", REPO)).toBe("unknown");
    } finally {
      undo();
    }
  });

  test("a list that fails or is not a list is 'unknown'", async () => {
    let listBody: Response = new Response("oops", { status: 500 });
    const flaky = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request) => {
        const { pathname } = new URL(request.url);
        if (pathname === "/user/starred") return listBody.clone();
        if (pathname === "/repos/acme/gitbanners") return Response.json({});
        return Response.json({ message: "Not Found" }, { status: 404 });
      },
    });
    const undo = setEnv({ GITHUB_API_URL: `http://127.0.0.1:${flaky.port}` });
    try {
      expect(await hasStarred("gho_x", REPO)).toBe("unknown");
      listBody = Response.json({ message: "weird" });
      expect(await hasStarred("gho_x", REPO)).toBe("unknown");
      listBody = Response.json([null, { full_name: 7 }, {}]);
      expect(await hasStarred("gho_x", REPO)).toBe(false);
    } finally {
      undo();
      flaky.stop(true);
    }
  });
});

describe("safeReturnTo", () => {
  test("keeps same-origin paths with their query and hash", () => {
    for (const path of [
      "/",
      "/studio",
      "/studio?x=1#y",
      "/vercel/next.js",
      "/@docs",
      "/b/b0123456789a",
      "/apiary",
      "/x?next=//evil.example",
      "/x#//evil.example",
    ]) {
      expect(safeReturnTo(path)).toBe(path);
    }
  });

  test("everything that is not a plain path collapses to /", () => {
    for (const value of [
      null,
      undefined,
      "",
      "studio",
      "https://evil.example",
      "https://evil.example/phish",
      "//evil.example",
      "///evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "javascript:alert(1)",
      "data:text/html,x",
      " /studio",
    ]) {
      expect(safeReturnTo(value)).toBe("/");
    }
  });

  test("paths that only become another host after normalisation", () => {
    // Each of these starts with one slash but normalises to "//evil.example",
    // which a browser reads as a protocol-relative URL.
    for (const value of [
      "/.//evil.example",
      "/..//evil.example",
      "/a/..//evil.example",
      "/%2e//evil.example",
      "/%2E%2E//evil.example",
      "/./\\evil.example",
      "/.\\/evil.example",
      "/a/../\\evil.example",
    ]) {
      expect(safeReturnTo(value)).toBe("/");
    }
  });

  test("never returns something a browser would resolve off-site", () => {
    const inputs = [
      "/.//evil.example",
      "/x/..//evil.example/path?q=1",
      "/\\/evil.example",
      "//evil.example",
      "/ok/../fine",
      "/%2F%2Fevil.example",
      "/;//evil.example",
    ];
    for (const input of inputs) {
      const output = safeReturnTo(input);
      expect(output.startsWith("/")).toBe(true);
      expect(output.startsWith("//")).toBe(false);
      expect(new URL(output, "https://gitbanners.example").origin).toBe(
        "https://gitbanners.example",
      );
    }
  });

  test("API routes are not pages to return to", () => {
    for (const value of [
      "/api",
      "/api/auth/github",
      "/api/auth/github?returnTo=/api/auth/github",
      "/API/auth/signout",
      "/x/../api/auth/github",
      "/%61pi/auth/github",
      "/api/me",
    ]) {
      expect(safeReturnTo(value)).toBe("/");
    }
  });

  test("long studio URLs survive, absurdly long ones do not", () => {
    const studio = `/studio/vercel/next.js?${"a".repeat(2000)}`;
    expect(safeReturnTo(studio)).toBe(studio);
    expect(safeReturnTo(`/x?${"a".repeat(2557)}`).length).toBe(2560);
    expect(safeReturnTo(`/x?${"a".repeat(2558)}`)).toBe("/");
    // The limit applies to what will be stored, after percent-encoding.
    expect(safeReturnTo(`/${"é".repeat(500)}`)).toBe("/");
  });

  test("the result is stable when validated again", () => {
    for (const value of ["/studio?x=1#y", "/a/./b/../c", "/sp ace", "/ü"]) {
      const once = safeReturnTo(value);
      expect(safeReturnTo(once)).toBe(once);
    }
  });
});

test("timingSafeEqual", () => {
  expect(timingSafeEqual("abc", "abc")).toBe(true);
  expect(timingSafeEqual("abc", "abd")).toBe(false);
  expect(timingSafeEqual("abc", "abcd")).toBe(false);
  expect(timingSafeEqual("", "")).toBe(true);
  expect(timingSafeEqual("é", "e")).toBe(false);
});
