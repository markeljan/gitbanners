import { describe, expect, test } from "bun:test";
import {
  isOwnProfile,
  markDefault,
  nameProblem,
  parseBannerBody,
  parseBannerList,
  presetName,
  removeBanner,
  renameBanner,
  replaceBanner,
  type SavedBanner,
  savedBannerAlt,
  savedImageSrc,
  savedSnippets,
} from "./saved-banners";

function banner(id: string, overrides: Partial<SavedBanner> = {}): SavedBanner {
  return {
    id,
    name: `Banner ${id}`,
    target: { kind: "owner", login: "markeljan" },
    preset: null,
    query: "",
    isDefault: false,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-02T10:00:00.000Z",
    ...overrides,
  };
}

const list = [
  banner("b000000000a1", { isDefault: true }),
  banner("b000000000b2", {
    target: { kind: "repo", owner: "vercel", name: "next.js" },
    preset: "contributors",
  }),
  banner("b000000000c3"),
];

describe("parsing", () => {
  test("reads the list body", () => {
    const parsed = parseBannerList({ banners: list });
    expect(parsed).toEqual(list);
  });

  test("drops unknown fields and keeps targets exact", () => {
    const [first] = parseBannerList({
      banners: [{ ...list[1], userId: "1", extra: true }],
    });
    expect(first).toEqual(list[1]);
    expect("userId" in first).toBe(false);
  });

  test("rejects bodies that are not a banner list", () => {
    expect(() => parseBannerList({})).toThrow();
    expect(() => parseBannerList({ banners: [{ id: "x" }] })).toThrow();
    expect(() =>
      parseBannerList({
        banners: [{ ...list[0], target: { kind: "org", login: "x" } }],
      }),
    ).toThrow();
  });

  test("reads a single-banner body", () => {
    expect(parseBannerBody({ banner: list[2] })).toEqual(list[2]);
    expect(() => parseBannerBody(null)).toThrow();
  });
});

describe("optimistic updates", () => {
  test("rename changes one name and keeps the order", () => {
    const next = renameBanner(list, "b000000000b2", "Next.js team");
    expect(next.map((item) => item.id)).toEqual(list.map((item) => item.id));
    expect(next[1].name).toBe("Next.js team");
    expect(next[0]).toBe(list[0]);
    expect(list[1].name).toBe("Banner b000000000b2");
  });

  test("remove drops exactly one banner", () => {
    const next = removeBanner(list, "b000000000a1");
    expect(next.map((item) => item.id)).toEqual([
      "b000000000b2",
      "b000000000c3",
    ]);
    expect(list).toHaveLength(3);
    expect(removeBanner(list, "missing")).toEqual(list);
  });

  test("there is at most one default", () => {
    const next = markDefault(list, "b000000000c3");
    expect(
      next.filter((item) => item.isDefault).map((item) => item.id),
    ).toEqual(["b000000000c3"]);
    // Unchanged banners keep their identity, so React skips them.
    expect(next[1]).toBe(list[1]);
  });

  test("clearing the default leaves none", () => {
    expect(markDefault(list, null).some((item) => item.isDefault)).toBe(false);
  });

  test("the server's copy replaces the optimistic one in place", () => {
    const fromServer = {
      ...list[1],
      name: "Saved",
      updatedAt: "2026-11-13T00:00:00.000Z",
    };
    const next = replaceBanner(list, fromServer);
    expect(next[1]).toBe(fromServer);
    expect(next).toHaveLength(3);
  });
});

describe("facts for the UI", () => {
  test("preset names, with the default preset of the kind", () => {
    expect(presetName(list[0])).toBe("Overview");
    expect(presetName(list[1])).toBe("Contributors");
    expect(presetName(banner("x", { preset: "repos" }))).toBe(
      "Top repositories",
    );
    expect(presetName(banner("x", { preset: "unknown" }))).toBe("unknown");
  });

  test("alt text says what the image shows", () => {
    expect(savedBannerAlt(list[1])).toBe(
      "Contributors banner for vercel/next.js",
    );
  });

  test("only the user's own profile can be the profile default", () => {
    expect(isOwnProfile(list[0], "MarkelJan")).toBe(true);
    expect(isOwnProfile(list[0], "someone")).toBe(false);
    expect(isOwnProfile(list[1], "vercel")).toBe(false);
  });

  test("snippets embed the saved URL and link the target's page", () => {
    const snippets = savedSnippets(list[1], "https://gitbanners.com/");
    expect(snippets.url).toBe("https://gitbanners.com/b/b000000000b2.svg");
    expect(snippets.markdown).toBe(
      "[![Contributors banner for vercel/next.js](https://gitbanners.com/b/b000000000b2.svg)](https://gitbanners.com/vercel/next.js)",
    );
    expect(savedSnippets(list[1], "https://gitbanners.com", "png").url).toBe(
      "https://gitbanners.com/b/b000000000b2.png",
    );
  });

  test("the grid image changes URL whenever the banner changes", () => {
    const before = savedImageSrc(list[0]);
    const after = savedImageSrc({
      ...list[0],
      updatedAt: "2026-11-03T10:00:00.000Z",
    });
    expect(before.startsWith("/b/b000000000a1.svg?v=")).toBe(true);
    expect(after).not.toBe(before);
    expect(savedImageSrc({ id: "b1", updatedAt: "garbage" })).toBe("/b/b1.svg");
  });
});

describe("nameProblem", () => {
  test("accepts what the API accepts", () => {
    expect(nameProblem("README header")).toBeNull();
    expect(nameProblem("  padded  ")).toBeNull();
    expect(nameProblem("x".repeat(60))).toBeNull();
  });
  test("refuses what the API refuses, with a sentence", () => {
    expect(nameProblem("   ")).toBe("Give the banner a name.");
    expect(nameProblem("x".repeat(61))).toBe("Use at most 60 characters.");
    expect(nameProblem("two\nlines")).toBe("Use one line of text.");
  });
});
