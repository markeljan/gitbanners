import { describe, expect, test } from "bun:test";
import { ApiProblem } from "@/hooks/api";
import { accountError } from "./errors";

const context = { repo: "markeljan/gitbanners", max: 3 };

function problem(
  status: number,
  code: string,
  retryAfter: number | null = null,
) {
  return new ApiProblem(status, code, "detail from the server", retryAfter);
}

describe("accountError", () => {
  test("a lost or stale session asks to sign in again", () => {
    expect(accountError(problem(401, "unauthorized"), context).action).toBe(
      "sign-in",
    );
    const changed = accountError(problem(409, "login_changed"), context);
    expect(changed.action).toBe("sign-in");
    expect(changed.message).toContain("Sign in with GitHub again");
  });

  test("the limit names the plan's number and how to raise it", () => {
    const message = accountError(problem(403, "banner_limit_reached"), context);
    expect(message.action).toBe("upgrade");
    expect(message.message).toContain("all 3 saved banners");
    expect(message.message).toContain("star markeljan/gitbanners");
    expect(message.message).toContain("up to 50");
  });

  test("the limit still reads well without a known number", () => {
    const message = accountError(problem(403, "banner_limit_reached"), {
      repo: "a/b",
    });
    expect(message.message).toContain("all your saved banners");
  });

  test("Pro-only actions point at the star", () => {
    const message = accountError(problem(403, "pro_required"), context);
    expect(message.action).toBe("upgrade");
    expect(message.message).toContain("markeljan/gitbanners");
  });

  test("rate limits quote the server's wait", () => {
    const message = accountError(problem(429, "rate_limited", 12), context);
    expect(message.action).toBe("retry");
    expect(message.retryAfter).toBe(12);
    expect(message.message).toBe("Wait 12 seconds, then try again.");
    expect(accountError(problem(429, "rate_limited", 1), context).message).toBe(
      "Wait 1 second, then try again.",
    );
    expect(accountError(problem(429, "rate_limited"), context).message).toBe(
      "Wait a moment, then try again.",
    );
  });

  test("a deployment without accounts is said plainly, with nothing to retry", () => {
    const message = accountError(problem(503, "accounts_unavailable"), context);
    expect(message.action).toBe("none");
    expect(message.message).toContain("Public banners work without an account");
  });

  test("outages and lost connections can be retried", () => {
    expect(accountError(problem(503, "unavailable", 5), context)).toMatchObject(
      {
        action: "retry",
        retryAfter: 5,
      },
    );
    expect(accountError(problem(0, "network"), context).title).toBe(
      "No connection",
    );
    expect(accountError(problem(404, "not_found"), context).title).toBe(
      "Banner not found",
    );
  });

  test("anything else is a generic retry, never the raw server text", () => {
    for (const error of [
      problem(500, "internal_error"),
      new TypeError("boom"),
      "nope",
      null,
    ]) {
      const message = accountError(error, context);
      expect(message.action).toBe("retry");
      expect(message.message).not.toContain("detail from the server");
    }
  });

  test("no message says OAuth", () => {
    const codes = [
      "unauthorized",
      "login_changed",
      "banner_limit_reached",
      "pro_required",
      "rate_limited",
      "accounts_unavailable",
      "unavailable",
      "not_found",
      "network",
    ];
    for (const code of codes) {
      const { title, message } = accountError(problem(400, code), context);
      expect(`${title} ${message}`.toLowerCase()).not.toContain("oauth");
    }
  });
});
