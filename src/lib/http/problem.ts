/**
 * RFC 9457 problem responses (`application/problem+json`).
 *
 * Every error the JSON API and the account routes return has this shape, so a
 * client or agent can branch on `code`, show `title` and `detail`, and follow
 * `resolution` without knowing the endpoint.
 */
import type { LimitResult } from "@/lib/ratelimit";
import { site } from "@/lib/site";

/** What a problem response is made of, besides the status code. */
export interface ProblemInit {
  /** Stable machine-readable identifier in snake_case, e.g. `not_found`. */
  code: string;
  /** Short summary that is the same for every occurrence of this code. */
  title: string;
  /** What went wrong this time. */
  detail?: string;
  /** What the caller can do about it. */
  resolution?: string;
  /** URI reference of the specific occurrence, usually the request path. */
  instance?: string;
  /** Extra response headers. They win over the defaults. */
  headers?: Record<string, string>;
  /** Extension members. The standard members above cannot be overridden. */
  extra?: Record<string, unknown>;
}

/** Everything but the code and title a helper already knows. */
export type ProblemOverrides = Partial<ProblemInit>;

/** Documentation anchor for an error code; the `type` URI of the problem. */
export function problemType(code: string): string {
  return `${site.url}/docs#error-${code}`;
}

/**
 * Builds the response. Errors are not cached unless the caller says otherwise
 * through `headers` (a public 404 may well be cacheable).
 */
export function problem(status: number, init: ProblemInit): Response {
  const body = {
    ...init.extra,
    type: problemType(init.code),
    title: init.title,
    status,
    detail: init.detail,
    code: init.code,
    resolution: init.resolution,
    instance: init.instance,
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...init.headers,
      "Content-Type": "application/problem+json",
    },
  });
}

/** 404. Also the answer for resources that exist but are not the caller's. */
export function notFound(
  detail?: string,
  overrides: ProblemOverrides = {},
): Response {
  return problem(404, {
    code: "not_found",
    title: "Not found",
    detail,
    ...overrides,
  });
}

/** 400 for a request that cannot be understood or fails validation. */
export function badRequest(
  detail?: string,
  overrides: ProblemOverrides = {},
): Response {
  return problem(400, {
    code: "bad_request",
    title: "Invalid request",
    detail,
    ...overrides,
  });
}

/** 401: nobody is signed in, or the session is no longer valid. */
export function unauthorized(
  detail?: string,
  overrides: ProblemOverrides = {},
): Response {
  return problem(401, {
    code: "unauthorized",
    title: "Sign-in required",
    detail,
    resolution: "Sign in with GitHub and try again.",
    ...overrides,
  });
}

/** 403: the caller is known but may not do this. */
export function forbidden(
  detail?: string,
  overrides: ProblemOverrides = {},
): Response {
  return problem(403, {
    code: "forbidden",
    title: "Forbidden",
    detail,
    ...overrides,
  });
}

/**
 * 429 with `Retry-After` and the `RateLimit` headers of the failed check.
 * `violated-policies` is the extension member the IETF rate-limit draft
 * defines for this case.
 */
export function rateLimited(
  result: LimitResult,
  overrides: ProblemOverrides = {},
): Response {
  const wait = Math.max(1, result.resetSeconds);
  return problem(429, {
    code: "rate_limited",
    title: "Too many requests",
    detail: `The "${result.policy}" limit of ${result.limit} requests was reached.`,
    resolution: `Wait ${wait} seconds before retrying.`,
    ...overrides,
    headers: {
      "Retry-After": String(wait),
      ...result.headers,
      ...overrides.headers,
    },
    extra: { "violated-policies": [result.policy], ...overrides.extra },
  });
}

/** 405 with the mandatory `Allow` header. */
export function methodNotAllowed(
  allow: readonly string[],
  overrides: ProblemOverrides = {},
): Response {
  return problem(405, {
    code: "method_not_allowed",
    title: "Method not allowed",
    detail: `This endpoint supports ${allow.join(", ")}.`,
    ...overrides,
    headers: { Allow: allow.join(", "), ...overrides.headers },
  });
}

/** The methods a route file can implement itself. */
export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * What a route file exports for the methods it does not implement.
 *
 * Left alone, Next.js answers them with a bare 405: no body, and no `Allow`
 * header although RFC 9110 requires one. A route therefore exports
 * `notAllowed` under every method it lacks and `options` as `OPTIONS`.
 * The latter matters as much: the framework's own `OPTIONS` answer lists
 * every exported handler, so it would advertise the refusals as supported.
 *
 * A side effect worth having: Next.js never prerenders a route file that
 * exports `POST`, `PUT`, `PATCH`, `DELETE` or `OPTIONS` (`hasNonStaticMethods`
 * in its app-route module, 16.4), so with these exports a `GET` handler cannot
 * be frozen at build time by accident, whatever it reads.
 *
 * @param supported The methods the route does implement. `HEAD` (answered
 * from `GET` by the framework) and `OPTIONS` are added here.
 */
export function methodGuards(supported: readonly RouteMethod[]): {
  notAllowed: (request: Request) => Response;
  options: () => Response;
} {
  const allow = [
    ...supported,
    ...(supported.includes("GET") ? ["HEAD"] : []),
    "OPTIONS",
  ];
  return {
    notAllowed: (request) =>
      methodNotAllowed(allow, { instance: new URL(request.url).pathname }),
    options: () =>
      new Response(null, { status: 204, headers: { Allow: allow.join(", ") } }),
  };
}

/** 503 for a dependency that is down or not configured. */
export function unavailable(
  retryAfterSeconds?: number,
  overrides: ProblemOverrides = {},
): Response {
  return problem(503, {
    code: "unavailable",
    title: "Service unavailable",
    resolution:
      retryAfterSeconds === undefined
        ? undefined
        : `Try again in ${retryAfterSeconds} seconds.`,
    ...overrides,
    headers: {
      ...(retryAfterSeconds === undefined
        ? {}
        : { "Retry-After": String(retryAfterSeconds) }),
      ...overrides.headers,
    },
  });
}
