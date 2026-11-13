import { describe, expect, test } from "bun:test";
import { missingMessage } from "./missing";

describe("missingMessage", () => {
  test("names the account a missing URL asked for", () => {
    expect(missingMessage("/torvaldz")).toEqual({
      slug: "torvaldz",
      message:
        "No GitHub account named torvaldz. Check the spelling, or try owner/repo.",
    });
  });
  test("names the repository, ignoring a preset", () => {
    const missing = missingMessage("/vercel/nextjs/contributors");
    expect(missing?.slug).toBe("vercel/nextjs");
    expect(missing?.message).toContain(
      "No public repository named vercel/nextjs",
    );
  });
  test("says nothing for addresses that are not banner paths", () => {
    expect(missingMessage(null)).toBeNull();
    expect(missingMessage("/")).toBeNull();
    expect(missingMessage("/docs/nope/deeper/still")).toBeNull();
    expect(missingMessage("/wp-login.php")).toBeNull();
  });
});
