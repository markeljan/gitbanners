import { describe, expect, test } from "bun:test";
import { CONTENT_PAGES, contentPage } from "@/content/pages";
import { SHOWCASE } from "@/content/showcase";
import { site } from "@/lib/site";
import { apiLlmsTxt, docsLlmsTxt, llmsFullTxt, llmsTxt } from "./llms";
import { API_OPERATIONS } from "./operations";

/** Paths of this site that a Markdown document links to. */
function ownLinks(markdown: string): string[] {
  return [...markdown.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)]
    .map(([, url]) => url)
    .filter((url) => url.startsWith(`${site.url}/`) || url === site.url)
    .map((url) => url.slice(site.url.length).split("#")[0] || "/");
}

/** Documents this branch serves besides the content pages. */
const SERVED = new Set([
  "/studio",
  "/gallery",
  "/themes",
  "/llms.txt",
  "/llms-full.txt",
  "/docs/llms.txt",
  "/api/llms.txt",
  "/openapi.json",
  "/sitemap.xml",
  "/index.md",
  "/mcp/server-card",
  "/.well-known/api-catalog",
  "/.well-known/ard.json",
  "/.well-known/agent-skills/index.json",
  "/.well-known/agent-skills/gitbanners/SKILL.md",
]);

function resolves(path: string): boolean {
  if (contentPage(path) || SERVED.has(path)) return true;
  if (path.endsWith(".md")) return contentPage(path.slice(0, -3)) !== undefined;
  // Banner images answer for every well-formed target.
  return /^\/[A-Za-z0-9-]+(\/[\w.-]+){0,2}\.svg(\?.*)?$/.test(path);
}

describe("llms.txt", () => {
  const text = llmsTxt();

  test("follows the llmstxt.org shape", () => {
    const lines = text.split("\n");
    expect(lines[0]).toBe(`# ${site.name}`);
    expect(lines[2].startsWith("> ")).toBe(true);
    expect(text.match(/^# /gm)?.length).toBe(1);
    expect(text).toContain("\n## Optional\n");
    expect(text.length).toBeGreaterThan(1_000);
    expect(text.length).toBeLessThan(30_000);
  });

  test("says when to use the product, and when not to", () => {
    expect(text).toContain(`\n## When to use ${site.name}\n`);
    expect(text).toMatch(/\nUse GitBanners when /);
    expect(text).toMatch(/\nDo not use GitBanners to /);
  });

  test("links both section indexes and names the MCP endpoint", () => {
    expect(text).toContain(`(${site.url}/docs/llms.txt)`);
    expect(text).toContain(`(${site.url}/api/llms.txt)`);
    expect(text).toContain(`\`${site.url}/mcp\``);
  });

  test("lists only addresses that answer", () => {
    const links = ownLinks(text);
    expect(links.length).toBeGreaterThan(20);
    for (const path of links) {
      expect(`${path}: ${resolves(path)}`).toBe(`${path}: true`);
    }
  });

  test("the examples are the showcase", () => {
    for (const item of SHOWCASE) expect(text).toContain(`[${item.title}](`);
  });

  test("does not name the sign-in protocol or promise a command-line tool", () => {
    expect(text.toLowerCase()).not.toContain(`o${"auth"}`);
    expect(text).not.toMatch(/\bCLI\b|\bnpx\b/);
  });
});

describe("section indexes", () => {
  test("the docs index lists the top-level topics", () => {
    const text = docsLlmsTxt();
    expect(text.startsWith(`# ${site.name} docs\n`)).toBe(true);
    for (const id of [
      "url-patterns",
      "rest-api",
      "errors",
      "rate-limits",
      "mcp",
    ]) {
      expect(text).toContain(`(${site.url}/docs#${id})`);
    }
    for (const path of ownLinks(text)) {
      expect(`${path}: ${resolves(path)}`).toBe(`${path}: true`);
    }
  });

  test("the API index has one working request per operation", () => {
    const text = apiLlmsTxt();
    for (const operation of API_OPERATIONS) {
      expect(text).toContain(
        `- [${operation.id}](${site.url}${operation.example}): \`GET ${operation.path}\``,
      );
    }
  });
});

describe("llms-full.txt", () => {
  const text = llmsFullTxt();

  test("holds every content page in full", () => {
    for (const page of CONTENT_PAGES) {
      expect(text).toContain(`\n# ${page.heading}\n`);
      expect(text).toContain(`Source: ${site.url}${page.path} `);
    }
    expect(text).toContain("## Frequently asked questions");
  });

  test("is a sound document within a context budget", () => {
    const fences = text.split("\n").filter((line) => line.startsWith("```"));
    expect(fences.length % 2).toBe(0);
    expect(text.length).toBeLessThan(100_000);
  });
});
