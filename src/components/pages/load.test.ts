/**
 * `loadPage` / `loadMetadata` decide what an owner or repository address
 * shows. The contract under test: nothing but a redirect is thrown, so a
 * 404 or a GitHub outage never becomes Next's empty error document.
 */
import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import * as cached from "@/lib/github/cached";
import { GitHubError } from "@/lib/github/errors";
import { SAMPLE_ORG } from "@/lib/github/samples";
import { loadMetadata, loadPage } from "./load";

const getEntity = spyOn(cached, "getEntity");

afterEach(() => {
  getEntity.mockReset();
});

afterAll(() => {
  getEntity.mockRestore();
});

describe("loadPage", () => {
  test("a banner page", async () => {
    getEntity.mockResolvedValue(SAMPLE_ORG);
    const result = await loadPage(["vercel"]);
    expect(result.type).toBe("page");
    if (result.type !== "page") return;
    expect(result.page.entity).toBe(SAMPLE_ORG);
    expect(result.page.path).toBe("/vercel");
  });

  test("a path that is no banner page is not found, without asking GitHub", async () => {
    expect(await loadPage(["vercel", "a", "b", "c", "d"])).toEqual({
      type: "not-found",
    });
    expect(getEntity).not.toHaveBeenCalled();
  });

  test("an unknown account is not found, not thrown", async () => {
    getEntity.mockResolvedValue(null);
    expect(await loadPage(["zz-nope-user"])).toEqual({ type: "not-found" });
  });

  test("a preset the kind does not have is not found", async () => {
    getEntity.mockResolvedValue(SAMPLE_ORG);
    expect(await loadPage(["vercel", "streak"])).toEqual({
      type: "not-found",
    });
  });

  test.each([
    new GitHubError("unavailable", "down"),
    new GitHubError("rate_limited", "slow down", { retryAfter: 60 }),
    new GitHubError("forbidden", "bad token"),
  ])("a GitHub failure ($code) is a result, not an error", async (error) => {
    getEntity.mockRejectedValue(error);
    const result = await loadPage(["react", "react"]);
    expect(result).toMatchObject({
      type: "unavailable",
      retryPath: "/react/react",
    });
    if (result.type !== "unavailable") return;
    expect(result.error.code).toBe(error.code);
  });

  test("a GitHub failure that crossed a cache boundary (digest only) too", async () => {
    const transported = Object.assign(new Error("An error occurred"), {
      digest: "GITHUB_ERROR;unavailable;503;",
    });
    getEntity.mockRejectedValue(transported);
    const result = await loadPage(["react", "react"]);
    expect(result.type).toBe("unavailable");
  });

  test("any other error is still thrown", async () => {
    getEntity.mockRejectedValue(new TypeError("bug"));
    await expect(loadPage(["vercel"])).rejects.toThrow("bug");
  });
});

describe("loadMetadata", () => {
  test("a 404 gets a title and stays out of the index", async () => {
    getEntity.mockResolvedValue(null);
    const metadata = await loadMetadata(["zz-nope-user"]);
    expect(metadata.title).toBe("Page not found");
    expect(metadata.robots).toMatchObject({ index: false });
  });

  test("a GitHub outage gets a title and stays out of the index", async () => {
    getEntity.mockRejectedValue(new GitHubError("unavailable", "down"));
    const metadata = await loadMetadata(["react", "react"]);
    expect(metadata.title).toBe("GitHub is not answering");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  test("a banner page gets its own metadata", async () => {
    getEntity.mockResolvedValue(SAMPLE_ORG);
    const metadata = await loadMetadata(["vercel"]);
    expect(String(metadata.title)).toContain("Vercel");
  });
});
