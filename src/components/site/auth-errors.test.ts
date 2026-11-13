import { describe, expect, test } from "bun:test";
import {
  AUTH_ERROR_MESSAGES,
  authErrorMessage,
  withoutAuthError,
} from "./auth-errors";

/** Every code the sign-in callback can send (src/app/api/auth/github/callback/route.ts). */
const CODES = [
  "state_mismatch",
  "access_denied",
  "github_error",
  "missing_code",
  "expired_code",
  "rate_limited",
  "accounts_unavailable",
  "sign_in_failed",
];

describe("authErrorMessage", () => {
  test("has its own sentence for every code", () => {
    const sentences = CODES.map(authErrorMessage);
    expect(new Set(sentences).size).toBe(CODES.length);
    for (const sentence of sentences) {
      expect(sentence.length).toBeGreaterThan(30);
      expect(sentence.endsWith(".")).toBe(true);
      // Product rule: the protocol's name never reaches a visitor.
      expect(sentence).not.toMatch(/oauth/i);
      expect(sentence).not.toContain("—");
    }
    expect(Object.keys(AUTH_ERROR_MESSAGES).sort()).toEqual([...CODES].sort());
  });
  test("an unknown code still explains itself", () => {
    expect(authErrorMessage("something_new")).toContain("Sign-in");
    // Not an own property: must not leak Object.prototype.
    expect(authErrorMessage("toString")).toContain("Sign-in");
    expect(authErrorMessage("")).toContain("Sign-in");
  });
});

describe("withoutAuthError", () => {
  test("drops the parameter and keeps the rest of the address", () => {
    expect(
      withoutAuthError(
        "https://x.test/studio?target=vercel&auth_error=access_denied#top",
      ),
    ).toBe("/studio?target=vercel#top");
    expect(withoutAuthError("https://x.test/?auth_error=rate_limited")).toBe(
      "/",
    );
  });
  test("is null when there is nothing to drop", () => {
    expect(withoutAuthError("https://x.test/studio?target=vercel")).toBeNull();
  });
});
