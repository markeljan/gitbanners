import { describe, expect, test } from "bun:test";
import type { LimitResult } from "../ratelimit";
import { site } from "../site";
import {
  badRequest,
  forbidden,
  methodGuards,
  methodNotAllowed,
  notFound,
  problem,
  problemType,
  rateLimited,
  unauthorized,
  unavailable,
} from "./problem";

const JSON_TYPE = "application/problem+json";

describe("problem()", () => {
  test("RFC 9457 members plus code and resolution", async () => {
    const response = problem(418, {
      code: "teapot",
      title: "I'm a teapot",
      detail: "This pot brews tea.",
      resolution: "Ask for tea.",
      instance: "/api/v1/brew",
    });
    expect(response.status).toBe(418);
    expect(response.headers.get("content-type")).toBe(JSON_TYPE);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      type: `${site.url}/docs#error-teapot`,
      title: "I'm a teapot",
      status: 418,
      detail: "This pot brews tea.",
      code: "teapot",
      resolution: "Ask for tea.",
      instance: "/api/v1/brew",
    });
  });

  test("the type URI is the documentation anchor of the code", () => {
    expect(problemType("not_found")).toBe(`${site.url}/docs#error-not_found`);
    expect(problemType("x")).toMatch(/^https?:\/\/[^/]+\/docs#error-x$/);
  });

  test("absent optional members are left out, not null", async () => {
    const body = await problem(400, { code: "x", title: "X" }).json();
    expect(Object.keys(body).sort()).toEqual([
      "code",
      "status",
      "title",
      "type",
    ]);
  });

  test("extension members are added but cannot override the standard ones", async () => {
    const body = await problem(400, {
      code: "invalid_body",
      title: "Invalid request",
      extra: {
        errors: [{ path: "name", message: "Too small" }],
        status: 200,
        type: "about:blank",
        code: "hijacked",
      },
    }).json();
    expect(body).toEqual({
      type: `${site.url}/docs#error-invalid_body`,
      title: "Invalid request",
      status: 400,
      code: "invalid_body",
      errors: [{ path: "name", message: "Too small" }],
    });
  });

  test("caller headers win over the default, except the content type", () => {
    const response = problem(404, {
      code: "not_found",
      title: "Not found",
      headers: {
        "Cache-Control": "public, max-age=60",
        "Content-Type": "text/html",
        "X-Extra": "1",
      },
    });
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get("content-type")).toBe(JSON_TYPE);
    expect(response.headers.get("x-extra")).toBe("1");
  });
});

