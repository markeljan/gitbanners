import { describe, expect, test } from "bun:test";
import {
  parseSavedBanner,
  problemOf,
  SaveProblem,
  saveMessage,
} from "./saved";

const banner = {
  id: "b0123456789a",
  name: "vercel/next.js: Contributors",
  target: { kind: "repo", owner: "vercel", name: "next.js" },
  preset: "contributors",
  query: "theme=dracula",
  isDefault: false,
  createdAt: "2026-11-13T00:00:00.000Z",
  updatedAt: "2026-11-13T00:00:00.000Z",
};

describe("parseSavedBanner", () => {
  test("accepts the API's shape", () => {
    expect(parseSavedBanner(banner)).toEqual({
      ...banner,
      target: { kind: "repo", owner: "vercel", name: "next.js" },
    });
  });

  test("rejects a broken body", () => {
    expect(() => parseSavedBanner({ ...banner, id: "nope" })).toThrow(
      SaveProblem,
    );
    expect(() =>
      parseSavedBanner({ ...banner, target: { kind: "owner" } }),
    ).toThrow(SaveProblem);
    expect(() => parseSavedBanner(null)).toThrow(SaveProblem);
  });
});

describe("problemOf", () => {
  test("reads code, detail, limit and Retry-After", () => {
    const problem = problemOf(
      403,
      { code: "banner_limit_reached", detail: "Limit", limit: 3 },
      null,
    );
    expect(problem.code).toBe("banner_limit_reached");
    expect(problem.limit).toBe(3);
    expect(problemOf(429, {}, "30").retryAfter).toBe(30);
  });

  test("guesses a code from the status when the body has none", () => {
    expect(problemOf(401, null).code).toBe("unauthorized");
    expect(problemOf(429, null).code).toBe("rate_limited");
    expect(problemOf(503, null).code).toBe("unavailable");
    expect(problemOf(418, null).code).toBe("http_418");
  });
});

describe("saveMessage", () => {
  const free = { limit: 3, isPro: false };
  const of = (code: string, extra: { limit?: number } = {}) =>
    saveMessage(new SaveProblem(403, code, "Detail", extra), free);

  test("each documented code has a sentence and an action", () => {
    expect(of("banner_limit_reached", { limit: 3 })).toMatchObject({
      remedy: "pro",
    });
    expect(of("banner_limit_reached").description).toContain("3 saved");
    expect(of("pro_required").remedy).toBe("pro");
    expect(of("rate_limited").remedy).toBe("retry");
    expect(of("unauthorized").remedy).toBe("sign-in");
    expect(of("login_changed").remedy).toBe("sign-in");
    expect(of("accounts_unavailable").remedy).toBe("retry");
    expect(of("unavailable").remedy).toBe("retry");
    expect(of("not_found").remedy).toBe("save-as-new");
    expect(of("something_new")).toEqual({
      title: "The banner was not saved",
      description: "Detail",
      remedy: "retry",
    });
  });

  test("Pro accounts at their limit are sent to the dashboard", () => {
    const message = saveMessage(
      new SaveProblem(403, "banner_limit_reached", "x", { limit: 50 }),
      { limit: 50, isPro: true },
    );
    expect(message.remedy).toBe("dashboard");
    expect(message.description).toContain("50");
  });

  test("no copy says the forbidden word", () => {
    const codes = [
      "banner_limit_reached",
      "pro_required",
      "rate_limited",
      "unauthorized",
      "accounts_unavailable",
      "not_found",
    ];
    for (const code of codes) {
      const { title, description } = of(code);
      expect(`${title} ${description}`).not.toMatch(/o\s?auth/i);
    }
  });
});
