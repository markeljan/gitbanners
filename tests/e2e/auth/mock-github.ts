/**
 * Local stand-in for github.com and api.github.com: the sign-in web flow with
 * PKCE, `GET /user` and the two star endpoints. Used in-process by unit tests
 * and as a separate process by the HTTP suite.
 *
 * Point the app at it with `GITHUB_WEB_URL` and `GITHUB_API_URL`.
 *
 * Standalone:  bun tests/e2e/auth/mock-github.ts [port]
 * Control:     POST /__control  {"starred": true, "deny": false, …}
 *              answers with the current state and the request log;
 *              {"clearRequests": true} empties the log.
 */
import { createHash } from "node:crypto";

/** Everything a test can change about how the mock answers. */
export interface MockGitHubState {
  /** Whether the mock user starred `starRepo`. */
  starred: boolean;
  /** The user declines on the consent screen. */
  deny: boolean;
  /**
   * The check endpoint hides the star, as GitHub does (with a 404) when a
   * token lacks the scope an endpoint wants.
   */
  checkNeedsScope: boolean;
  /** The star list claims to have another page. */
  starListTruncated: boolean;
  /** Repository the mock user may have starred, in GitHub's own casing. */
  starRepo: string;
  user: { id: number; login: string; name: string | null };
}

/** A running mock. Mutate `state` directly when it runs in-process. */
export interface MockGitHub {
  url: string;
  state: MockGitHubState;
  /** "METHOD /path" of every request, oldest first. */
  requests: string[];
  stop(): void;
}

/** What the stub `gh` binary of the HTTP suite prints for `gh auth token`. */
export const STUB_CLI_TOKEN = "gho_stub_from_fake_gh_cli";
/** The only app credentials the mock's token endpoint accepts. */
export const MOCK_CLIENT_ID = "mock_client";
export const MOCK_CLIENT_SECRET = "mock_secret";

const s256 = (value: string) =>
  createHash("sha256").update(value).digest("base64url");

/** Starts the mock on `port` (0 picks a free one) on the loopback interface. */
export function startMockGitHub(port = 0): MockGitHub {
  const state: MockGitHubState = {
    starred: false,
    deny: false,
    checkNeedsScope: false,
    starListTruncated: false,
    starRepo: "Acme/GitBanners",
    user: { id: 4242, login: "Octo-Test", name: null },
  };
  const requests: string[] = [];
  const codes = new Map<
    string,
    { challenge: string; redirectUri: string; clientId: string }
  >();
  const tokens = new Set<string>();
  let tokenSequence = 0;

  function authorize(url: URL): Response {
    const query = url.searchParams;
    const redirectUri = query.get("redirect_uri");
    const requestState = query.get("state");
    const clientId = query.get("client_id");
    const challenge = query.get("code_challenge") ?? "";
    if (!clientId || !redirectUri || !requestState) {
      return new Response("bad authorize request", { status: 400 });
    }
    if (
      query.get("code_challenge_method") !== "S256" ||
      challenge.length !== 43
    ) {
      return new Response("PKCE S256 challenge (43 chars) required", {
        status: 400,
      });
    }
    const back = new URL(redirectUri);
    back.searchParams.set("state", requestState);
    if (state.deny) {
      back.searchParams.set("error", "access_denied");
      back.searchParams.set(
        "error_description",
        "The user has denied your application access.",
      );
    } else {
      const code = crypto.randomUUID().replaceAll("-", "").slice(0, 20);
      codes.set(code, { challenge, redirectUri, clientId });
      back.searchParams.set("code", code);
    }
    return Response.redirect(back.toString(), 302);
  }

  async function accessToken(request: Request): Promise<Response> {
    const body = new URLSearchParams(await request.text());
    // GitHub answers 200 with an error body.
    const fail = (error: string) =>
      Response.json({
        error,
        error_description: error,
        error_uri: "https://docs.github.com",
      });
    if (request.headers.get("accept") !== "application/json") {
      return new Response("access_token=form&encoded=1");
    }
    if (body.get("client_secret") !== MOCK_CLIENT_SECRET) {
      return fail("incorrect_client_credentials");
    }
    const code = body.get("code") ?? "";
    const entry = codes.get(code);
    // Single use, like the real thing.
    codes.delete(code);
    if (!entry || entry.clientId !== body.get("client_id")) {
      return fail("bad_verification_code");
    }
    if (entry.redirectUri !== body.get("redirect_uri")) {
      return fail("redirect_uri_mismatch");
    }
    if (s256(body.get("code_verifier") ?? "") !== entry.challenge) {
      return fail("bad_verification_code");
    }
    const token = `gho_mock_${++tokenSequence}_${crypto.randomUUID().slice(0, 8)}`;
    tokens.add(token);
    // No scope was requested, so none is granted.
    return Response.json({
      access_token: token,
      token_type: "bearer",
      scope: "",
    });
  }

  function api(request: Request, url: URL): Response {
    if (!request.headers.get("user-agent")) {
      return new Response(
        "Request forbidden by administrative rules (missing User-Agent)",
        { status: 403 },
      );
    }
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    if (!tokens.has(token) && token !== STUB_CLI_TOKEN) {
      return Response.json({ message: "Bad credentials" }, { status: 401 });
    }
    if (url.pathname === "/user") {
      return Response.json({
        ...state.user,
        avatar_url: `https://avatars.githubusercontent.com/u/${state.user.id}?v=4`,
        type: "User",
      });
    }
    const check = "/user/starred/";
    if (url.pathname.startsWith(check)) {
      const repo = url.pathname.slice(check.length).toLowerCase();
      const visible = state.starred && !state.checkNeedsScope;
      return visible && repo === state.starRepo.toLowerCase()
        ? new Response(null, { status: 204 })
        : Response.json({ message: "Not Found" }, { status: 404 });
    }
    if (url.pathname === "/user/starred") {
      const other = { id: 7, full_name: "vercel/next.js", private: false };
      const starred = { id: 1, full_name: state.starRepo, private: false };
      return Response.json(state.starred ? [starred, other] : [other], {
        headers: state.starListTruncated
          ? { Link: `<${url.origin}/user/starred?page=2>; rel="next"` }
          : {},
      });
    }
    return Response.json({ message: "Not Found" }, { status: 404 });
  }

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/__control") {
        if (request.method === "POST") {
          const { clearRequests, ...patch } = (await request.json()) as Partial<
            MockGitHubState & { clearRequests: boolean }
          >;
          Object.assign(state, patch);
          if (clearRequests) requests.length = 0;
        }
        return Response.json({ ...state, requests });
      }
      requests.push(`${request.method} ${url.pathname}`);
      if (url.pathname === "/login/oauth/authorize") return authorize(url);
      if (
        url.pathname === "/login/oauth/access_token" &&
        request.method === "POST"
      ) {
        return accessToken(request);
      }
      return api(request, url);
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    state,
    requests,
    stop() {
      server.stop(true);
    },
  };
}

if (import.meta.main) {
  const mock = startMockGitHub(Number(process.argv[2] ?? 4010));
  console.info(`mock GitHub on ${mock.url}`);
}
