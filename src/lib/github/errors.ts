/**
 * The one error type the GitHub data layer throws.
 *
 * "Not found" is deliberately NOT an error: fetchers return `null` for an
 * unknown login or repository so callers can cache the miss and answer 404.
 * Everything that is thrown means "GitHub (or our access to it) is in the
 * way", and the code tells the caller what to do about it.
 */

/**
 * - `rate_limited`: primary or secondary rate limit. Serve stale, retry after
 *   `retryAfter` seconds.
 * - `unavailable`: timeout, network failure, 5xx, HTML error page, a body we
 *   cannot read, or no credentials configured. Serve stale; safe to retry later.
 * - `forbidden`: the token was rejected (401) or may not see the resource
 *   (403 that is not a rate limit, missing scopes). Retrying will not help.
 * - `invalid`: the request itself is wrong (bad argument, query rejected by
 *   GitHub). A bug or bad input, never transient.
 */
export type GitHubErrorCode =
  | "rate_limited"
  | "unavailable"
  | "forbidden"
  | "invalid";

/** HTTP status reported when the caller does not have a better one. */
const DEFAULT_STATUS: Record<GitHubErrorCode, number> = {
  rate_limited: 429,
  unavailable: 503,
  forbidden: 403,
  invalid: 400,
};

/** Optional details of a {@link GitHubError}. */
export interface GitHubErrorOptions {
  /** HTTP status to surface. Defaults per code: 429, 503, 403, 400. */
  status?: number;
  /** Seconds until a retry can succeed, when GitHub told us. */
  retryAfter?: number | null;
  /** The underlying error, kept for server logs only. */
  cause?: unknown;
}

/** First field of {@link GitHubError.digest}. */
const DIGEST_PREFIX = "GITHUB_ERROR";

/**
 * Error thrown by every fetcher in `src/lib/github`.
 *
 * `message` is written for server logs: it can quote GitHub's own wording
 * (rate-limit notices, missing scopes). Show visitors a text chosen from
 * `code`, not the message.
 */
export class GitHubError extends Error {
  override readonly name = "GitHubError";
  readonly code: GitHubErrorCode;
  /** HTTP status suitable for the response this error ends up in. */
  readonly status: number;
  /** Seconds to wait before retrying, `null` when unknown. */
  readonly retryAfter: number | null;
  /**
   * `GITHUB_ERROR;{code};{status};{retryAfter}`, e.g.
   * `GITHUB_ERROR;rate_limited;429;60` (the last field is empty for `null`).
   *
   * An error that leaves a `'use cache'` function, or a server render on its
   * way to an error boundary, is re-created by React on the other side. In a
   * production build only `digest` survives that: class, message and every
   * other property are gone. Next.js keeps a digest that is already set, so
   * this one carries what callers branch on, and {@link asGitHubError}
   * rebuilds the error from it. It never contains the message: a digest can
   * reach the browser.
   */
  readonly digest: string;

  constructor(
    code: GitHubErrorCode,
    message: string,
    options: GitHubErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.code = code;
    this.status = options.status ?? DEFAULT_STATUS[code];
    this.retryAfter = options.retryAfter ?? null;
    this.digest = [
      DIGEST_PREFIX,
      this.code,
      this.status,
      this.retryAfter ?? "",
    ].join(";");
  }
}

const CODES: ReadonlySet<string> = new Set(Object.keys(DEFAULT_STATUS));

function isCode(value: string | undefined): value is GitHubErrorCode {
  return value !== undefined && CODES.has(value);
}

/**
 * Type guard that also recognises a `GitHubError` created by another copy of
 * this module. Next.js can load one source file into several server bundles,
 * where `instanceof` is false for an error that crossed between them.
 */
export function isGitHubError(error: unknown): error is GitHubError {
  if (error instanceof GitHubError) return true;
  if (!(error instanceof Error) || error.name !== "GitHubError") return false;
  return (
    "code" in error &&
    typeof error.code === "string" &&
    CODES.has(error.code) &&
    "status" in error &&
    typeof error.status === "number"
  );
}

/** The error a {@link GitHubError.digest} describes, `null` for any other digest. */
function fromDigest(digest: string, transported: object): GitHubError | null {
  const [prefix, code, status, retryAfter, ...rest] = digest.split(";");
  if (prefix !== DIGEST_PREFIX || !isCode(code) || rest.length > 0) return null;
  const statusNumber = Number(status);
  if (
    !Number.isInteger(statusNumber) ||
    statusNumber < 100 ||
    statusNumber > 599
  ) {
    return null;
  }
  const seconds = retryAfter ? Number(retryAfter) : null;
  if (seconds !== null && !(Number.isFinite(seconds) && seconds >= 0)) {
    return null;
  }
  // Development builds transport name and message; production drops both.
  const original =
    "name" in transported &&
    transported.name === "GitHubError" &&
    "message" in transported &&
    typeof transported.message === "string"
      ? transported.message
      : "";
  return new GitHubError(
    code,
    original || `GitHub error "${code}" (the original is in the server log)`,
    { status: statusNumber, retryAfter: seconds, cause: transported },
  );
}

/**
 * The `GitHubError` behind whatever was caught, or `null` when it is none.
 *
 * Besides real instances (see {@link isGitHubError}) this recognises one
 * that crossed a `'use cache'` boundary: there it arrives as a plain `Error`
 * whose `digest` is all that is left, see {@link GitHubError.digest}. `code`,
 * `status` and `retryAfter` are restored from it; the message is restored in
 * development only, and the transported error is kept as `cause`.
 *
 * Catch sites that sit behind a cached function (`cached.ts` does this for
 * its own wrappers) use `throw asGitHubError(error) ?? error`.
 */
export function asGitHubError(error: unknown): GitHubError | null {
  if (isGitHubError(error)) return error;
  if (typeof error !== "object" || error === null || !("digest" in error)) {
    return null;
  }
  return typeof error.digest === "string"
    ? fromDigest(error.digest, error)
    : null;
}

/**
 * True for the failures a cached copy should paper over: GitHub is throttling
 * us or is not answering. `forbidden` and `invalid` must surface instead.
 */
export function isTransient(error: unknown): error is GitHubError {
  return (
    isGitHubError(error) &&
    (error.code === "rate_limited" || error.code === "unavailable")
  );
}
