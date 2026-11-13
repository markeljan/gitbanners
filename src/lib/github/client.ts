/**
 * Transport for the GitHub API: one GraphQL POST and one REST GET helper on
 * top of the global `fetch`. Nothing here knows about banners or the
 * normalized model; it only turns HTTP into "data" or a {@link GitHubError}.
 *
 * Rules it enforces on every request:
 * - `Time-Zone: UTC`, otherwise GitHub buckets contribution days in the token
 *   owner's timezone and banners disagree between tokens.
 * - A hard 9.5 s deadline: GitHub kills requests at ~10 s, answers with an
 *   HTML 502/504 and bills the timeout against the rate limit.
 * - `cache: "no-store"`: caching happens one level up (`cached.ts`), never as
 *   an implicit copy of an authenticated response in the framework's cache.
 * - "Not found" is data. GraphQL `NOT_FOUND` on a nullable field and REST 404
 *   are returned to the caller instead of thrown.
 * - Once GitHub says "rate limited", this process stops asking until the limit
 *   resets. Thrown results are not cached, so without this every uncached
 *   page view would send another doomed request, and GitHub's guidance is
 *   explicit that integrations which keep asking while throttled risk a ban.
 */
import { z } from "zod";
import { GitHubError } from "./errors";
import { getServerToken } from "./token";

export { getServerToken, hasGitHubToken } from "./token";

const API_ORIGIN = "https://api.github.com";
const API_VERSION = "2026-03-10";
const USER_AGENT = "gitbanners";
/** Seconds to back off when GitHub throttles without saying for how long. */
const DEFAULT_BACKOFF_SECONDS = 60;
/** Longest back-off we report: the primary limit resets every hour. */
const MAX_BACKOFF_SECONDS = 3_600;

/** Per-request deadline in ms, just under GitHub's own ~10 s kill switch. */
export const REQUEST_TIMEOUT_MS = 9_500;

/** Options shared by {@link graphql} and {@link rest}. */
export interface RequestOptions {
  /**
   * Token to use instead of the server token, e.g. a signed-in user's.
   * Responses fetched with it may contain what only that user can see and
   * must not be stored in a shared cache.
   */
  token?: string;
  /** Aborts the request together with the built-in deadline. */
  signal?: AbortSignal;
  /** Overrides {@link REQUEST_TIMEOUT_MS}; only ever lower it. */
  timeoutMs?: number;
}

/** One entry of a GraphQL `errors` array, reduced to what callers branch on. */
export interface GraphQLErrorEntry {
  /** GitHub's error type (`NOT_FOUND`, `FORBIDDEN`, ...), `null` if absent. */
  type: string | null;
  message: string;
  /** Response path of the field that failed; empty for request-level errors. */
  path: readonly (string | number)[];
}

/** A GraphQL response that carries data, possibly partial. */
export interface GraphQLResult<T> {
  data: T;
  /**
   * Field-level errors that left the response usable: `NOT_FOUND` on a
   * nullable root (the root is `null`) or an error on a nested field or list
   * item (that node is `null`). Callers that need the node treat it as missing.
   */
  errors: readonly GraphQLErrorEntry[];
}

/** A REST response. `data` is `null` for 202, 204 and 404. */
export interface RestResult<T> {
  /** 200, 202 (still computing), 204 (empty) or 404 (not found). */
  status: number;
  data: T | null;
  /** Raw `Link` header for pagination, see {@link lastPage}. */
  link: string | null;
}

interface Received {
  status: number;
  headers: Headers;
  body: string;
}

/**
 * A signal that aborts after `ms`, or earlier together with `signal`.
 *
 * Fetchers that send several requests pass ONE such signal to all of them:
 * the per-request deadline bounds a single round trip, this bounds the whole
 * fetch, however many requests follow each other.
 */
