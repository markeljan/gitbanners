import { describe, expect, test } from "bun:test";
import {
  ApiProblem,
  failureOf,
  parseRetryAfter,
  problemFromResponse,
} from "./api";

describe("parseRetryAfter", () => {
  test("reads delta seconds", () => {
    expect(parseRetryAfter("30")).toBe(30);
    expect(parseRetryAfter(" 5 ")).toBe(5);
  });
  test("ignores anything else", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT")).toBeNull();
    expect(parseRetryAfter("-3")).toBeNull();
  });
});

describe("problemFromResponse", () => {
  test("keeps code, detail and retry delay of a problem body", () => {
    const problem = problemFromResponse(
      404,
      { code: "not_found", title: "Not found", detail: "No such user." },
      "12",
    );
    expect(problem).toBeInstanceOf(ApiProblem);
    expect(problem.status).toBe(404);
    expect(problem.code).toBe("not_found");
    expect(problem.message).toBe("No such user.");
    expect(problem.retryAfter).toBe(12);
  });
  test("falls back to the title, then to the status", () => {
    expect(problemFromResponse(503, { title: "Unavailable" }).message).toBe(
      "Unavailable",
    );
    const bare = problemFromResponse(502, "<html>bad gateway</html>");
    expect(bare.code).toBe("http_502");
    expect(bare.message).toContain("502");
    expect(bare.retryAfter).toBeNull();
  });
});

describe("failureOf", () => {
  test("404 is a fact, not an outage", () => {
    expect(failureOf(new ApiProblem(404, "not_found", "x"))).toBe("not_found");
  });
  test("429 and an upstream limit both mean rate limited", () => {
    expect(failureOf(new ApiProblem(429, "rate_limited", "x"))).toBe(
      "rate_limited",
    );
    expect(failureOf(new ApiProblem(503, "upstream_rate_limited", "x"))).toBe(
      "rate_limited",
    );
  });
  test("400 and 422 are invalid input", () => {
    expect(failureOf(new ApiProblem(400, "invalid_request", "x"))).toBe(
      "invalid",
    );
    expect(failureOf(new ApiProblem(422, "invalid_body", "x"))).toBe("invalid");
  });
  test("everything else is unavailable", () => {
    expect(failureOf(new ApiProblem(503, "upstream_unavailable", "x"))).toBe(
      "unavailable",
    );
    expect(failureOf(new ApiProblem(0, "network", "x"))).toBe("unavailable");
    expect(failureOf(new TypeError("boom"))).toBe("unavailable");
    expect(failureOf("nope")).toBe("unavailable");
  });
  test("an aborted fetch is recognised in both shapes", () => {
    expect(failureOf(new DOMException("Aborted", "AbortError"))).toBe(
      "aborted",
    );
    expect(failureOf({ name: "AbortError" })).toBe("aborted");
  });
});
