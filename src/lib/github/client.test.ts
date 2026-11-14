import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test";
import {
  type FakeGitHub,
  fakeGitHub,
  fixture,
  htmlTimeout,
  json,
} from "./__fixtures__/mock";
import {
  getServerToken,
  graphql,
  hasGitHubToken,
  isLocalRefusal,
  lastPage,
  REQUEST_TIMEOUT_MS,
  rest,
  withDeadline,
} from "./client";
import { GitHubError, isGitHubError, isTransient } from "./errors";

interface RecordedError {
  case: string;
  httpStatus: number;
  response: unknown;
}

const recorded = fixture("errors.graphql.json") as RecordedError[];

/** A recorded error response as GitHub sent it (JSON, or the HTML page as text). */
function recordedResponse(
  name: string,
  headers: Record<string, string> = {},
): Response {
  const entry = recorded.find((candidate) => candidate.case.startsWith(name));
  if (!entry) throw new Error(`no recorded error case "${name}"`);
  if (typeof entry.response === "string") {
    return new Response(entry.response, {
      status: entry.httpStatus,
      headers: { "content-type": "text/html", ...headers },
    });
  }
  return json(entry.response, { status: entry.httpStatus, headers });
}

let fake: FakeGitHub | undefined;
let tokens = 0;
/** Differs per evaluation of this file: the client's memory outlives it. */
const run = crypto.randomUUID().slice(0, 8);
/**
 * A token no other test has used: a rate limit seen for one credential makes
 * the client refuse further requests with it, on purpose.
 */
const freshToken = () => `test-token-${run}-${++tokens}`;

function serve(reply: Response | object): FakeGitHub {
  fake = fakeGitHub({ graphql: { Q: reply }, rest: [[/.*/, reply]] });
  return fake;
}

async function failure(run: Promise<unknown>): Promise<GitHubError> {
  try {
    await run;
  } catch (error) {
    if (error instanceof GitHubError) return error;
    throw error;
  }
  throw new Error("expected the request to fail");
}

const QUERY = "query Q { viewer { login } }";

beforeEach(() => {
  // Whatever the environment running the tests has set must not leak in.
  delete process.env.GITHUB_TOKEN;
});

afterEach(() => {
  fake?.restore();
  fake = undefined;
  setSystemTime();
  delete process.env.GITHUB_TOKEN;
});