export function withDeadline(
  signal: AbortSignal | undefined,
  ms: number = REQUEST_TIMEOUT_MS,
): AbortSignal {
  const deadline = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

/** Whether an abort reason comes from `AbortSignal.timeout`. */
function isTimeout(reason: unknown): boolean {
  return (
    typeof reason === "object" &&
    reason !== null &&
    "name" in reason &&
    reason.name === "TimeoutError"
  );
}

const EnvelopeSchema = z.object({
  data: z.record(z.string(), z.unknown()).nullish(),
  errors: z
    .array(
      z.object({
        type: z.string().nullish(),
        message: z.string().catch("GraphQL error"),
        path: z.array(z.union([z.string(), z.number()])).nullish(),
        locations: z.array(z.unknown()).nullish(),
        extensions: z.object({ code: z.string().nullish() }).nullish(),
      }),
    )
    .nullish(),
});

type EnvelopeError = NonNullable<
  z.infer<typeof EnvelopeSchema>["errors"]
>[number];

/** GraphQL error types that mean "this query can never work as sent". */
const INVALID_TYPES: ReadonlySet<string> = new Set([
  "VALIDATION",
  "EXCESSIVE_PAGINATION",
  "MAX_NODE_LIMIT_EXCEEDED",
  "UNPROCESSABLE",
]);
const FORBIDDEN_TYPES: ReadonlySet<string> = new Set([
  "FORBIDDEN",
  "INSUFFICIENT_SCOPES",
]);
const SECONDARY_LIMIT_RE = /secondary rate limit|abuse detection/i;
const PRIMARY_LIMIT_RE = /rate limit exceeded/i;
/** GitHub's messages can be long (a scope error lists every scope). */
const MAX_MESSAGE_LENGTH = 300;

function requestHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "Time-Zone": "UTC",
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": API_VERSION,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function send(
  url: string,
  init: {
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: string;
  },
  opts: RequestOptions,
): Promise<Received> {
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, deadline])
    : deadline;
  try {
    const response = await fetch(url, {
      ...init,
      signal,
      cache: "no-store",
      redirect: "follow",
    });
    // The body is read under the same deadline: a stalled download must not
    // outlive the request budget.
    const body = await response.text();
    return { status: response.status, headers: response.headers, body };
  } catch (cause) {
    if (deadline.aborted) {
      throw new GitHubError(
        "unavailable",
        `GitHub did not answer within ${timeoutMs} ms`,
        { status: 504, cause },
      );
    }
    if (opts.signal?.aborted) {
      // The caller's signal can itself be a deadline, see `withDeadline`.
      throw isTimeout(opts.signal.reason)
        ? new GitHubError(
            "unavailable",
            "GitHub did not answer within the time budget",
            { status: 504, cause },
          )
        : new GitHubError("unavailable", "Request to GitHub was aborted", {
            cause,
          });
    }
    throw new GitHubError("unavailable", "Could not reach GitHub", { cause });
  }
}

function isHtml(received: Received): boolean {
  const type = received.headers.get("content-type") ?? "";
  return (
    type.includes("text/html") || received.body.trimStart().startsWith("<")
  );
}

function parseJson(received: Received): unknown {
  if (!isHtml(received)) {
    try {
      return JSON.parse(received.body);
    } catch {
      // handled below
    }
  }
  throw new GitHubError(
    "unavailable",
    `GitHub answered HTTP ${received.status} with a body that is not JSON`,
    { status: 502 },
  );
}

/** `message` of a GitHub JSON error body, or a generic description. */
function apiMessage(received: Received): string {
  if (isHtml(received)) return "HTML error page";
  try {
    const parsed: unknown = JSON.parse(received.body);
    if (typeof parsed === "object" && parsed !== null && "message" in parsed) {
      const { message } = parsed;
      if (typeof message === "string" && message) {
        return message.slice(0, MAX_MESSAGE_LENGTH);
      }
    }
  } catch {
    // not JSON: fall through
  }
  return "no details";
}

