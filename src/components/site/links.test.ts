import { describe, expect, test } from "bun:test";
import {
  FOOTER_NAV,
  isCurrentPath,
  isPageHref,
  PRIMARY_NAV,
  signInHref,
} from "./links";

describe("isCurrentPath", () => {
  test("a page and everything below it", () => {
    expect(isCurrentPath("/docs", "/docs")).toBe(true);
    expect(isCurrentPath("/docs/migrate", "/docs")).toBe(true);
    expect(isCurrentPath("/docsify", "/docs")).toBe(false);
    expect(isCurrentPath("/pricing", "/docs")).toBe(false);
  });
  test("the homepage only matches itself", () => {
    expect(isCurrentPath("/", "/")).toBe(true);
    expect(isCurrentPath("/docs", "/")).toBe(false);
  });
});

describe("signInHref", () => {
  test("returns to the homepage by default", () => {
    expect(signInHref()).toBe("/api/auth/github?returnTo=%2F");
  });
  test("carries the current path and query, encoded", () => {
    expect(signInHref("/studio?target=vercel/next.js&theme=dracula")).toBe(
      "/api/auth/github?returnTo=%2Fstudio%3Ftarget%3Dvercel%2Fnext.js%26theme%3Ddracula",
    );
  });
});

describe("isPageHref", () => {
  test("app pages", () => {
    expect(isPageHref("/")).toBe(true);
    expect(isPageHref("/docs")).toBe(true);
    expect(isPageHref("/docs/migrate#paste")).toBe(true);
    expect(isPageHref("/studio?target=vercel")).toBe(true);
  });
  test("files and machine endpoints are not pages", () => {
    expect(isPageHref("/llms.txt")).toBe(false);
    expect(isPageHref("/openapi.json")).toBe(false);
    expect(isPageHref("/mcp")).toBe(false);
    expect(isPageHref("/api/v1/options")).toBe(false);
    expect(isPageHref("/torvalds.svg?theme=dracula")).toBe(false);
    expect(isPageHref("/embed/torvalds")).toBe(false);
  });
  test("other sites are not pages", () => {
    expect(isPageHref("https://github.com/markeljan/gitbanners")).toBe(false);
    expect(isPageHref("//evil.example/docs")).toBe(false);
    expect(isPageHref("mailto:hi@example.com")).toBe(false);
  });
});

describe("navigation data", () => {
  test("the header lists the five product pages", () => {
    expect(PRIMARY_NAV.map((link) => link.label)).toEqual([
      "Studio",
      "Gallery",
      "Themes",
      "Docs",
      "Pricing",
    ]);
  });
  test("the footer carries the machine files and the legal pages", () => {
    const hrefs = FOOTER_NAV.flatMap((group) =>
      group.links.map((link) => link.href),
    );
    for (const href of [
      "/llms.txt",
      "/openapi.json",
      "/mcp",
      "/about",
      "/contact",
      "/privacy",
      "/terms",
    ]) {
      expect(hrefs).toContain(href);
    }
  });
  test("every link is classified the way it will be rendered", () => {
    for (const link of FOOTER_NAV.flatMap((group) => group.links)) {
      if (link.kind === "page") expect(isPageHref(link.href)).toBe(true);
      if (link.kind === "file") expect(isPageHref(link.href)).toBe(false);
      if (link.kind === "external") {
        expect(link.href.startsWith("https://")).toBe(true);
      }
    }
  });
});