describe("request", () => {
  test("GraphQL: POST with auth, UTC, API version and user agent", async () => {
    const github = serve({ data: { viewer: { login: "octocat" } } });
    const token = freshToken();
    const result = await graphql(QUERY, { login: "octocat" }, { token });

    expect(result).toEqual({
      data: { viewer: { login: "octocat" } },
      errors: [],
    });
    const [call] = github.calls;
    expect(call?.url.href).toBe("https://api.github.com/graphql");
    expect(call?.method).toBe("POST");
    expect(call?.headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(call?.headers.get("time-zone")).toBe("UTC");
    expect(call?.headers.get("x-github-api-version")).toBe("2026-03-10");
    expect(call?.headers.get("user-agent")).toBe("gitbanners");
    expect(call?.headers.get("content-type")).toBe("application/json");
    expect(call?.operation).toBe("Q");
    expect(call?.variables).toEqual({ login: "octocat" });
    expect(call?.signal).toBeInstanceOf(AbortSignal);
  });

  test("REST: GET with the same headers, Link header passed through", async () => {
    const link =
      '<https://api.github.com/repositories/1/contributors?per_page=1&page=2>; rel="next", <https://api.github.com/repositories/1/contributors?per_page=1&page=420>; rel="last"';
    const github = serve(json([{ login: "a" }], { headers: { link } }));
    const token = freshToken();
    const result = await rest("/repos/o/r/contributors?per_page=1", { token });

    expect(result).toEqual({ status: 200, data: [{ login: "a" }], link });
    expect(lastPage(result.link)).toBe(420);
    const [call] = github.calls;
    expect(call?.url.href).toBe(
      "https://api.github.com/repos/o/r/contributors?per_page=1",
    );
    expect(call?.method).toBe("GET");
    expect(call?.headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(call?.headers.get("time-zone")).toBe("UTC");
    expect(call?.headers.get("x-github-api-version")).toBe("2026-03-10");
    expect(call?.headers.get("user-agent")).toBe("gitbanners");
  });

  test("the server token is the default, a per-request token overrides it", async () => {
    const github = serve({ data: { ok: true } });
    process.env.GITHUB_TOKEN = "server-token";
    await graphql(QUERY, {});
    await graphql(QUERY, {}, { token: "user-token" });
    await rest("/x");
    await rest("/x", { token: "user-token" });
    expect(
      github.calls.map((call) => call.headers.get("authorization")),
    ).toEqual([
      "Bearer server-token",
      "Bearer user-token",
      "Bearer server-token",
      "Bearer user-token",
    ]);
  });

  test("without any token: GraphQL refuses locally, REST goes out anonymous", async () => {
    const github = serve({ ok: true });
    const error = await failure(graphql(QUERY, {}));
    expect(error.code).toBe("unavailable");
    expect(github.calls).toHaveLength(0);

    await rest("/users/torvalds");
    expect(github.calls).toHaveLength(1);
    expect(github.calls[0]?.headers.has("authorization")).toBe(false);
  });

  test("REST paths cannot point at another origin", async () => {
    const github = serve({});
    for (const path of [
      "https://evil.example/x",
      "//evil.example/x",
      "users/x",
    ]) {
      expect((await failure(rest(path, { token: freshToken() }))).code).toBe(
        "invalid",
      );
    }
    expect(github.calls).toHaveLength(0);
  });
});

describe("token resolution", () => {
  test("GITHUB_TOKEN, trimmed", () => {
    process.env.GITHUB_TOKEN = "  from-env \n";
    expect(getServerToken()).toBe("from-env");
    expect(hasGitHubToken()).toBe(true);
  });

  test("tests never fall back to the GitHub CLI", () => {
    expect(process.env.NODE_ENV).toBe("test");
    delete process.env.GITHUB_TOKEN;
    expect(getServerToken()).toBeNull();
    process.env.GITHUB_TOKEN = "   ";
    expect(getServerToken()).toBeNull();
    expect(hasGitHubToken()).toBe(false);
  });
});

describe("GraphQL errors (recorded responses)", () => {
  test.each([
    ["user NOT_FOUND", { user: null }],
    ["organization() on a user login", { organization: null }],
    ["repository NOT_FOUND", { repository: null }],
    ["repositoryOwner bot login", { repositoryOwner: null }],
  ])("%s is data, not an exception", async (name, data) => {
    serve(recordedResponse(name));
    const result = await graphql(QUERY, {}, { token: freshToken() });
    expect(result.data).toEqual(data);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.type).toBe("NOT_FOUND");
  });

  test("an unknown repositoryOwner is null without any error", async () => {
    serve(recordedResponse("repositoryOwner unknown login"));
    const result = await graphql(QUERY, {}, { token: freshToken() });
    expect(result).toEqual({ data: { repositoryOwner: null }, errors: [] });
  });

  test("partial success keeps the data and reports the errors", async () => {
    serve(recordedResponse("partial success"));
    const result = await graphql<{ a: { login: string }; b: null }>(
      QUERY,
      {},
      { token: freshToken() },
    );
    expect(result.data.a.login).toBe("torvalds");
    expect(result.data.b).toBeNull();
    expect(result.errors).toEqual([
      {
        type: "NOT_FOUND",
        message:
          "Could not resolve to a User with the login of 'this-user-does-not-exist-zz9'.",
        path: ["b"],
      },
    ]);
  });

  test.each([
    ["syntax error", "invalid", 400],
    ["undefined field", "invalid", 400],
    ["MAX_NODE_LIMIT_EXCEEDED", "invalid", 400],
    ["INSUFFICIENT_SCOPES", "forbidden", 403],
  ] as const)("%s (no data) -> %s", async (name, code, status) => {
    serve(recordedResponse(name));
    const error = await failure(graphql(QUERY, {}, { token: freshToken() }));
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    expect(error.retryAfter).toBeNull();
  });

  test.each([["EXCESSIVE_PAGINATION"], ["contributions span > 1 year"]])(
    "%s nulls the root but is not a 'not found'",
    async (name) => {
      serve(recordedResponse(name));
      const error = await failure(graphql(QUERY, {}, { token: freshToken() }));
      expect(error.code).toBe("invalid");
    },
  );

  test("a nested field error leaves the response usable", async () => {
    serve({
      data: { user: { pinnedItems: { nodes: [{ name: "a" }, null] } } },
      errors: [
        {
          type: "FORBIDDEN",
          path: ["user", "pinnedItems", "nodes", 1],
          message: "Resource protected by organization SAML enforcement.",
        },
      ],
    });
    const result = await graphql(QUERY, {}, { token: freshToken() });
    expect(result.errors[0]?.type).toBe("FORBIDDEN");
    expect(result.data).toEqual({
      user: { pinnedItems: { nodes: [{ name: "a" }, null] } },
    });
  });

  test("a root nulled by a non-NOT_FOUND error throws even next to a real miss", async () => {
    serve({
      data: { user: null, other: null },
      errors: [
        { type: "NOT_FOUND", path: ["other"], message: "missing" },
        { type: "FORBIDDEN", path: ["user"], message: "no access" },
      ],
    });
    const error = await failure(graphql(QUERY, {}, { token: freshToken() }));
    expect(error.code).toBe("forbidden");
  });

  test("GitHub's untyped internal error is unavailable, not invalid", async () => {
    serve({
      data: null,
      errors: [
        {
          message:
            "Something went wrong while executing your query. This may be the result of a timeout, or it could be a GitHub bug.",
        },
      ],
    });
    const error = await failure(graphql(QUERY, {}, { token: freshToken() }));
    expect(error.code).toBe("unavailable");
    expect(isTransient(error)).toBe(true);
  });

  test.each([
    [{ message: "no data, no errors" }],
    [{ data: null }],
    [[1, 2, 3]],
  ])(
    "a body that is not a GraphQL envelope is unavailable: %j",
    async (body) => {
      serve(json(body));
      const error = await failure(graphql(QUERY, {}, { token: freshToken() }));
      expect(error.code).toBe("unavailable");
      expect(error.status).toBe(502);
    },
  );
});

describe("rate limits", () => {
  const NOW = new Date("2026-11-13T04:00:00Z");
  const resetIn = (seconds: number) =>
    String(Math.floor(NOW.getTime() / 1000) + seconds);

  test("primary, GraphQL: HTTP 200 with a RATE_LIMITED error", async () => {
    setSystemTime(NOW);
    serve(
      json(
        {
          errors: [
            {
              type: "RATE_LIMITED",
              message: "API rate limit exceeded for user ID 1.",
            },
          ],
        },
        {
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": resetIn(1234),
          },
        },
      ),
    );
    const error = await failure(graphql(QUERY, {}, { token: freshToken() }));
    expect(error.code).toBe("rate_limited");
    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe(1234);
    expect(isTransient(error)).toBe(true);
  });

  test("primary, recorded: unauthenticated GraphQL is a 403 with remaining 0", async () => {
    setSystemTime(NOW);
    serve(
      recordedResponse("unauthenticated GraphQL", {
        "x-ratelimit-limit": "0",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": resetIn(90),
      }),
    );
    const error = await failure(graphql(QUERY, {}, { token: freshToken() }));
    expect(error.code).toBe("rate_limited");
    expect(error.retryAfter).toBe(90);
    // The message names the limit even when the headers are missing.
    serve(recordedResponse("unauthenticated GraphQL"));
    const bare = await failure(graphql(QUERY, {}, { token: freshToken() }));
    expect(bare.code).toBe("rate_limited");
    expect(bare.retryAfter).toBeNull();
  });

  test("primary, REST: 403 or 429 with remaining 0", async () => {
    setSystemTime(NOW);
    for (const status of [403, 429]) {
      serve(
        json(
          { message: "API rate limit exceeded for user ID 1." },
          {
            status,
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": resetIn(600),
            },
          },
        ),
      );
      const error = await failure(rest("/x", { token: freshToken() }));
      expect(error.code).toBe("rate_limited");
      expect(error.retryAfter).toBe(600);
    }
  });

  test("secondary: retry-after wins, a bare message backs off a minute", async () => {
    serve(
      json(
        { message: "You have exceeded a secondary rate limit." },
        { status: 403, headers: { "retry-after": "30" } },
      ),
    );
    const timed = await failure(rest("/x", { token: freshToken() }));
    expect(timed.code).toBe("rate_limited");
    expect(timed.retryAfter).toBe(30);

    serve(
      json(
        {
          message:
            "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
        },
        { status: 403 },
      ),
    );
    const untimed = await failure(graphql(QUERY, {}, { token: freshToken() }));
    expect(untimed.code).toBe("rate_limited");
    expect(untimed.retryAfter).toBe(60);

    serve(new Response("Too many requests", { status: 429 }));
    const plain = await failure(rest("/x", { token: freshToken() }));
    expect(plain.code).toBe("rate_limited");
    expect(plain.retryAfter).toBe(60);
  });

  test("secondary, GraphQL: HTTP 200 whose error message says so", async () => {
    serve({
      errors: [{ message: "You have exceeded a secondary rate limit." }],
    });
    const error = await failure(graphql(QUERY, {}, { token: freshToken() }));
    expect(error.code).toBe("rate_limited");
    expect(error.retryAfter).toBe(60);
  });

  test("a 403 that is not a rate limit is forbidden", async () => {
    serve(
      json(
        {
          message:
            "The history or contributor list is too large to list contributors for this repository via the API.",
        },
        { status: 403, headers: { "x-ratelimit-remaining": "4821" } },
      ),
    );
    const error = await failure(rest("/x", { token: freshToken() }));
    expect(error.code).toBe("forbidden");
    expect(error.status).toBe(403);
    expect(isTransient(error)).toBe(false);
  });

  test("once limited, the client stops asking until the limit resets", async () => {
    setSystemTime(NOW);
    const token = freshToken();
    const other = freshToken();
    const github = serve(
      json(
        { message: "You have exceeded a secondary rate limit." },
        { status: 403, headers: { "retry-after": "120" } },
      ),
    );
    const announced = await failure(graphql(QUERY, {}, { token }));
    expect(github.calls).toHaveLength(1);
    expect(isLocalRefusal(announced)).toBe(false);

    setSystemTime(new Date(NOW.getTime() + 30_000));
    const blocked = await failure(graphql(QUERY, {}, { token }));
    expect(blocked.code).toBe("rate_limited");
    expect(blocked.retryAfter).toBe(90);
    expect(github.calls).toHaveLength(1);
    // Told apart from GitHub's own answer, so that it is not logged again.
    expect(isLocalRefusal(blocked)).toBe(true);

    // REST has its own budget, and so has every other credential.
    github.restore();
    const healthy = serve({ data: { ok: true } });
    await rest("/x", { token });
    await graphql(QUERY, {}, { token: other });
    expect(healthy.calls).toHaveLength(2);
    await failure(graphql(QUERY, {}, { token }));
    expect(healthy.calls).toHaveLength(2);

    setSystemTime(new Date(NOW.getTime() + 121_000));
    await graphql(QUERY, {}, { token });
    expect(healthy.calls).toHaveLength(3);
  });
});

