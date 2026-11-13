/**
 * The routing layer: which representation a URL answers with, decided by
 * the rewrites in next.config.ts before any page or handler runs.
 *
 * The rules are evaluated here the way Next evaluates them: `beforeFiles`,
 * then routes with a concrete path, then `afterFiles`, then dynamic routes.
 * A `beforeFiles` rewrite continues through the later steps with its
 * destination, which is what once sent every negotiated Markdown request
 * to the 404 page.
 */
import { describe, expect, test } from "bun:test";
// @ts-expect-error Next bundles path-to-regexp without type declarations.
import * as bundled from "next/dist/compiled/path-to-regexp";
import { CONTENT_PATHS } from "@/content/paths";
import nextConfig from "./next.config";

interface Condition {
  type: string;
  key: string;
  value?: string;
}
interface Rule {
  source: string;
  destination: string;
  has?: Condition[];
  missing?: Condition[];
}

/** The two functions of path-to-regexp 6 this file uses, as Next calls them. */
interface PathToRegexp {
  match(
    source: string,
    options: { strict: boolean; sensitive: boolean },
  ): (path: string) => { params: Record<string, string | string[]> } | false;
  compile(
    destination: string,
    options: { validate: boolean },
  ): (params: Record<string, string | string[]>) => string;
}
const { compile, match } = bundled as PathToRegexp;

const config = nextConfig("phase-production-build");
if (!config.rewrites) throw new Error("no rewrites");
const rewrites = (await config.rewrites()) as {
  beforeFiles: Rule[];
  afterFiles: Rule[];
  fallback: Rule[];
};

/** Routes with a concrete path: they win over `afterFiles`. */
const CONCRETE = new Set([
  "/",
  ...CONTENT_PATHS,
  "/-/nf",
  "/api",
  "/api/v1",
  "/api/v1/options",
  "/api/v1/search",
  "/api/v1/banner",
  "/api/me",
  "/mcp",
  "/mcp/server-card",
  "/openapi.json",
  "/server.json",
  "/llms.txt",
  "/llms-full.txt",
  "/docs/llms.txt",
  "/api/llms.txt",
  "/robots.txt",
  "/sitemap.xml",
  "/icon.svg",
  "/.well-known/api-catalog",
  "/.well-known/ard.json",
  "/.well-known/agent-skills/index.json",
  "/.well-known/agent-skills/gitbanners/SKILL.md",
  "/studio",
  "/docs/migrate",
]);

function holds(condition: Condition, accept: string | undefined): boolean {
  if (condition.type !== "header" || condition.key !== "accept") {
    throw new Error("only Accept conditions are used");
  }
  return (
    accept !== undefined && new RegExp(`^${condition.value}$`).test(accept)
  );
}

function apply(
  rules: Rule[],
  path: string,
  accept: string | undefined,
): string | null {
  for (const rule of rules) {
    const found = match(rule.source, { strict: true, sensitive: false })(path);
    if (!found) continue;
    if (!(rule.has ?? []).every((condition) => holds(condition, accept))) {
      continue;
    }
    if ((rule.missing ?? []).some((condition) => holds(condition, accept))) {
      continue;
    }
    return compile(rule.destination, { validate: false })(found.params);
  }
  return null;
}

/** Where a request ends up: an internal handler, or the path itself. */
function resolve(path: string, accept?: string): string {
  const early = apply(rewrites.beforeFiles, path, accept);
  const current = early ?? path;
  if (CONCRETE.has(current)) return current;
  return apply(rewrites.afterFiles, current, accept) ?? current;
}

const MARKDOWN = "text/markdown";
const BROWSER =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
const IMG = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";

