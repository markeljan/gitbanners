import { describe, expect, test } from "bun:test";
import type { Suggestion } from "@/lib/github/schema";
import {
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
