/**
 * GitHub sign-in: the web application flow (authorization code + PKCE S256),
 * hand-rolled on `fetch`. No Next.js imports, so it is unit-testable against a
 * local mock.
 *
 * The access token is used for two things only, both during the callback
 * request: reading the user's identity and checking whether they starred the
 * repository. It is never stored, and no scope is requested, so GitHub shows
 * "Limited access to your public data".
 */

// Overridable so tests can point at a local mock. `||`, not `??`: a variable
// left empty in an env file must mean "default", not "no host".
const webOrigin = () => process.env.GITHUB_WEB_URL || "https://github.com";
const apiOrigin = () => process.env.GITHUB_API_URL || "https://api.github.com";

const GITHUB_API_VERSION = "2022-11-28";
const USER_AGENT = "gitbanners";
// Per request. The callback makes up to four of them in a row and has to fit
// the 30 seconds a function may run, together with the stargazer lookup.
const TIMEOUT_MS = 5000;
// Includes "_" on purpose: Enterprise Managed Users are `handle_shortcode`.
const SIGN_IN_LOGIN_RE = /^[\w-]{1,39}$/;

const base64url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64url");

/**
 * 32 random bytes as 43 base64url characters. Used for `state` and the PKCE
 * verifier.
 */
export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function s256(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  return base64url(new Uint8Array(digest));
}

/**
 * Where to send the browser. No `scope` parameter: identity and the star
 * check work without one.
 */
export async function buildAuthorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeVerifier: string;
}): Promise<string> {
  const url = new URL("/login/oauth/authorize", webOrigin());
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("state", options.state);
  url.searchParams.set("code_challenge", await s256(options.codeVerifier));
  // GitHub rejects "plain".
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("allow_signup", "true");
  return url.toString();
}

/**
 * A failed step of the sign-in flow. `code` is GitHub's own error code where
 * there is one (`bad_verification_code`, `redirect_uri_mismatch`, …) and is
 * safe to log; the message never contains the code or the token.
 */
export class GitHubSignInError extends Error {
  constructor(
    readonly code: string,
    description?: string,
  ) {
    super(description ? `${code}: ${description}` : code);
    this.name = "GitHubSignInError";
  }
}

/**
 * Trades the authorization code for an access token. The caller keeps the
 * token in memory for the rest of the request and then drops it; a refresh
 * token, if GitHub sends one, is ignored.
 */
