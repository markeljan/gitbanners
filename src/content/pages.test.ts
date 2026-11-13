import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ERROR_CODES, errorAnchor } from "@/lib/agent/error-codes";
import { MCP_TOOLS } from "@/lib/agent/identity";
import { API_OPERATIONS } from "@/lib/agent/operations";
import { PARAMETER_DOCS } from "@/lib/api/parameters";
import { PRESETS, SIZES, THEMES } from "@/lib/banner";
import { FAQ } from "./faq";
import { plainInline } from "./inline";
import { CONTENT_PAGES, contentMarkdown, contentPage } from "./pages";
import { CONTENT_PATHS } from "./paths";
import type { Block, ContentPage } from "./types";

/** Every string of inline copy on a page. */
function inlineTexts(page: ContentPage): string[] {
  const fromBlock = (block: Block): string[] => {
    switch (block.type) {
      case "p":
      case "note":
        return [block.text];
      case "list":
        return [...block.items];
      case "table":
        return [...block.head, ...block.rows.flat()];
      case "code":
        return block.caption ? [block.caption] : [];
      case "banner":
        return [block.alt, ...(block.caption ? [block.caption] : [])];
    }
  };
  return [
    page.title,
    page.description,
    page.heading,
    page.lead,
    ...page.sections.flatMap((section) => [
      section.title,
      ...section.blocks.flatMap(fromBlock),
    ]),
  ];
}

/** Anchors a link may point at: section ids and table row ids. */
function anchors(page: ContentPage): Set<string> {
  const ids = new Set(page.sections.map((section) => section.id));
  for (const section of page.sections) {
    for (const block of section.blocks) {
      if (block.type === "table")
        for (const id of block.rowIds ?? []) ids.add(id);
    }
  }
  if (page.path === "/") for (const entry of FAQ) ids.add(entry.id);
  return ids;
}

/**
 * Site paths the copy may link to that are not content pages: documents
 * served by route handlers, and pages other parts of the app provide.
 */
const OTHER_TARGETS = new Set([
  "/llms.txt",
  "/llms-full.txt",
  "/docs/llms.txt",
  "/api/llms.txt",
  "/openapi.json",
  "/server.json",
  "/sitemap.xml",
  "/robots.txt",
  "/index.md",
  "/mcp/server-card",
  "/.well-known/api-catalog",
  "/.well-known/ard.json",
  "/.well-known/ai-catalog.json",
  "/.well-known/agent-skills/index.json",
  "/.well-known/agent-skills/gitbanners/SKILL.md",
  "/.well-known/mcp/server-card.json",
  // Built elsewhere in the app.
  "/themes",
  "/studio",
]);

/** "Try it" links of the docs: live API answers and banner images. */
const LIVE_EXAMPLE = /^\/(?:api(?:\/v1(?:\/.*)?)?|[^?#]+\.(?:svg|png))$/;

const LINK = /\[[^\]]+\]\(([^)\s]+)\)/g;

