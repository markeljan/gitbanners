import { describe, expect, test } from "bun:test";
import { SAMPLE_ORG, SAMPLE_REPO, SAMPLE_USER } from "@/lib/github/samples";
import type { Entity } from "@/lib/github/schema";
import {
  decidePage,
  decodeSegments,
  indexedTargets,
  parsePagePath,
  prerenderedParams,
  targetKey,
} from "./resolve";

/** What a request answers, given the path and GitHub's answer. */
function decide(path: string, entity: Entity | null) {
  const segments = path.split("/").filter(Boolean);
  const parsed = parsePagePath(segments);
  if (!parsed) return { type: "not-a-path" } as const;
  const decision = decidePage(segments, parsed, entity);
  return decision.type === "page"
    ? ({
        type: "page",
        preset: decision.preset.id,
        path: decision.path,
      } as const)
    : decision;
}

const renamed: Entity = {
  ...SAMPLE_REPO,
  owner: { ...SAMPLE_REPO.owner, login: "react" },
  name: "react",
  fullName: "react/react",
};

describe("parsePagePath", () => {
  test.each([
    [[]],
    [["a", "b", "c", "d"]],
    [["docs"]],
    [["pricing", "x"]],
    [["-bad"]],
    [["vercel.svg"]],
    [["vercel", "next.js.png"]],
    [["vercel", "bad name"]],
  ])("%p is never a page", (segments) => {
    expect(parsePagePath(segments)).toBeNull();
  });

  test("the @ escape reaches a reserved login", () => {
    expect(parsePagePath(["@docs"])?.target).toEqual({
      kind: "owner",
      login: "docs",
    });
  });
});

describe("decidePage", () => {
  test("canonical paths are pages", () => {
    expect(decide("/markeljan", SAMPLE_USER)).toEqual({
      type: "page",
      preset: "overview",
      path: "/markeljan",
    });
    expect(decide("/markeljan/activity", SAMPLE_USER)).toEqual({
      type: "page",
      preset: "activity",
      path: "/markeljan/activity",
    });
    expect(decide("/vercel/repos", SAMPLE_ORG)).toMatchObject({
      type: "page",
      preset: "repos",
    });
    expect(decide("/vercel/next.js", SAMPLE_REPO)).toMatchObject({
      type: "page",
      path: "/vercel/next.js",
    });
    expect(decide("/vercel/next.js/contributors", SAMPLE_REPO)).toMatchObject({
      type: "page",
      preset: "contributors",
    });
  });

  test("unknown targets and presets of another kind are 404s", () => {
    expect(decide("/nobody-here", null)).toEqual({ type: "not-found" });
    expect(decide("/vercel/nope", null)).toEqual({ type: "not-found" });
    // Organizations have no streak, users no contributors preset.
    expect(decide("/vercel/streak", SAMPLE_ORG)).toEqual({
      type: "not-found",
    });
    expect(decide("/vercel/next.js/streak", SAMPLE_REPO)).toEqual({
      type: "not-found",
    });
    expect(decide("/vercel/next.js/nonsense", SAMPLE_REPO)).toEqual({
      type: "not-found",
    });
    // A data layer that answered with the wrong kind is not trusted.
    expect(decide("/markeljan", SAMPLE_REPO)).toEqual({ type: "not-found" });
  });

  test("non-canonical spellings redirect to the canonical path", () => {
    expect(decide("/MarkelJan", SAMPLE_USER)).toEqual({
      type: "redirect",
      location: "/markeljan",
    });
    expect(decide("/markeljan/Activity", SAMPLE_USER)).toEqual({
      type: "redirect",
      location: "/markeljan/activity",
    });
    expect(decide("/markeljan/overview", SAMPLE_USER)).toEqual({
      type: "redirect",
      location: "/markeljan",
    });
    expect(decide("/@vercel", SAMPLE_ORG)).toEqual({
      type: "redirect",
      location: "/vercel",
    });
    expect(decide("/Vercel/Next.JS/overview", SAMPLE_REPO)).toEqual({
      type: "redirect",
      location: "/vercel/next.js",
    });
    expect(decide("/vercel/next.js.git", SAMPLE_REPO)).toEqual({
      type: "redirect",
      location: "/vercel/next.js",
    });
  });

  test("a renamed repository redirects to its new home", () => {
    expect(decide("/facebook/react", renamed)).toEqual({
      type: "redirect",
      location: "/react/react",
    });
    expect(decide("/facebook/react/contributors", renamed)).toEqual({
      type: "redirect",
      location: "/react/react/contributors",
    });
  });

  test("a redirect target is a fixed point: never a chain or a loop", () => {
    const cases: [string, Entity][] = [
      ["/MarkelJan/Activity", SAMPLE_USER],
      ["/@vercel/overview", SAMPLE_ORG],
      ["/VERCEL/NEXT.JS/Activity", SAMPLE_REPO],
      ["/facebook/react", renamed],
    ];
    for (const [path, entity] of cases) {
      const first = decide(path, entity);
      expect(first.type).toBe("redirect");
      if (first.type !== "redirect") continue;
      expect(decide(first.location, entity)).toMatchObject({
        type: "page",
        path: first.location,
      });
    }
  });

  test("a repository whose name ends in .md lives under its preset", () => {
    // `/jasonnor/README.md` is the Markdown of the repository "README"
    // (next.config.ts), so the page of "README.md" is never written that way.
    const readme: Entity = {
      ...SAMPLE_REPO,
      owner: { ...SAMPLE_REPO.owner, login: "Jasonnor" },
      name: "README.md",
      fullName: "Jasonnor/README.md",
    };
    expect(decide("/jasonnor/README.md/overview", readme)).toEqual({
      type: "page",
      preset: "overview",
      path: "/jasonnor/README.md/overview",
    });
    expect(decide("/jasonnor/README.md/activity", readme)).toMatchObject({
      type: "page",
      path: "/jasonnor/README.md/activity",
    });
    for (const path of [
      "/jasonnor/README.md",
      "/Jasonnor/readme.MD/Overview",
      "/jasonnor/README.md.git",
    ]) {
      const first = decide(path, readme);
      expect(first).toEqual({
        type: "redirect",
        location: "/jasonnor/README.md/overview",
      });
      if (first.type !== "redirect") continue;
      expect(decide(first.location, readme)).toMatchObject({ type: "page" });
    }
  });

  test("a login that collides with a route keeps its @", () => {
    const docs: Entity = { ...SAMPLE_ORG, login: "docs" };
    expect(decide("/@docs", docs)).toMatchObject({
      type: "page",
      path: "/@docs",
    });
    expect(decide("/@Docs", docs)).toEqual({
      type: "redirect",
      location: "/@docs",
    });
  });
});