describe("Markdown negotiation", () => {
  const wantsMarkdown = [
    MARKDOWN,
    "text/markdown, text/html, */*",
    "text/markdown, text/html;q=0.9, application/xhtml+xml;q=0.9, application/xml;q=0.8, */*;q=0.7",
    "text/markdown, text/plain;q=0.9, */*;q=0.8",
    "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1",
    "text/markdown, */*",
  ];

  test("agents that list Markdown first get the Markdown handler", () => {
    for (const accept of wantsMarkdown) {
      expect(resolve("/", accept)).toBe("/-/md");
      expect(resolve("/docs", accept)).toBe("/-/md/docs");
      expect(resolve("/pricing", accept)).toBe("/-/md/pricing");
      expect(resolve("/vercel", accept)).toBe("/-/md/vercel");
      expect(resolve("/vercel/next.js", accept)).toBe("/-/md/vercel/next.js");
      expect(resolve("/vercel/next.js/contributors", accept)).toBe(
        "/-/md/vercel/next.js/contributors",
      );
    }
  });

  test("everyone else gets the page", () => {
    for (const accept of [
      BROWSER,
      "*/*",
      "text/html",
      "text/html, text/markdown, */*",
      "text/*",
      undefined,
    ]) {
      expect(resolve("/", accept)).toBe("/");
      expect(resolve("/docs", accept)).toBe("/docs");
      expect(resolve("/vercel", accept)).toBe("/vercel");
      expect(resolve("/vercel/next.js", accept)).toBe("/vercel/next.js");
    }
  });

  test("a path that is nothing gets the Markdown 404, not an HTML page", () => {
    expect(resolve("/__ora-404-probe-ab12cd34", MARKDOWN)).toBe(
      "/-/md/__ora-404-probe-ab12cd34",
    );
    expect(resolve("/a/b/c/d", MARKDOWN)).toBe("/-/md/a/b/c/d");
    expect(resolve("/v1", MARKDOWN)).toBe("/-/md/v1");
    expect(resolve("/.env", MARKDOWN)).toBe("/-/md/.env");
  });

  test("machine files and the app's own routes ignore Accept", () => {
    for (const path of [
      "/llms.txt",
      "/llms-full.txt",
      "/docs/llms.txt",
      "/api/llms.txt",
      "/openapi.json",
      "/server.json",
      "/robots.txt",
      "/sitemap.xml",
      "/.well-known/api-catalog",
      "/.well-known/agent-skills/gitbanners/SKILL.md",
      "/mcp",
      "/mcp/server-card",
      "/api/v1/options",
      "/api/v1/owners/vercel",
      "/api/v1/orank-probe-test",
      // App pages without a Markdown version answer HTML rather than 404.
      "/studio",
    ]) {
      for (const accept of [MARKDOWN, "application/json", IMG]) {
        expect(`${path} ${accept}: ${resolve(path, accept)}`).toBe(
          `${path} ${accept}: ${path}`,
        );
      }
    }
  });

  test("the .md suffix needs no header", () => {
    expect(resolve("/index.md")).toBe("/-/md");
    expect(resolve("/docs.md")).toBe("/-/md/docs");
    expect(resolve("/pricing.md", BROWSER)).toBe("/-/md/pricing");
    expect(resolve("/vercel.md")).toBe("/-/md/vercel");
    expect(resolve("/vercel/next.js.md")).toBe("/-/md/vercel/next.js");
    expect(resolve("/vercel/next.js/contributors.md")).toBe(
      "/-/md/vercel/next.js/contributors",
    );
    expect(resolve("/studio.md")).toBe("/-/md/studio");
    expect(resolve("/auth.md")).toBe("/-/md/auth");
    // Below the API a name ending in ".md" is a repository, not a page.
    expect(resolve("/api/v1/repos/vercel/notes.md")).toBe(
      "/api/v1/repos/vercel/notes.md",
    );
  });
});

describe("images", () => {
  test("an explicit suffix is the image, whatever Accept says", () => {
    for (const accept of [undefined, "*/*", BROWSER, MARKDOWN, IMG]) {
      expect(resolve("/markeljan.svg", accept)).toBe("/-/i/svg/markeljan");
      expect(resolve("/vercel/next.js.png", accept)).toBe(
        "/-/i/png/vercel/next.js",
      );
      expect(resolve("/vercel/next.js/contributors.svg", accept)).toBe(
        "/-/i/svg/vercel/next.js/contributors",
      );
      expect(resolve("/@docs.svg", accept)).toBe("/-/i/svg/@docs");
      expect(resolve("/b/b0123456789a.png", accept)).toBe(
        "/-/i/saved/png/b0123456789a",
      );
    }
  });

  test("/embed is always the image", () => {
    for (const accept of [undefined, "*/*", "text/html", MARKDOWN, IMG]) {
      expect(resolve("/embed/markeljan", accept)).toBe("/-/i/auto/markeljan");
      expect(resolve("/embed/vercel/next.js", accept)).toBe(
        "/-/i/auto/vercel/next.js",
      );
      expect(resolve("/embed/vercel/next.js.png", accept)).toBe(
        "/-/i/png/vercel/next.js",
      );
    }
  });

  test("a page URL asked for the way an <img> does is the image", () => {
    expect(resolve("/vercel", IMG)).toBe("/-/i/auto/vercel");
    expect(resolve("/vercel/next.js", "image/*")).toBe(
      "/-/i/auto/vercel/next.js",
    );
    // A browser navigation lists image types too, but text/html first.
    expect(resolve("/vercel", BROWSER)).toBe("/vercel");
    // The app's own pages are never images.
    expect(resolve("/docs", IMG)).toBe("/docs");
    expect(resolve("/pricing", IMG)).toBe("/pricing");
  });
});

