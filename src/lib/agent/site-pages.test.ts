import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sitemap from "@/app/sitemap";
import { CONTENT_PAGES } from "@/content/pages";
import { SHOWCASE } from "@/content/showcase";
import { site } from "@/lib/site";
import { showcasePaths, sitePages } from "./site-pages";

describe("sitemap", () => {
  const entries = sitemap();

  test("lists every content page and every showcase target, once", () => {
    const urls = entries.map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const page of CONTENT_PAGES) {
      expect(urls).toContain(`${site.url}${page.path}`);
    }
    for (const path of showcasePaths()) {
      expect(urls).toContain(`${site.url}${path}`);
    }
    expect(urls).not.toContain(`${site.url}/dashboard`);
  });

  test("every entry has a last-modified date", () => {
    for (const entry of entries) {
      expect(String(entry.lastModified)).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });

  test("banner pages list their preview image", () => {
    const vercel = entries.find((entry) => entry.url === `${site.url}/vercel`);
    expect(vercel?.images).toEqual([`${site.url}/vercel.png?size=og`]);
    const docs = entries.find((entry) => entry.url === `${site.url}/docs`);
    expect(docs?.images).toBeUndefined();
  });
});

describe("showcase targets", () => {
  test("are the pages of the accounts and repositories shown, without presets or options", () => {
    const paths = showcasePaths();
    expect(paths).toContain("/torvalds");
    expect(paths).toContain("/vercel/next.js");
    expect(paths).toContain("/facebook/react");
    for (const path of paths) expect(path).not.toMatch(/\?|\.(svg|png)$/);
    expect(paths.length).toBeLessThanOrEqual(SHOWCASE.length);
    expect(paths.length).toBeGreaterThanOrEqual(8);
  });
});

/**
 * Every static page of the app is either in the sitemap or left out on
 * purpose. A new page fails this test until someone decides which.
 */
describe("pages and the sitemap", () => {
  /** Static pages a crawler should not be sent to. */
  const UNLISTED = new Set([
    // The page behind every 404 the routing layer decides.
    "/-/nf",
    // Personal: it only has content for a signed-in visitor.
    "/dashboard",
  ]);

  function staticPages(dir: string, route: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      // Dynamic segments are not single pages; private folders are no routes.
      if (/^[[_]/.test(entry.name)) continue;
      const group = /^\(.*\)$/.test(entry.name);
      const next = group ? route : `${route}/${entry.name}`;
      found.push(...staticPages(join(dir, entry.name), next));
    }
    if (existsSync(join(dir, "page.tsx"))) found.push(route || "/");
    return found;
  }

  test("each static page.tsx is listed or deliberately unlisted", () => {
    const app = join(import.meta.dir, "..", "..", "app");
    const listed = new Set(sitePages().map((page) => page.path));
    for (const route of staticPages(app, "")) {
      const decided = listed.has(route) || UNLISTED.has(route);
      expect(
        `${route}: ${decided ? "decided" : "add it to sitePages() in src/lib/agent/site-pages.ts, or to UNLISTED in this test"}`,
      ).toBe(`${route}: decided`);
    }
  });
});