export async function exchangeCode(options: {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<string> {
  const response = await fetch(
    new URL("/login/oauth/access_token", webOrigin()),
    {
      method: "POST",
      headers: {
        // Required: the default response is form-encoded.
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: new URLSearchParams({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        code: options.code,
        redirect_uri: options.redirectUri,
        code_verifier: options.codeVerifier,
      }),
      cache: "no-store",
      // The body carries the client secret: it is sent to this one URL and
      // never re-sent to wherever a redirect might point.
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new GitHubSignInError(
      "token_endpoint_http_error",
      String(response.status),
    );
  }
  // GitHub answers 200 even on failure: { error, error_description, error_uri
  // }.
  const data: unknown = await response.json().catch(() => null);
  if (typeof data !== "object" || data === null) {
    throw new GitHubSignInError("invalid_token_response");
  }
  const body = data as Record<string, unknown>;
  if (typeof body.error === "string") {
    throw new GitHubSignInError(
      body.error,
      typeof body.error_description === "string"
        ? body.error_description
        : undefined,
    );
  }
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new GitHubSignInError("invalid_token_response");
  }
  return body.access_token;
}

/** The part of `GET /user` an account is built from. */
export interface GitHubUser {
  /** Numeric and immutable: the account key. Logins can change hands. */
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
}

function apiHeaders(accessToken: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    // api.github.com rejects requests without a User-Agent.
    "User-Agent": USER_AGENT,
  };
}

function apiGet(path: string, accessToken: string): Promise<Response> {
  return fetch(new URL(path, apiOrigin()), {
    headers: apiHeaders(accessToken),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** `GET /user`: who the token belongs to. Works without any scope. */
export async function fetchGitHubUser(
  accessToken: string,
): Promise<GitHubUser> {
  const response = await apiGet("/user", accessToken);
  if (!response.ok) {
    throw new GitHubSignInError("user_fetch_failed", String(response.status));
  }
  const data: unknown = await response.json().catch(() => null);
  const user = (data ?? {}) as Record<string, unknown>;
  if (
    typeof user.id !== "number" ||
    !Number.isSafeInteger(user.id) ||
    user.id <= 0 ||
    typeof user.login !== "string" ||
    !SIGN_IN_LOGIN_RE.test(user.login)
  ) {
    throw new GitHubSignInError("invalid_user_response");
  }
  return {
    id: user.id,
    login: user.login,
    name: typeof user.name === "string" && user.name ? user.name : null,
    avatarUrl:
      typeof user.avatar_url === "string" &&
      user.avatar_url.startsWith("https://")
        ? user.avatar_url
        : "",
  };
}

/**
 * Whether the token's owner starred `repo`. `"unknown"` means GitHub could not
 * be asked or the answer is inconclusive; callers keep the last known state.
 *
 *  1. `GET /user/starred/{owner}/{repo}`: 204 is a star. A 404 is "not
 *     starred" or "this token may not see it": the endpoint advertises
 *     `X-Accepted-OAuth-Scopes: public_repo, repo`, and GitHub answers 404
 *     rather than 403 when a scope is missing.
 *  2. So on 404 the newest 100 stars are scanned too. `GET /user/starred`
 *     needs no scope and a fresh star is always first. A miss only counts as
 *     "not starred" when that page was the whole list.
 */
export async function hasStarred(
  accessToken: string,
  repo: { owner: string; name: string },
): Promise<boolean | "unknown"> {
  const slug = `${repo.owner}/${repo.name}`;
  const check = await apiGet(`/user/starred/${slug}`, accessToken).catch(
    () => null,
  );
  if (check?.status === 204) return true;
  if (check?.status !== 404) return "unknown";

  const list = await apiGet(
    "/user/starred?per_page=100&sort=created&direction=desc",
    accessToken,
  ).catch(() => null);
  if (!list?.ok) return "unknown";
  const stars: unknown = await list.json().catch(() => null);
  if (!Array.isArray(stars)) return "unknown";
  const found = stars.some(
    (star: { full_name?: unknown } | null) =>
      typeof star?.full_name === "string" &&
      star.full_name.toLowerCase() === slug.toLowerCase(),
  );
  if (found) return true;
  const truncated = /rel="next"/.test(list.headers.get("link") ?? "");
  return truncated ? "unknown" : false;
}

const INTERNAL_BASE = "http://internal.invalid";
/**
 * The path travels in the transaction cookie, and a browser drops a cookie
 * beyond 4096 bytes without a word. This leaves room for a studio URL with a
 * full 2000-character option string.
 */
const MAX_RETURN_TO_LENGTH = 2560;

/**
 * Reduces a `returnTo` value to a same-origin path; anything else becomes "/".
 * This is what keeps the sign-in flow from being an open redirect.
 *
 * The value is judged after URL normalisation, not before: "/.//evil.example"
 * starts with a single slash but normalises to "//evil.example", which a
 * browser reads as another host. API routes are refused as well, so a crafted
 * link cannot bounce the sign-in back into itself.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value?.startsWith("/")) return "/";
  let url: URL;
  try {
    url = new URL(value, INTERNAL_BASE);
  } catch {
    return "/";
  }
  if (url.origin !== INTERNAL_BASE) return "/";
  // Backslashes were turned into slashes by the parser, so one check covers
  // both.
  if (url.pathname.startsWith("//")) return "/";
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname).toLowerCase();
  } catch {
    return "/";
  }
  if (decodedPath === "/api" || decodedPath.startsWith("/api/")) return "/";
  const path = url.pathname + url.search + url.hash;
  return path.length > MAX_RETURN_TO_LENGTH ? "/" : path;
}

/** Constant-time comparison for the `state` parameter. */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.byteLength !== y.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < x.byteLength; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