describe("paths that are nothing", () => {
  test("junk first segments get the static 404", () => {
    for (const path of [
      "/__ora-404-probe-ab12cd34",
      "/wp-login.php",
      "/.env",
      "/.git/config",
      "/_vercel/insights/script.js",
      "/a.b/c",
      "/.well-known/openid-configuration",
      "/.well-known/security.txt",
    ]) {
      expect(`${path}: ${resolve(path, BROWSER)}`).toBe(`${path}: /-/nf`);
    }
  });

  test("names that are never an owner get the static 404", () => {
    for (const path of [
      "/ask",
      "/agent/identity",
      "/agents",
      "/auth",
      "/llms",
      "/index",
      "/openapi",
      "/robots",
      "/sitemap",
      "/icon",
    ]) {
      expect(`${path}: ${resolve(path, BROWSER)}`).toBe(`${path}: /-/nf`);
      expect(`${path}: ${resolve(path, IMG)}`).toBe(`${path}: /-/nf`);
    }
  });

  test("an API guessed at the root answers like the API", () => {
    expect(resolve("/v1")).toBe("/api/-/not-found");
    expect(resolve("/v1/orank-probe-test")).toBe("/api/-/not-found");
    expect(resolve("/v2/owners/vercel", BROWSER)).toBe("/api/-/not-found");
    // Not an alias of the real API: nothing under /v1 succeeds.
    expect(resolve("/v1/options")).not.toBe("/api/v1/options");
  });

  test("the internal handlers are not junk themselves", () => {
    expect(resolve("/-/md")).toBe("/-/md");
    expect(resolve("/-/md/docs")).toBe("/-/md/docs");
    expect(resolve("/-/i/svg/vercel")).toBe("/-/i/svg/vercel");
  });

  test("logins that only start like a reserved name are owners", () => {
    expect(resolve("/vercel", IMG)).toBe("/-/i/auto/vercel");
    expect(resolve("/v1beta.svg")).toBe("/-/i/svg/v1beta");
    expect(resolve("/asking.svg")).toBe("/-/i/svg/asking");
    expect(resolve("/docs-team.svg")).toBe("/-/i/svg/docs-team");
    expect(resolve("/apis.svg")).toBe("/-/i/svg/apis");
  });
});

describe("headers and redirects", () => {
  test("/developers redirects to the docs", async () => {
    const redirects = await config.redirects?.();
    expect(redirects).toContainEqual({
      source: "/developers",
      destination: "/docs",
      permanent: true,
    });
  });

  test("the homepage advertises the machine-readable entry points", async () => {
    const headers = (await config.headers?.()) ?? [];
    const home = headers.find((entry) => entry.source === "/");
    const link = home?.headers.find((header) => header.key === "Link")?.value;
    for (const rel of [
      "sitemap",
      "describedby",
      "service-desc",
      "service-doc",
      "api-catalog",
      "ard",
      "alternate",
    ]) {
      expect(link).toContain(`rel="${rel}"`);
    }
    // The Markdown version sends its own Link header.
    expect(home?.missing?.length).toBe(1);
  });

  test("internal handlers are kept out of search indexes", async () => {
    const headers = (await config.headers?.()) ?? [];
    const internal = headers.find((entry) => entry.source === "/-/:path*");
    expect(internal?.headers).toEqual([
      { key: "X-Robots-Tag", value: "noindex" },
    ]);
  });
});
