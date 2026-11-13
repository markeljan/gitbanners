/**
 * Every `code` a problem response can carry, with what it means and what to
 * do about it. The docs page prints the tables (one row per code, anchored
 * as `#error-{code}`, which is what a problem's `type` URI points at) and
 * `/openapi.json` takes the `api` codes for its `ProblemDetails` schema.
 *
 * Isomorphic: text only.
 */
export interface ErrorCodeDoc {
  code: string;
  status: number;
  meaning: string;
  /** What the caller should do next. */
  action: string;
  /** `api`: the public JSON API and image URLs. `account`: the web app's own session routes. */
  surface: "api" | "account";
}

export const ERROR_CODES: readonly ErrorCodeDoc[] = [
  {
    code: "invalid_request",
    status: 400,
    meaning: "A parameter is missing, malformed or out of range.",
    action:
      "Read `detail` and `resolution`, fix the request, then retry. The same request will fail again.",
    surface: "api",
  },
  {
    code: "not_found",
    status: 404,
    meaning:
      "No public GitHub user, organization or repository has that name. A private repository counts as not found. An image URL answers with this code when it cannot be a banner at all.",
    action:
      "Check the spelling on github.com, or resolve a partial name with the search operation.",
    surface: "api",
  },
  {
    code: "api_route_not_found",
    status: 404,
    meaning: "The path is not an operation of the API.",
    action:
      "Find the operations in [/openapi.json](/openapi.json) or [/.well-known/api-catalog](/.well-known/api-catalog).",
    surface: "api",
  },
  {
    code: "method_not_allowed",
    status: 405,
    meaning:
      "The path exists, but not for this HTTP method. The public API is read-only.",
    action: "Retry with `GET`. The `Allow` header lists what is supported.",
    surface: "api",
  },
  {
    code: "rate_limited",
    status: 429,
    meaning: "The client sent more requests than its quota allows.",
    action: "Wait the number of seconds in `Retry-After`, then retry.",
    surface: "api",
  },
  {
    code: "internal_error",
    status: 500,
    meaning: "The request failed for a reason that is not the caller's.",
    action: "Retry in a moment. If it keeps failing, open an issue.",
    surface: "api",
  },
  {
    code: "upstream_rate_limited",
    status: 503,
    meaning:
      "GitHub is rate limiting this service and no earlier copy of the data exists.",
    action: "Retry after the number of seconds in `Retry-After`.",
    surface: "api",
  },
  {
    code: "upstream_unavailable",
    status: 503,
    meaning:
      "GitHub did not answer in time and no earlier copy of the data exists.",
    action: "Retry after the number of seconds in `Retry-After`.",
    surface: "api",
  },
  {
    code: "bad_request",
    status: 400,
    meaning:
      "The request could not be understood, for example a body that is not valid JSON.",
    action: "Fix the request, then retry.",
    surface: "account",
  },
  {
    code: "invalid_body",
    status: 400,
    meaning: "The JSON body failed validation.",
    action: "The `errors` member names each field and what is wrong with it.",
    surface: "account",
  },
  {
    code: "unauthorized",
    status: 401,
    meaning: "Nobody is signed in, or the session is no longer valid.",
    action: "Sign in with GitHub and try again.",
    surface: "account",
  },
  {
    code: "forbidden",
    status: 403,
    meaning: "The signed-in account may not do this.",
    action: "Read `detail` for the reason.",
    surface: "account",
  },
  {
    code: "cross_origin_request",
    status: 403,
    meaning: "A request that changes account data came from another site.",
    action: "Account data can only be changed from this site itself.",
    surface: "account",
  },
  {
    code: "pro_required",
    status: 403,
    meaning: "The feature needs Pro.",
    action:
      "Star the repository on GitHub, then sign in again. See [pricing](/pricing).",
    surface: "account",
  },
  {
    code: "banner_limit_reached",
    status: 403,
    meaning: "The plan's number of saved banners is used up.",
    action: "Delete a saved banner, or unlock Pro for a higher limit.",
    surface: "account",
  },
  {
    code: "login_changed",
    status: 409,
    meaning:
      "The GitHub login this session was created with now belongs to another account.",
    action: "Sign in with GitHub again and retry.",
    surface: "account",
  },
  {
    code: "payload_too_large",
    status: 413,
    meaning: "The request body is larger than 16 KB.",
    action: "Send a smaller body.",
    surface: "account",
  },
  {
    code: "unsupported_media_type",
    status: 415,
    meaning: "The body was not sent as JSON.",
    action: "Send it with `Content-Type: application/json`.",
    surface: "account",
  },
  {
    code: "origin_mismatch",
    status: 500,
    meaning:
      "Sign-in is misconfigured: the site's canonical address does not lead back to it.",
    action: "Nothing a visitor can fix. Please report it.",
    surface: "account",
  },
  {
    code: "accounts_unavailable",
    status: 503,
    meaning: "Accounts are not configured on this deployment.",
    action: "Public banners and the API work without an account.",
    surface: "account",
  },
  {
    code: "unavailable",
    status: 503,
    meaning: "The account database cannot be reached right now.",
    action: "Try again after the number of seconds in `Retry-After`.",
    surface: "account",
  },
];

/** Anchor of a code on the docs page: the fragment of a problem's `type` URI. */
export function errorAnchor(code: string): string {
  return `error-${code}`;
}

export function errorCodes(
  surface: ErrorCodeDoc["surface"],
): readonly ErrorCodeDoc[] {
  return ERROR_CODES.filter((entry) => entry.surface === surface);
}