describe("helpers", () => {
  test("notFound", async () => {
    const response = notFound("No such banner.");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      type: `${site.url}/docs#error-not_found`,
      title: "Not found",
      status: 404,
      detail: "No such banner.",
      code: "not_found",
    });
  });

  test("badRequest", async () => {
    const response = badRequest("The body is not valid JSON.");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      status: 400,
      code: "bad_request",
      title: "Invalid request",
      detail: "The body is not valid JSON.",
    });
  });

  test("unauthorized points at GitHub sign-in", async () => {
    const response = unauthorized();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      type: `${site.url}/docs#error-unauthorized`,
      title: "Sign-in required",
      status: 401,
      code: "unauthorized",
      resolution: "Sign in with GitHub and try again.",
    });
  });

  test("forbidden, with a more specific code", async () => {
    const response = forbidden("Cross-origin requests are blocked.", {
      code: "cross_origin_request",
      instance: "/api/banners",
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      type: `${site.url}/docs#error-cross_origin_request`,
      title: "Forbidden",
      status: 403,
      detail: "Cross-origin requests are blocked.",
      code: "cross_origin_request",
      instance: "/api/banners",
    });
  });

  test("rateLimited carries the limiter's headers and the violated policy", async () => {
    const result: LimitResult = {
      ok: false,
      policy: "mutations",
      limit: 30,
      remaining: 0,
      resetSeconds: 42,
      headers: {
        "RateLimit-Policy": '"mutations";q=30;w=60',
        RateLimit: '"mutations";r=0;t=42',
        "Retry-After": "42",
      },
    };
    const response = rateLimited(result, {
      instance: "/api/banners",
      headers: { "Cache-Control": "private, no-store" },
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("content-type")).toBe(JSON_TYPE);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.get("ratelimit")).toBe('"mutations";r=0;t=42');
    expect(response.headers.get("ratelimit-policy")).toBe(
      '"mutations";q=30;w=60',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      type: `${site.url}/docs#error-rate_limited`,
      title: "Too many requests",
      status: 429,
      detail: 'The "mutations" limit of 30 requests was reached.',
      code: "rate_limited",
      resolution: "Wait 42 seconds before retrying.",
      instance: "/api/banners",
      "violated-policies": ["mutations"],
    });
  });

  test("rateLimited always sends a Retry-After of at least one second", () => {
    const response = rateLimited({
      ok: false,
      policy: "api",
      limit: 120,
      remaining: 0,
      resetSeconds: 0,
      headers: { "RateLimit-Policy": '"api";q=120;w=60' },
    });
    expect(response.headers.get("retry-after")).toBe("1");
  });

  test("methodNotAllowed sets Allow", async () => {
    const response = methodNotAllowed(["GET", "HEAD"]);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect(await response.json()).toMatchObject({
      status: 405,
      code: "method_not_allowed",
      detail: "This endpoint supports GET, HEAD.",
    });
  });

  test("methodGuards: a 405 problem with Allow, and an honest OPTIONS", async () => {
    const { notAllowed, options } = methodGuards(["GET", "DELETE"]);
    const refused = notAllowed(
      new Request("http://localhost/api/me?x=1", { method: "PUT" }),
    );
    expect(refused.status).toBe(405);
    expect(refused.headers.get("content-type")).toBe(JSON_TYPE);
    // HEAD comes with GET, OPTIONS is always answered.
    expect(refused.headers.get("allow")).toBe("GET, DELETE, HEAD, OPTIONS");
    expect(refused.headers.get("cache-control")).toBe("no-store");
    expect(await refused.json()).toEqual({
      type: `${site.url}/docs#error-method_not_allowed`,
      title: "Method not allowed",
      status: 405,
      detail: "This endpoint supports GET, DELETE, HEAD, OPTIONS.",
      code: "method_not_allowed",
      instance: "/api/me",
    });

    const preflight = options();
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("allow")).toBe("GET, DELETE, HEAD, OPTIONS");
    expect(await preflight.text()).toBe("");
    // No CORS headers: these routes are for same-origin callers only.
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("methodGuards: without GET there is no HEAD to offer", () => {
    const { notAllowed, options } = methodGuards(["POST"]);
    const request = new Request("http://localhost/api/auth/signout");
    expect(notAllowed(request).headers.get("allow")).toBe("POST, OPTIONS");
    expect(options().headers.get("allow")).toBe("POST, OPTIONS");
  });

  test("unavailable, with and without Retry-After", async () => {
    const plain = unavailable();
    expect(plain.status).toBe(503);
    expect(plain.headers.get("retry-after")).toBeNull();
    expect(await plain.json()).toEqual({
      type: `${site.url}/docs#error-unavailable`,
      title: "Service unavailable",
      status: 503,
      code: "unavailable",
    });

    const retry = unavailable(30, { detail: "GitHub is not answering." });
    expect(retry.headers.get("retry-after")).toBe("30");
    expect(await retry.json()).toMatchObject({
      detail: "GitHub is not answering.",
      resolution: "Try again in 30 seconds.",
    });
  });

  test("overrides replace the code and title of a helper", async () => {
    const body = await unavailable(undefined, {
      code: "accounts_unavailable",
      title: "Accounts are not configured on this deployment",
    }).json();
    expect(body).toMatchObject({
      type: `${site.url}/docs#error-accounts_unavailable`,
      code: "accounts_unavailable",
      title: "Accounts are not configured on this deployment",
    });
  });

  test("no built-in wording mentions the protocol by name", async () => {
    const responses = [
      notFound(),
      badRequest(),
      unauthorized(),
      forbidden(),
      methodNotAllowed(["GET"]),
      unavailable(5),
    ];
    for (const response of responses) {
      expect(await response.text()).not.toMatch(/oauth/i);
    }
  });
});