function parseSeconds(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function clampBackoff(seconds: number): number {
  return Math.min(MAX_BACKOFF_SECONDS, Math.max(0, Math.ceil(seconds)));
}

/** Seconds until `x-ratelimit-reset`, `null` when the header is unusable. */
function secondsUntilReset(headers: Headers): number | null {
  const reset = parseSeconds(headers.get("x-ratelimit-reset"));
  return reset === null ? null : clampBackoff(reset - Date.now() / 1000);
}

/**
 * Recognises both rate limits from what GitHub actually sends: `retry-after`
 * or a "secondary rate limit" message (secondary), `x-ratelimit-remaining: 0`
 * or "rate limit exceeded" (primary). `x-ratelimit-remaining` is only compared
 * with zero: its value jumps between GitHub regions and is useless for maths.
 */
function rateLimitError(headers: Headers, message: string): GitHubError | null {
  const retryAfter = parseSeconds(headers.get("retry-after"));
  if (retryAfter !== null || SECONDARY_LIMIT_RE.test(message)) {
    return new GitHubError(
      "rate_limited",
      `GitHub secondary rate limit: ${message}`,
      { retryAfter: clampBackoff(retryAfter ?? DEFAULT_BACKOFF_SECONDS) },
    );
  }
  if (
    headers.get("x-ratelimit-remaining") === "0" ||
    PRIMARY_LIMIT_RE.test(message)
  ) {
    return new GitHubError("rate_limited", `GitHub rate limit: ${message}`, {
      retryAfter: secondsUntilReset(headers),
    });
  }
  return null;
}

/** Maps a non-2xx response to an error. Never looks at `statusText`: it is empty on HTTP/2. */
function httpError(received: Received): GitHubError {
  const { status, headers } = received;
  const message = apiMessage(received);
  if (status === 401) {
    return new GitHubError(
      "forbidden",
      `GitHub rejected the token: ${message}`,
      {
        status: 401,
      },
    );
  }
  if (status === 403 || status === 429) {
    const limited = rateLimitError(headers, message);
    if (limited) return limited;
    if (status === 429) {
      return new GitHubError("rate_limited", `GitHub rate limit: ${message}`, {
        retryAfter: DEFAULT_BACKOFF_SECONDS,
      });
    }
    // e.g. "The history or contributor list is too large to list contributors".
    return new GitHubError("forbidden", `GitHub refused: ${message}`, {
      status: 403,
    });
  }
  if (status >= 500 || isHtml(received)) {
    // 502/504 with an nginx HTML page is how a GitHub-side timeout looks.
    return new GitHubError("unavailable", `GitHub HTTP ${status}: ${message}`, {
      status: status >= 500 ? status : 502,
    });
  }
  return new GitHubError("invalid", `GitHub HTTP ${status}: ${message}`, {
    status,
  });
}

function graphqlError(error: EnvelopeError, headers: Headers): GitHubError {
  const type = error.type ?? null;
  const message = error.message.slice(0, MAX_MESSAGE_LENGTH);
  if (
    type === "RATE_LIMITED" ||
    SECONDARY_LIMIT_RE.test(message) ||
    PRIMARY_LIMIT_RE.test(message)
  ) {
    return (
      rateLimitError(headers, message) ??
      new GitHubError("rate_limited", `GitHub rate limit: ${message}`, {
        retryAfter: secondsUntilReset(headers) ?? DEFAULT_BACKOFF_SECONDS,
      })
    );
  }
  if (type !== null && FORBIDDEN_TYPES.has(type)) {
    return new GitHubError("forbidden", `GitHub refused: ${message}`);
  }
  // Syntax and validation errors carry no `type`, only a location or a code.
  const rejectedAtParseTime =
    type === null &&
    (error.locations != null || error.extensions?.code != null);
  if ((type !== null && INVALID_TYPES.has(type)) || rejectedAtParseTime) {
    return new GitHubError("invalid", `GitHub rejected the query: ${message}`);
  }
  // Untyped "Something went wrong while executing your query", INTERNAL, ...
  return new GitHubError("unavailable", `GitHub GraphQL error: ${message}`);
}

function toEntry(error: EnvelopeError): GraphQLErrorEntry {
  return {
    type: error.type ?? null,
    message: error.message,
    path: error.path ?? [],
  };
}

/** Separate budgets at GitHub: GraphQL points and REST requests. */
type Bucket = "graphql" | "rest";

/** Upper bound on tracked credentials, so user tokens cannot grow the map forever. */
const MAX_TRACKED_LIMITS = 1_000;
/** Limit key -> epoch ms until which requests are refused locally. */
const blockedUntil = new Map<string, number>();
/** Errors raised here without asking GitHub, see {@link isLocalRefusal}. */
const localRefusals = new WeakSet<GitHubError>();

/**
 * Whether a `rate_limited` error was raised locally, because an earlier
 * response had already announced the limit, rather than by GitHub itself.
 * The first is worth one log line; its hundreds of echoes are not.
 */
export function isLocalRefusal(error: unknown): boolean {
  return error instanceof GitHubError && localRefusals.has(error);
}

/**
 * Identifies a credential without keeping it: a 32-bit FNV-1a hash is enough
 * to tell the handful of tokens in one process apart and cannot be reversed.
 */
function limitKey(bucket: Bucket, token: string | null): string {
  if (!token) return `${bucket}:anonymous`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < token.length; index += 1) {
    hash = Math.imul(hash ^ token.charCodeAt(index), 0x01000193);
  }
  return `${bucket}:${(hash >>> 0).toString(36)}`;
}

/**
 * Runs `request` unless this credential is known to be rate limited, and
 * remembers a rate limit it runs into for as long as GitHub asked us to wait.
 */
