import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveOptions } from "@/lib/banner";
import { SAMPLE_REPO, SAMPLE_USER } from "@/lib/github/samples";
import { bannerNow, buildBrowserBanner } from "./build";

describe("bannerNow", () => {
  test("is the moment the entity was fetched", () => {
    expect(bannerNow(SAMPLE_USER).toISOString()).toBe(
      new Date(SAMPLE_USER.fetchedAt).toISOString(),
    );
  });
  test("an unreadable timestamp becomes the epoch, never the wall clock", () => {
    expect(bannerNow({ ...SAMPLE_USER, fetchedAt: "" }).getTime()).toBe(0);
    expect(bannerNow({ ...SAMPLE_USER, fetchedAt: "soon" }).getTime()).toBe(0);
  });
});

describe("buildBrowserBanner", () => {
  const options = resolveOptions("user", "overview");

  test("renders the same markup every time: safe to hydrate", () => {
    const first = buildBrowserBanner(SAMPLE_USER, options, "banners.example");
    const second = buildBrowserBanner(SAMPLE_USER, options, "banners.example");
    expect(renderToStaticMarkup(first.element)).toBe(
      renderToStaticMarkup(second.element),
    );
    expect(first.width).toBe(846);
    expect(first.alt).toContain(SAMPLE_USER.login);
  });

  test("prints the given host in the brand mark", () => {
    const built = buildBrowserBanner(SAMPLE_USER, options, "banners.example");
    expect(renderToStaticMarkup(built.element)).toContain(
      `banners.example/${SAMPLE_USER.login}`,
    );
  });

  test("avatars come from GitHub's CDN with a size hint", () => {
    const user = renderToStaticMarkup(
      buildBrowserBanner(SAMPLE_USER, options, "x").element,
    );
    const src = /<img src="([^"]+)"/.exec(user)?.[1].replace(/&amp;/g, "&");
    expect(src).toBeDefined();
    const url = new URL(src ?? "");
    expect(url.hostname).toBe("avatars.githubusercontent.com");
    expect(Number(url.searchParams.get("s"))).toBeGreaterThanOrEqual(112);

    const repo = renderToStaticMarkup(
      buildBrowserBanner(
        SAMPLE_REPO,
        resolveOptions("repo", "contributors"),
        "x",
      ).element,
    );
    expect(repo).toContain("avatars.githubusercontent.com");
  });
});
