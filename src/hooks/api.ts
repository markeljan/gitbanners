/**
 * Browser-side access to the site's own JSON endpoints.
 *
 * Every non-2xx answer of the API is RFC 9457 problem+json with a stable
 * `code`; this module turns it into one error type the hooks can branch on,
 * and into the four outcomes the UI words differently.
 */

/** How a failed request is presented. */
export type ApiFailure =
  /** 404: no such account or repository. A fact, not an outage. */
  | "not_found"
  /** 400 / 422: the request itself was wrong. */
  | "invalid"
  /** 429, or the API saying GitHub throttles it. Retry later. */
  | "rate_limited"
  /** 5xx, an unreadable body or no network. Retry later. */
  | "unavailable"
  /** A newer request replaced this one. Never shown. */
  | "aborted";

export class ApiProblem extends Error {
  override readonly name = "ApiProblem";
  /** HTTP status, or 0 when no response arrived. */
  readonly status: number;
  /** The problem's `code`, e.g. "not_found", "rate_limited". */
  readonly code: string;
  /** Seconds to wait before a retry can succeed, when the server said so. */
  readonly retryAfter: number | null;

  constructor(
    status: number,
    code: string,
    detail: string,
    retryAfter: number | null = null,
  ) {
    super(detail);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** `Retry-After` in seconds. Only the delta-seconds form is ever sent by us. */
export function parseRetryAfter(header: string | null): number | null {
  if (header === null || !/^\d{1,6}$/.test(header.trim())) return null;
  return Number(header.trim());
}

/** The error for a non-2xx response, from whatever body came with it. */
export function problemFromResponse(
  status: number,
  body: unknown,
  retryAfter: string | null = null,
): ApiProblem {
  const record = isRecord(body) ? body : {};
  const code =
    typeof record.code === "string" && record.code
      ? record.code
      : `http_${status}`;
  const detail =
    typeof record.detail === "string" && record.detail
      ? record.detail
      : typeof record.title === "string" && record.title
        ? record.title
        : `Request failed with status ${status}`;
  return new ApiProblem(status, code, detail, parseRetryAfter(retryAfter));
}

/** Which of the outcomes an error thrown by {@link fetchJson} is. */
export function failureOf(error: unknown): ApiFailure {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "aborted";
  }
  if (isRecord(error) && error.name === "AbortError") return "aborted";
  if (!(error instanceof ApiProblem)) return "unavailable";
  if (error.status === 404) return "not_found";
  if (error.status === 429 || error.code === "upstream_rate_limited") {
    return "rate_limited";
  }
  if (error.status === 400 || error.status === 422) return "invalid";
  return "unavailable";
}

/**
 * GET a same-origin JSON endpoint. Resolves with the parsed body, rejects
 * with an {@link ApiProblem} for every non-2xx answer or unreadable body,
 * and with the browser's own `AbortError` when `signal` fires.
 */
export async function fetchJson(
  url: string,
  init: { signal?: AbortSignal; credentials?: RequestCredentials } = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      credentials: init.credentials ?? "same-origin",
      signal: init.signal,
    });
  } catch (error) {
    if (failureOf(error) === "aborted") throw error;
    throw new ApiProblem(0, "network", "The request did not reach the server.");
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch (error) {
    if (failureOf(error) === "aborted") throw error;
    if (response.ok) {
      throw new ApiProblem(
        response.status,
        "unreadable",
        "The response was not valid JSON.",
      );
    }
  }
  if (!response.ok) {
    throw problemFromResponse(
      response.status,
      body,
      response.headers.get("retry-after"),
    );
  }
  return body;
}