async function guarded<T>(key: string, request: () => Promise<T>): Promise<T> {
  const until = blockedUntil.get(key);
  if (until !== undefined) {
    const remainingMs = until - Date.now();
    if (remainingMs > 0) {
      const refusal = new GitHubError(
        "rate_limited",
        "GitHub rate limit: waiting for the limit to reset",
        { retryAfter: Math.ceil(remainingMs / 1000) },
      );
      localRefusals.add(refusal);
      throw refusal;
    }
    blockedUntil.delete(key);
  }
  try {
    return await request();
  } catch (error) {
    if (error instanceof GitHubError && error.code === "rate_limited") {
      const seconds = error.retryAfter ?? DEFAULT_BACKOFF_SECONDS;
      if (blockedUntil.size >= MAX_TRACKED_LIMITS) blockedUntil.clear();
      if (seconds > 0) blockedUntil.set(key, Date.now() + seconds * 1000);
    }
    throw error;
  }
}

/**
 * Runs a GraphQL query against api.github.com.
 *
 * Returns whenever the response carries data, even partial: a root field that
 * is `null` with no error or only `NOT_FOUND` errors means "does not exist"
 * and is the caller's to interpret. Throws a {@link GitHubError} when the
 * request failed, was throttled, or a root field is `null` for any other
 * reason (a validation error also nulls the root, and must never be mistaken
 * for "not found").
 *
 * `T` is not checked here: decode `data` before trusting it.
 */
export async function graphql<T = unknown>(
  query: string,
  variables: Record<string, unknown>,
  opts: RequestOptions = {},
): Promise<GraphQLResult<T>> {
  const token = opts.token || getServerToken();
  if (!token) {
    // GraphQL has no anonymous access (HTTP 403, x-ratelimit-limit: 0).
    throw new GitHubError(
      "unavailable",
      "No GitHub token is configured (set GITHUB_TOKEN)",
    );
  }
  return guarded(limitKey("graphql", token), async () => {
    const received = await send(
      `${API_ORIGIN}/graphql`,
      {
        method: "POST",
        headers: {
          ...requestHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
      },
      opts,
    );
    if (received.status < 200 || received.status >= 300) {
      throw httpError(received);
    }
    const envelope = EnvelopeSchema.safeParse(parseJson(received));
    if (!envelope.success) {
      throw new GitHubError("unavailable", "GitHub sent a malformed response", {
        status: 502,
      });
    }
    const errors = envelope.data.errors ?? [];
    const { data } = envelope.data;

    const limited = errors.find((error) => error.type === "RATE_LIMITED");
    if (limited) throw graphqlError(limited, received.headers);

    if (data == null) {
      const [first] = errors;
      throw first
        ? graphqlError(first, received.headers)
        : new GitHubError("unavailable", "GitHub sent an empty response", {
            status: 502,
          });
    }

    for (const [root, value] of Object.entries(data)) {
      if (value !== null) continue;
      const fatal = errors.find(
        (error) =>
          error.type !== "NOT_FOUND" &&
          (!error.path?.length || error.path[0] === root),
      );
      if (fatal) throw graphqlError(fatal, received.headers);
    }

    return { data: data as T, errors: errors.map(toEntry) };
  });
}

/**
 * GETs a REST resource from api.github.com. `path` starts with `/` and is
 * already URL-encoded.
 *
 * Works without a token (60 requests per hour and IP), which the tokenless
 * fallback relies on. 202 (statistics still being computed), 204 (empty) and
 * 404 are returned with `data: null`; every other non-2xx throws.
 *
 * `T` is not checked here: decode `data` before trusting it.
 */
export async function rest<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<RestResult<T>> {
  if (!path.startsWith("/") || path.startsWith("//")) {
    // The Authorization header must never travel to another origin.
    throw new GitHubError("invalid", "REST paths must start with a single /");
  }
  const token = opts.token || getServerToken();
  return guarded(limitKey("rest", token), async () => {
    const received = await send(
      `${API_ORIGIN}${path}`,
      { method: "GET", headers: requestHeaders(token) },
      opts,
    );
    const { status } = received;
    const link = received.headers.get("link");
    if (status === 202 || status === 204 || status === 404) {
      return { status, data: null, link };
    }
    if (status < 200 || status >= 300) throw httpError(received);
    return { status, data: parseJson(received) as T, link };
  });
}

/**
 * Page number of the `rel="last"` entry of a `Link` header, or `null`.
 * With `per_page=1` that number is the total item count.
 */
export function lastPage(link: string | null): number | null {
  const match = link?.match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/);
  return match?.[1] ? Number(match[1]) : null;
}
