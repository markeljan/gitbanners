import { describe, expect, test } from "bun:test";
import type { Suggestion } from "@/lib/github/schema";
import {
  createAnswerStore,
  extendsQuery,
  matchesQuery,
  normalizeSearchText,
  searchUrl,
} from "./use-suggestions";

describe("normalizeSearchText", () => {
  test("lower-cases and trims a login prefix", () => {
    expect(normalizeSearchText("  Verc ")).toBe("verc");
    expect(normalizeSearchText("@verc")).toBe("verc");
  });
  test("needs two characters", () => {
    expect(normalizeSearchText("")).toBeNull();
    expect(normalizeSearchText("v")).toBeNull();
    expect(normalizeSearchText("@v")).toBeNull();
  });
  test("accepts owner/prefix, including an empty prefix", () => {
    expect(normalizeSearchText("vercel/")).toBe("vercel/");
    expect(normalizeSearchText("Vercel/Ne")).toBe("vercel/ne");
    expect(normalizeSearchText("vercel/next.js")).toBe("vercel/next.js");
  });
  test("reads a pasted github.com URL and drops what follows the name", () => {
    expect(normalizeSearchText("https://github.com/vercel/next.js")).toBe(
      "vercel/next.js",
    );
    expect(
      normalizeSearchText("github.com/vercel/next.js/tree/canary/docs"),
    ).toBe("vercel/next.js");
    expect(normalizeSearchText("https://www.github.com/torvalds")).toBe(
      "torvalds",
    );
  });
  test("rejects text that cannot be a login or repository name", () => {
    expect(normalizeSearchText("two words")).toBeNull();
    expect(normalizeSearchText("-dash")).toBeNull();
    expect(normalizeSearchText("user:secret")).toBeNull();
    expect(normalizeSearchText("vercel/ne xt")).toBeNull();
    expect(normalizeSearchText('ver"c')).toBeNull();
    expect(normalizeSearchText("a".repeat(40))).toBeNull();
  });
});

describe("searchUrl", () => {
  test("encodes the query", () => {
    expect(searchUrl("verc")).toBe("/api/v1/search?q=verc");
    expect(searchUrl("vercel/ne")).toBe("/api/v1/search?q=vercel%2Fne");
  });
});

describe("matchesQuery", () => {
  const item = (kind: Suggestion["kind"], slug: string): Suggestion => ({
    kind,
    slug,
    title: null,
    avatarUrl: "",
    stars: null,
  });
  test("accounts match a login that contains the text", () => {
    expect(matchesQuery(item("user", "Vercidium"), "verc")).toBe(true);
    expect(matchesQuery(item("org", "vercel"), "vercel")).toBe(true);
    expect(matchesQuery(item("user", "vertx"), "verc")).toBe(false);
  });
  test("an account never matches a repository query, and the reverse", () => {
    expect(matchesQuery(item("org", "vercel"), "vercel/")).toBe(false);
    expect(matchesQuery(item("repo", "vercel/next.js"), "vercel")).toBe(false);
  });
  test("repositories match within the typed owner", () => {
    expect(matchesQuery(item("repo", "vercel/next.js"), "vercel/")).toBe(true);
    expect(matchesQuery(item("repo", "vercel/next.js"), "vercel/ne")).toBe(
      true,
    );
    expect(matchesQuery(item("repo", "vercel/swr"), "vercel/ne")).toBe(false);
    expect(matchesQuery(item("repo", "vercel-labs/next"), "vercel/ne")).toBe(
      false,
    );
  });
});

describe("extendsQuery", () => {
  test("typing forward extends the earlier query", () => {
    expect(extendsQuery("torvalds", "torv")).toBe(true);
    expect(extendsQuery("torv", "torv")).toBe(true);
    expect(extendsQuery("vercel/next", "vercel/ne")).toBe(true);
    expect(extendsQuery("vercel/", "vercel/")).toBe(true);
  });
  test("deleting or changing the text does not", () => {
    expect(extendsQuery("tor", "torv")).toBe(false);
    expect(extendsQuery("torx", "torv")).toBe(false);
  });
  test("a login prefix says nothing about that owner's repositories", () => {
    expect(extendsQuery("vercel/ne", "vercel")).toBe(false);
    expect(extendsQuery("vercel/", "ver")).toBe(false);
  });
});

describe("createAnswerStore", () => {
  const answer = (query: string, slugs: string[]) => ({
    query,
    suggestions: slugs.map((slug) => ({
      kind: slug.includes("/") ? ("repo" as const) : ("user" as const),
      slug,
      title: null,
      avatarUrl: "",
      stars: null,
    })),
  });

  test("prefers the exact answer", () => {
    const store = createAnswerStore();
    store.add(answer("tor", ["torvalds", "tornado"]));
    store.add(answer("torv", ["torvalds"]));
    expect(store.best("torv")?.query).toBe("torv");
  });
  test("falls back to the longest answered prefix", () => {
    const store = createAnswerStore();
    store.add(answer("to", ["tom"]));
    store.add(answer("torv", ["torvalds"]));
    store.add(answer("tor", ["torvalds", "tornado"]));
    expect(store.best("torvalds")?.query).toBe("torv");
    expect(store.best("tornado")?.query).toBe("tor");
    expect(store.best("tx")).toBeNull();
  });
  test("never answers a repository query from account results", () => {
    const store = createAnswerStore();
    store.add(answer("vercel", ["vercel"]));
    expect(store.best("vercel/ne")).toBeNull();
    store.add(answer("vercel/", ["vercel/next.js"]));
    expect(store.best("vercel/ne")?.query).toBe("vercel/");
  });
  test("notifies subscribers and bumps the version on every answer", () => {
    const store = createAnswerStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    const before = store.version();
    store.add(answer("ab", []));
    expect(calls).toBe(1);
    expect(store.version()).toBe(before + 1);
    unsubscribe();
    store.add(answer("abc", []));
    expect(calls).toBe(1);
  });
  test("forgets the oldest answers beyond its limit, keeping re-asked ones", () => {
    const store = createAnswerStore(2);
    store.add(answer("aa", []));
    store.add(answer("bb", []));
    store.add(answer("aa", ["aa-again"]));
    store.add(answer("cc", []));
    expect(store.best("bb")).toBeNull();
    expect(store.best("aa")?.suggestions).toHaveLength(1);
    expect(store.best("cc")?.query).toBe("cc");
  });
});
