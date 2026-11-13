import { describe, expect, test } from "bun:test";
import {
  addRecentTarget,
  MAX_RECENT_TARGETS,
  parseRecentTargets,
  type RecentTarget,
} from "./use-recent-targets";

const recent = (slug: string): RecentTarget => ({
  slug,
  kind: slug.includes("/") ? "repo" : "user",
  title: null,
  avatarUrl: null,
});

describe("parseRecentTargets", () => {
  test("reads a stored list", () => {
    const stored = [recent("torvalds"), recent("vercel/next.js")];
    expect(parseRecentTargets(JSON.stringify(stored))).toEqual(stored);
  });
  test("nothing stored, broken JSON or another shape is an empty list", () => {
    expect(parseRecentTargets(null)).toEqual([]);
    expect(parseRecentTargets("")).toEqual([]);
    expect(parseRecentTargets("{not json")).toEqual([]);
    expect(parseRecentTargets('{"slug":"torvalds"}')).toEqual([]);
  });
  test("drops entries that do not match and keeps the rest", () => {
    const raw = JSON.stringify([
      recent("torvalds"),
      { slug: "", kind: "user", title: null, avatarUrl: null },
      { slug: "x", kind: "team", title: null, avatarUrl: null },
      "vercel",
      recent("vercel"),
    ]);
    expect(parseRecentTargets(raw).map((item) => item.slug)).toEqual([
      "torvalds",
      "vercel",
    ]);
  });
  test("never returns more than the maximum", () => {
    const many = Array.from({ length: 12 }, (_, at) => recent(`user-${at}`));
    expect(parseRecentTargets(JSON.stringify(many))).toHaveLength(
      MAX_RECENT_TARGETS,
    );
  });
});

describe("addRecentTarget", () => {
  test("puts the newest first", () => {
    const list = addRecentTarget([recent("vercel")], recent("torvalds"));
    expect(list.map((item) => item.slug)).toEqual(["torvalds", "vercel"]);
  });
  test("replaces an older copy, whatever its capitalisation", () => {
    const fresh = {
      ...recent("Vercel"),
      kind: "org" as const,
      title: "Vercel",
    };
    const list = addRecentTarget([recent("torvalds"), recent("vercel")], fresh);
    expect(list).toEqual([fresh, recent("torvalds")]);
  });
  test("caps the list", () => {
    let list: RecentTarget[] = [];
    for (let at = 0; at < 9; at++) {
      list = addRecentTarget(list, recent(`user-${at}`));
    }
    expect(list).toHaveLength(MAX_RECENT_TARGETS);
    expect(list[0].slug).toBe("user-8");
  });
});
