import "server-only";

import { isGitHubError } from "@/lib/github/errors";
import {
  CACHE,
  type CachePolicy,
  publicCacheHeaders,
} from "@/lib/http/cache-headers";
import { type ProblemInit, problem } from "@/lib/http/problem";
import {
  clientIp,
  type LimitResult,
  limit,
  POLICIES,
  type PolicyName,
} from "@/lib/ratelimit";
import { site } from "@/lib/site";
import { ApiError } from "./errors";

/**
 * HTTP conventions of the public, keyless read API under `/api/v1`.
 *
 * Every response, errors included, carries:
 * - CORS for any origin (the API is public and cookie-less),
 * - `Link` relations to the machine-readable description and the docs,
 * - the IETF `RateLimit-Policy` / `RateLimit` fields,
 * and every non-2xx body is RFC 9457 `application/problem+json`.
 */

export const API_LINK = [
  `<${site.url}/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"`,
  `<${site.url}/.well-known/api-catalog>; rel="api-catalog"`,
  `<${site.url}/docs>; rel="service-doc"; type="text/html"`,
  `<${site.url}/docs#versioning-and-deprecation>; rel="deprecation"; type="text/html"`,
].join(", ");

const ALLOW = "GET, HEAD, OPTIONS";

function policyHeader(policy: PolicyName): string {
  const rule = POLICIES[policy];
  return `"${rule.name}";q=${rule.limit};w=${rule.windowSeconds}`;
}

/** Headers shared by every public API response. */
export function apiHeaders(
  rate?: LimitResult,
  policy: PolicyName = "api",
): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": ALLOW,
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Access-Control-Expose-Headers":
      "RateLimit, RateLimit-Policy, Retry-After, Link, Deprecation, Sunset",
    Link: API_LINK,
    "X-Content-Type-Options": "nosniff",
    "RateLimit-Policy": policyHeader(rate?.policy ?? policy),
    ...rate?.headers,
  };
}

/** Problem response with the API headers. Never cached. */
export function apiProblem(
  request: Request,
  status: number,
  init: ProblemInit,
  rate?: LimitResult,
): Response {
  const url = new URL(request.url);
  return problem(status, {
    instance: `${url.pathname}${url.search}`,
    ...init,
    headers: { ...apiHeaders(rate), ...init.headers },
    extra: { documentation_url: `${site.url}/docs#errors`, ...init.extra },
  });
}

export interface ApiJsonInit {
  rate?: LimitResult;
  /** CDN and browser lifetimes. Default `CACHE.api`. */
  cache?: CachePolicy;
  /** Tags the CDN copy can be purged by. */
  tags?: readonly string[];
  headers?: Record<string, string>;
}

/** 200 JSON with the API headers and public cache headers. */
export function apiJson(body: unknown, init: ApiJsonInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      ...apiHeaders(init.rate),
      ...publicCacheHeaders(init.cache ?? CACHE.api, init.tags),
      ...init.headers,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function tooManyRequests(request: Request, rate: LimitResult): Response {
  const wait = Math.max(1, rate.resetSeconds);
  return apiProblem(
    request,
    429,
    {
      code: "rate_limited",
      title: "Too many requests",
      detail: `The public quota is ${rate.limit} requests per ${POLICIES[rate.policy].windowSeconds} seconds per client.`,
      resolution: `Wait ${wait} seconds (see Retry-After), then retry.`,
      headers: { "Retry-After": String(wait) },
      extra: { "violated-policies": [rate.policy] },
    },
    rate,
  );
}

function fromApiError(
  request: Request,
  error: ApiError,
  rate: LimitResult,
): Response {
  return apiProblem(
    request,
    error.status,
    {
      code: error.code,
      title: error.title,
      detail: error.message,
      resolution: error.resolution,
      headers:
        error.retryAfter == null
          ? undefined
          : { "Retry-After": String(error.retryAfter) },
      extra: error.extra,
    },
    rate,
  );
}

/**
 * Runs a public API operation: rate limit first, then the handler, and every
 * failure becomes a problem response. The handler returns the JSON body (and
 * optionally how to cache it) or throws an {@link ApiError}.
 */
export async function publicApi(
  request: Request,
  policy: PolicyName,
  handler: (url: URL) => Promise<{ body: unknown } & Omit<ApiJsonInit, "rate">>,
): Promise<Response> {
  const rate = await limit(policy, `ip:${clientIp(request)}`);
  if (!rate.ok) return tooManyRequests(request, rate);
  try {
    const { body, ...init } = await handler(new URL(request.url));
    return apiJson(body, { ...init, rate });
  } catch (error) {
    if (error instanceof ApiError) return fromApiError(request, error, rate);
    if (isGitHubError(error)) {
      return fromApiError(request, ApiError.fromGitHub(error), rate);
    }
    console.error("[api] unexpected error", error);
    return apiProblem(
      request,
      500,
      {
        code: "internal_error",
        title: "Internal error",
        detail: "The request could not be completed.",
        resolution: "Retry in a moment. If it keeps failing, open an issue.",
      },
      rate,
    );
  }
}

/** 404 for unknown `/api/*` paths: JSON, counted against the quota. */
export async function apiRouteNotFound(request: Request): Promise<Response> {
  const rate = await limit("api", `ip:${clientIp(request)}`);
  if (!rate.ok) return tooManyRequests(request, rate);
  return apiProblem(
    request,
    404,
    {
      code: "api_route_not_found",
      title: "API route not found",
      detail: "The requested API route does not exist.",
      resolution:
        "Discover the public API through /openapi.json or /.well-known/api-catalog.",
    },
    rate,
  );
}

/** 405 for the verbs a read-only operation does not implement. */
export function apiMethodNotAllowed(request: Request): Response {
  return apiProblem(request, 405, {
    code: "method_not_allowed",
    title: "Method not allowed",
    detail: `This endpoint only supports ${ALLOW}.`,
    resolution: "Retry the request with GET.",
    headers: { Allow: ALLOW },
  });
}

/** CORS preflight. */
export function apiPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: { ...apiHeaders(), Allow: ALLOW },
  });
}