describe("HTTP failures", () => {
  test("recorded: bad credentials -> forbidden (401)", async () => {
    serve(recordedResponse("bad credentials"));
    const error = await failure(graphql(QUERY, {}, { token: freshToken() }));
    expect(error.code).toBe("forbidden");
    expect(error.status).toBe(401);
    expect(error.message).toContain("Bad credentials");
  });

  test("recorded: GitHub's own timeout is an HTML 502 -> unavailable", async () => {
    serve(recordedResponse("timeout"));
    const error = await failure(graphql(QUERY, {}, { token: freshToken() }));
    expect(error.code).toBe("unavailable");
    expect(error.status).toBe(502);
    expect(error.message).not.toContain("<html>");
    expect(isTransient(error)).toBe(true);
  });

  test("HTML is never parsed as data, whatever the status", async () => {
    serve(htmlTimeout(504));
    expect((await failure(rest("/x", { token: freshToken() }))).status).toBe(
      504,
    );

    serve(new Response("<html>maintenance</html>", { status: 200 }));
    const ok = await failure(graphql(QUERY, {}, { token: freshToken() }));
    expect(ok.code).toBe("unavailable");
    expect(ok.status).toBe(502);

    serve(new Response("not json at all", { status: 200 }));
    expect((await failure(rest("/x", { token: freshToken() }))).code).toBe(
      "unavailable",
    );
  });

  test("5xx is unavailable, other 4xx invalid", async () => {
    serve(json({ message: "Server Error" }, { status: 500 }));
    const server = await failure(rest("/x", { token: freshToken() }));
    expect(server.code).toBe("unavailable");
    expect(server.status).toBe(500);

    serve(json({ message: "Validation Failed" }, { status: 422 }));
    const client = await failure(rest("/x", { token: freshToken() }));
    expect(client.code).toBe("invalid");
    expect(client.status).toBe(422);
  });

  test("classification never depends on statusText", async () => {
    // HTTP/2 responses carry no reason phrase; undici reports "".
    serve(
      new Response(JSON.stringify({ message: "Bad credentials" }), {
        status: 401,
        statusText: "",
      }),
    );
    expect((await failure(rest("/x", { token: freshToken() }))).code).toBe(
      "forbidden",
    );
  });

  test("REST: 202, 204 and 404 are results", async () => {
    serve(json({}, { status: 202 }));
    expect(await rest("/x", { token: freshToken() })).toEqual({
      status: 202,
      data: null,
      link: null,
    });
    serve(new Response(null, { status: 204 }));
    expect((await rest("/x", { token: freshToken() })).status).toBe(204);
    serve(json({ message: "Not Found" }, { status: 404 }));
    expect(await rest("/x", { token: freshToken() })).toEqual({
      status: 404,
      data: null,
      link: null,
    });
  });
});