describe("content registry", () => {
  test("holds the homepage and exactly the paths next.config negotiates", () => {
    expect(CONTENT_PAGES.map((page) => page.path)).toEqual([
      "/",
      ...CONTENT_PATHS,
    ]);
    for (const page of CONTENT_PAGES) {
      expect(contentPage(page.path)).toBe(page);
    }
    expect(contentPage("/studio")).toBeUndefined();
  });

  for (const page of CONTENT_PAGES) {
    describe(page.path, () => {
      const markdown = contentMarkdown(page);
      const texts = inlineTexts(page);

      test("has a title, a description of search-result length and a date", () => {
        expect(page.title.length).toBeGreaterThan(4);
        expect(page.description.length).toBeGreaterThanOrEqual(110);
        expect(page.description.length).toBeLessThanOrEqual(165);
        expect(page.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      test("section ids are unique kebab-case and levels never skip", () => {
        const ids = page.sections.map((section) => section.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids)
          expect(id).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
        // A level-3 section belongs to a level-2 one before it.
        expect(page.sections[0]?.level ?? 2).toBe(2);
      });

      test("copy follows the house rules", () => {
        for (const text of texts) {
          // No em or en dashes, no protocol name, no template leftovers.
          expect(text).not.toMatch(/[—–]/);
          expect(text.toLowerCase()).not.toContain(`o${"auth"}`);
          expect(text).not.toMatch(/\{\{|\}\}|lorem ipsum/i);
        }
        for (const section of page.sections) {
          // Sentence case: no word after the first starts a run of capitalised words.
          expect(section.title).not.toMatch(
            /^(?:[A-Z][a-z]+ ){2,}[A-Z][a-z]+$/,
          );
        }
      });

      test("internal links lead somewhere, anchors included", () => {
        const own = anchors(page);
        for (const text of [
          ...texts,
          ...(page.path === "/" ? FAQ.map((entry) => entry.answer) : []),
        ]) {
          for (const [, href] of text.matchAll(LINK)) {
            if (href.startsWith("#")) {
              expect(`${href}: ${own.has(href.slice(1))}`).toBe(
                `${href}: true`,
              );
              continue;
            }
            if (!href.startsWith("/")) {
              expect(href).toMatch(/^(https:\/\/|mailto:)/);
              continue;
            }
            const [path, hash] = href.split("#");
            const target = contentPage(path);
            // "/docs.md" is the Markdown version of a content page.
            const twin = path.endsWith(".md")
              ? contentPage(path.slice(0, -3))
              : undefined;
            const known =
              target !== undefined ||
              twin !== undefined ||
              OTHER_TARGETS.has(path) ||
              LIVE_EXAMPLE.test(path);
            expect(`${href}: ${known}`).toBe(`${href}: true`);
            if (target && hash) {
              expect(`${href}: ${anchors(target).has(hash)}`).toBe(
                `${href}: true`,
              );
            }
          }
        }
      });

      test("the Markdown version is a sound document", () => {
        expect(markdown.startsWith(`# ${page.heading}\n`)).toBe(true);
        const fences = markdown
          .split("\n")
          .filter((line) => line.startsWith("```"));
        expect(fences.length % 2).toBe(0);
        // Links and images are absolute: the document stands on its own.
        expect(markdown).not.toMatch(/\]\(\/[^)]*\)/);
        expect(markdown.toLowerCase()).not.toContain(`o${"auth"}`);
      });
    });
  }
});

describe("homepage anchors", () => {
  test("FAQ ids are unique and collide with no section id", () => {
    const home = contentPage("/");
    if (!home) throw new Error("no homepage");
    const ids = [
      "faq",
      ...home.sections.map((section) => section.id),
      ...FAQ.map((entry) => entry.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("trust pages", () => {
  test("about, contact and privacy each say at least 500 characters", () => {
    for (const path of ["/about", "/contact", "/privacy", "/terms"]) {
      const page = contentPage(path);
      if (!page) throw new Error(`no page at ${path}`);
      const text = inlineTexts(page).map(plainInline).join(" ");
      expect(text.length).toBeGreaterThan(900);
    }
  });

  test("the pricing Markdown names both plans in five lines or more", () => {
    const page = contentPage("/pricing");
    if (!page) throw new Error("no pricing page");
    const lines = contentMarkdown(page).split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
    expect(lines.join("\n")).toMatch(/\| Price \| \$0 \| One GitHub star \|/);
  });
});

describe("docs page", () => {
  const docs = contentPage("/docs");
  if (!docs) throw new Error("no docs page");
  const ids = anchors(docs);
  const markdown = contentMarkdown(docs);

  test('is titled "GitBanners API docs" in title and h1', () => {
    expect(docs.title).toBe("GitBanners API docs");
    expect(docs.heading).toBe("GitBanners API docs");
  });

  test("has the sections other files link to", () => {
    for (const id of [
      "url-patterns",
      "variants-and-themes",
      "rest-api",
      "errors",
      "rate-limits",
      "versioning-and-deprecation",
      "authentication",
      "mcp",
      "agent-skill",
      "markdown",
      "parameters",
    ]) {
      expect(`${id}: ${ids.has(id)}`).toBe(`${id}: true`);
    }
  });

  test("anchors every error code a problem response can carry", () => {
    // The codes the shared contract lists.
    const contract = [
      "invalid_request",
      "not_found",
      "rate_limited",
      "upstream_rate_limited",
      "upstream_unavailable",
      "api_route_not_found",
      "method_not_allowed",
      "internal_error",
      "bad_request",
      "invalid_body",
      "unauthorized",
      "forbidden",
      "cross_origin_request",
      "pro_required",
      "banner_limit_reached",
      "login_changed",
      "payload_too_large",
      "unsupported_media_type",
      "accounts_unavailable",
      "unavailable",
    ];
    for (const code of [
      ...contract,
      ...ERROR_CODES.map((entry) => entry.code),
    ]) {
      expect(`${code}: ${ids.has(errorAnchor(code))}`).toBe(`${code}: true`);
    }
  });

  test("documents every code the source can answer with", () => {
    const root = join(import.meta.dir, "..");
    const sources = [
      "lib/http/problem.ts",
      "lib/api/http.ts",
      "lib/api/errors.ts",
      "lib/auth/session.ts",
      "lib/pro/index.ts",
      "app/api/auth/github/route.ts",
      "app/api/auth/signout/route.ts",
      "app/api/banners/route.ts",
      "app/api/banners/[id]/route.ts",
      "app/api/me/route.ts",
    ];
    const documented = new Set(ERROR_CODES.map((entry) => entry.code));
    for (const file of sources) {
      const text = readFileSync(join(root, file), "utf8");
      for (const [, code] of text.matchAll(/\bcode: "([a-z_]+)"/g)) {
        expect(`${file} ${code}: ${documented.has(code)}`).toBe(
          `${file} ${code}: true`,
        );
      }
    }
  });

  test("has one curl example per operation", () => {
    for (const operation of API_OPERATIONS) {
      expect(markdown).toContain(operation.example);
      expect(markdown).toContain(`GET ${operation.path}`);
    }
    expect(markdown.match(/^curl /gm)?.length ?? 0).toBeGreaterThanOrEqual(
      API_OPERATIONS.length,
    );
  });

  test("lists every preset, size, theme, parameter and MCP tool from the registries", () => {
    for (const preset of PRESETS)
      expect(markdown).toContain(`\`${preset.id}\``);
    for (const size of Object.values(SIZES)) {
      expect(markdown).toContain(`| \`${size.id}\` | ${size.name} |`);
    }
    for (const theme of THEMES) {
      expect(markdown).toContain(`| \`${theme.id}\` | ${theme.name} |`);
    }
    for (const parameter of PARAMETER_DOCS) {
      expect(markdown).toContain(`\`${parameter.name}=${parameter.example}\``);
    }
    for (const tool of Object.values(MCP_TOOLS)) {
      expect(markdown).toContain(`| \`${tool.name}\` |`);
    }
  });

  test('says "none" about authentication and keeps the page within a context budget', () => {
    const section = docs.sections.find(
      (entry) => entry.id === "authentication",
    );
    expect(JSON.stringify(section)).toContain("None.");
    expect(markdown.length).toBeLessThan(60_000);
  });
});