describe("indexedTargets", () => {
  test("collects showcase targets, whatever the preset or query", () => {
    const keys = indexedTargets(
      ["/torvalds?size=x", "/vercel/next.js/activity", "/Microsoft/repos"],
      [{ kind: "owner", login: "markeljan" }],
    );
    expect([...keys].sort()).toEqual([
      "markeljan",
      "microsoft",
      "torvalds",
      "vercel/next.js",
    ]);
    expect(keys.has(targetKey({ kind: "owner", login: "Torvalds" }))).toBe(
      true,
    );
  });
});

describe("prerenderedParams", () => {
  test("only bundled targets, split by route, without duplicates", () => {
    const bundled = new Set(["torvalds", "vercel/next.js"]);
    const params = prerenderedParams(
      [
        "/torvalds",
        "/torvalds?size=x",
        "/torvalds/wrapped?year=2025",
        "/vercel/next.js",
        "/vercel/next.js/activity",
        "/gaearon/stats",
      ],
      (target) => bundled.has(targetKey(target)),
    );
    expect(params.owners).toEqual([{ owner: "torvalds" }]);
    expect(params.rests).toEqual([
      { owner: "torvalds", rest: ["wrapped"] },
      { owner: "vercel", rest: ["next.js"] },
      { owner: "vercel", rest: ["next.js", "activity"] },
    ]);
  });
});

describe("decodeSegments", () => {
  test("decodes the @ escape and keeps undecodable text", () => {
    expect(decodeSegments(["%40docs", "next.js"])).toEqual([
      "@docs",
      "next.js",
    ]);
    expect(decodeSegments(["%E0%A4%A"])).toEqual(["%E0%A4%A"]);
  });
});
