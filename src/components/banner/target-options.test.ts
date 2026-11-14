import { describe, expect, test } from "bun:test";
import type { Suggestion } from "@/lib/github/schema";
import {
  buildOptionGroups,
  findOption,
  moveActive,
  optionForTarget,
  POPULAR_TARGETS,
  type TargetOption,
  targetFromUrl,
} from "./target-options";

const option = (slug: string, kind: TargetOption["kind"]): TargetOption => ({
  slug,
  kind,
  title: null,
  avatarUrl: null,
  stars: null,
});
const suggestion: Suggestion = {
  kind: "org",
  slug: "vercel",
  title: "Vercel",
  avatarUrl: "https://avatars.githubusercontent.com/u/14985020?v=4",
  stars: null,
};

describe("buildOptionGroups", () => {
  test("text shows the search results, and only those", () => {
    const groups = buildOptionGroups({
      text: "verc",
      suggestions: [suggestion],
      recents: [option("torvalds", "user")],
      popular: POPULAR_TARGETS,
    });
    expect(groups).toEqual([
      { id: "results", label: null, options: [suggestion] },
    ]);
  });
  test("text without results shows nothing", () => {
    expect(
      buildOptionGroups({
        text: "zzzz",
        suggestions: [],
        recents: [option("torvalds", "user")],
        popular: POPULAR_TARGETS,
      }),
    ).toEqual([]);
  });
  test("an empty field offers popular examples", () => {
    const groups = buildOptionGroups({
      text: "  ",
      suggestions: [suggestion],
      recents: [],
      popular: POPULAR_TARGETS,
    });
    expect(groups.map((group) => group.id)).toEqual(["popular"]);
    expect(groups[0].options).toEqual(POPULAR_TARGETS);
  });
  test("recent targets come first and are not repeated as popular", () => {
    const groups = buildOptionGroups({
      text: "",
      suggestions: [],
      recents: [option("Torvalds", "user"), option("shadcn", "user")],
      popular: POPULAR_TARGETS,
    });
    expect(groups.map((group) => group.id)).toEqual(["recent", "popular"]);
    expect(groups[1].options.map((item) => item.slug)).not.toContain(
      "torvalds",
    );
    expect(groups[1].options).toHaveLength(POPULAR_TARGETS.length - 1);
  });
  test("when every popular target is recent the popular group is dropped", () => {
    const groups = buildOptionGroups({
      text: "",
      suggestions: [],
      recents: [option("torvalds", "user")],
      popular: [option("torvalds", "user")],
    });
    expect(groups.map((group) => group.id)).toEqual(["recent"]);
  });
});

describe("moveActive", () => {
  test("from nothing: down takes the first row, up the last", () => {
    expect(moveActive(-1, 5, 1)).toBe(0);
    expect(moveActive(-1, 5, -1)).toBe(4);
  });
  test("steps and wraps at both ends", () => {
    expect(moveActive(0, 5, 1)).toBe(1);
    expect(moveActive(4, 5, 1)).toBe(0);
    expect(moveActive(0, 5, -1)).toBe(4);
    expect(moveActive(3, 5, -1)).toBe(2);
  });
  test("an empty list has no active row", () => {
    expect(moveActive(-1, 0, 1)).toBe(-1);
    expect(moveActive(2, 0, -1)).toBe(-1);
  });
  test("a stale index beyond a shorter list starts over", () => {
    expect(moveActive(7, 3, 1)).toBe(0);
    expect(moveActive(7, 3, -1)).toBe(2);
  });
});

describe("targetFromUrl", () => {
  test("reads account and repository addresses", () => {
    expect(targetFromUrl("https://github.com/facebook/react")).toEqual({
      kind: "repo",
      owner: "facebook",
      name: "react",
    });
    expect(targetFromUrl("https://github.com/torvalds")).toEqual({
      kind: "owner",
      login: "torvalds",
    });
    expect(targetFromUrl("  github.com/vercel/next.js  ")).toEqual({
      kind: "repo",
      owner: "vercel",
      name: "next.js",
    });
  });
  test("ignores what follows the repository", () => {
    expect(
      targetFromUrl(
        "https://github.com/vercel/next.js/tree/canary/docs?plain=1#readme",
      ),
    ).toEqual({ kind: "repo", owner: "vercel", name: "next.js" });
    expect(
      targetFromUrl("https://github.com/sindresorhus?tab=repositories"),
    ).toEqual({ kind: "owner", login: "sindresorhus" });
    expect(targetFromUrl("https://github.com/vercel/next.js.git")).toEqual({
      kind: "repo",
      owner: "vercel",
      name: "next.js",
    });
  });
  test("an organization's own pages point at the organization", () => {
    expect(targetFromUrl("https://github.com/orgs/vercel/people")).toEqual({
      kind: "owner",
      login: "vercel",
    });
    expect(targetFromUrl("https://github.com/orgs")).toBeNull();
  });
  test("plain slugs and other sites are left to normal typing", () => {
    expect(targetFromUrl("torvalds")).toBeNull();
    expect(targetFromUrl("vercel/next.js")).toBeNull();
    expect(targetFromUrl("https://gitlab.com/foo/bar")).toBeNull();
    expect(targetFromUrl("https://github.com/")).toBeNull();
  });
});

describe("findOption and optionForTarget", () => {
  test("finds the row of a typed target without case", () => {
    const rows = [option("Vercel", "org"), option("vercel/next.js", "repo")];
    expect(findOption(rows, { kind: "owner", login: "vercel" })).toBe(rows[0]);
    expect(
      findOption(rows, { kind: "repo", owner: "Vercel", name: "Next.js" }),
    ).toBe(rows[1]);
    expect(findOption(rows, { kind: "owner", login: "torvalds" })).toBeNull();
  });
  test("a target the list does not know still gets a row to remember", () => {
    expect(optionForTarget({ kind: "owner", login: "torvalds" })).toEqual({
      slug: "torvalds",
      kind: "user",
      title: null,
      avatarUrl: "https://github.com/torvalds.png?size=64",
      stars: null,
    });
    const repo = optionForTarget({
      kind: "repo",
      owner: "vercel",
      name: "next.js",
    });
    expect(repo.kind).toBe("repo");
    expect(repo.slug).toBe("vercel/next.js");
    expect(repo.avatarUrl).toBe("https://github.com/vercel.png?size=64");
  });
});