describe("deadline and network", () => {
  /** A server that never answers: like `fetch`, it only settles on abort. */
  const hanging: typeof fetch = Object.assign(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) reject(signal.reason);
        signal?.addEventListener("abort", () => reject(signal.reason));
      }),
    { preconnect: globalThis.fetch.preconnect },
  );

  test("the default deadline sits just under GitHub's 10 s limit", () => {
    expect(REQUEST_TIMEOUT_MS).toBe(9_500);
  });

  test("a request that never answers times out as unavailable (504)", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = hanging;
    try {
      const started = Date.now();
      const error = await failure(
        graphql(QUERY, {}, { token: freshToken(), timeoutMs: 25 }),
      );
      expect(error.code).toBe("unavailable");
      expect(error.status).toBe(504);
      expect(error.message).toContain("25 ms");
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("the caller's signal aborts the request", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = hanging;
    try {
      const controller = new AbortController();
      const pending = failure(
        rest("/x", { token: freshToken(), signal: controller.signal }),
      );
      controller.abort();
      const error = await pending;
      expect(error.code).toBe("unavailable");
      expect(error.status).toBe(503);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("one deadline can bound several requests", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = hanging;
    try {
      const budget = withDeadline(undefined, 25);
      const errors = await Promise.all([
        failure(graphql(QUERY, {}, { token: freshToken(), signal: budget })),
        failure(rest("/x", { token: freshToken(), signal: budget })),
      ]);
      for (const error of errors) {
        expect(error.code).toBe("unavailable");
        expect(error.status).toBe(504);
        expect(error.message).toContain("time budget");
      }
      // Already spent: a request that starts now fails at once.
      const late = await failure(
        rest("/x", { token: freshToken(), signal: budget }),
      );
      expect(late.status).toBe(504);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("withDeadline also follows the caller's signal", () => {
    const controller = new AbortController();
    const signal = withDeadline(controller.signal, 60_000);
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  test("a network failure is unavailable and keeps its cause", async () => {
    const original = globalThis.fetch;
    const cause = new TypeError("fetch failed");
    globalThis.fetch = Object.assign(() => Promise.reject(cause), {
      preconnect: original.preconnect,
    });
    try {
      const error = await failure(graphql(QUERY, {}, { token: freshToken() }));
      expect(error.code).toBe("unavailable");
      expect(error.cause).toBe(cause);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("GitHubError", () => {
  test("defaults per code", () => {
    expect(new GitHubError("rate_limited", "x").status).toBe(429);
    expect(new GitHubError("unavailable", "x").status).toBe(503);
    expect(new GitHubError("forbidden", "x").status).toBe(403);
    expect(new GitHubError("invalid", "x").status).toBe(400);
    const error = new GitHubError("rate_limited", "slow down", {
      status: 403,
      retryAfter: 7,
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("GitHubError");
    expect(error.message).toBe("slow down");
    expect(error.status).toBe(403);
    expect(error.retryAfter).toBe(7);
  });

  test("is recognised across module copies, by shape", () => {
    const foreign = Object.assign(new Error("from another bundle"), {
      name: "GitHubError",
      code: "unavailable",
      status: 503,
      retryAfter: null,
    });
    expect(isGitHubError(foreign)).toBe(true);
    expect(isTransient(foreign)).toBe(true);
    expect(isGitHubError(new Error("plain"))).toBe(false);
    expect(isGitHubError({ name: "GitHubError", code: "invalid" })).toBe(false);
    expect(isTransient(new GitHubError("forbidden", "x"))).toBe(false);
    expect(isTransient(new GitHubError("invalid", "x"))).toBe(false);
  });
});

describe("lastPage", () => {
  test("reads the last page from real Link headers", () => {
    expect(
      lastPage(
        '<https://api.github.com/repositories/70107786/contributors?per_page=40&page=2>; rel="next", <https://api.github.com/repositories/70107786/contributors?per_page=40&page=11>; rel="last"',
      ),
    ).toBe(11);
    expect(
      lastPage(
        '<https://api.github.com/repositories/70107786/stargazers/history?page=2>; rel="next", <https://api.github.com/repositories/70107786/stargazers/history?page=18>; rel="last"',
      ),
    ).toBe(18);
    expect(
      lastPage('<https://api.github.com/x?page=2>; rel="next"'),
    ).toBeNull();
    expect(lastPage(null)).toBeNull();
  });
});
