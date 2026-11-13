/**
 * The generic content renderer, rendered to static markup: the outline a
 * scanner reads (one leading h1, no skipped levels), anchors, links as real
 * elements, and nothing injected as HTML.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FAQ } from "@/content/faq";
import { CONTENT_PAGES } from "@/content/pages";
import type { ContentPage } from "@/content/types";
import { ContentPageView } from "./content-page";
import { Inline, isPageHref } from "./inline";
import { JsonLd } from "./json-ld";
import { NotFoundContent } from "./not-found-content";

function headingLevels(html: string): number[] {
  return [...html.matchAll(/<h([1-6])[\s>]/g)].map(([, level]) =>
    Number(level),
  );
}

const sample: ContentPage = {
  path: "/sample",
  title: "Sample",
  description: "A page for the renderer tests.",
  updated: "2026-11-13",
  heading: "Sample page",
  lead: "A lead with `code` and a [link](/docs#mcp).",
  sections: [
    {
      id: "first",
      title: "First section",
      blocks: [
        {
          type: "p",
          text: "Text with **bold** and <script>alert(1)</script>.",
        },
        { type: "list", ordered: true, items: ["One", "Two with `code`"] },
        { type: "note", text: "A note." },
        { type: "code", lang: "bash", code: 'curl "https://example.test"' },
        {
          type: "table",
          head: ["Code", "`Meaning`"],
          rows: [
            ["`not_found`", "See [the docs](/docs)."],
            [
              "`other`",
              "[llms.txt](/llms.txt) and [GitHub](https://github.com).",
            ],
          ],
          rowIds: ["error-not_found"],
        },
        {
          type: "banner",
          path: "/vercel?theme=dracula",
          alt: "Banner of vercel",
        },
        {
          type: "banner",
          path: "/someone-else",
          alt: "No sample",
          caption: "Caption",
        },
      ],
    },
    {
      id: "nested",
      title: "Nested",
      level: 3,
      blocks: [{ type: "p", text: "x" }],
    },
  ],
};

describe("ContentPageView", () => {
  const html = renderToStaticMarkup(<ContentPageView page={sample} />);

  test("the h1 comes first, then sections by their level, with their ids", () => {
    expect(headingLevels(html)).toEqual([1, 2, 3]);
    expect(html).toMatch(/<h1[^>]*>Sample page<\/h1>/);
    expect(html).toMatch(/<h2[^>]*id="first"[^>]*>First section<\/h2>/);
    expect(html).toMatch(/<h3[^>]*id="nested"[^>]*>Nested<\/h3>/);
  });

  test("renders no landmarks of its own: the frame belongs to the layout", () => {
    expect(html).not.toMatch(/<(main|header|footer)[\s>]/);
    expect(html.startsWith('<div class="gb-page">')).toBe(true);
  });

  test("inline copy becomes elements, and text stays text", () => {
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain('<a href="/docs#mcp">link</a>');
  });

  test("lists, notes and code blocks", () => {
    expect(html).toContain(
      "<ol><li>One</li><li>Two with <code>code</code></li></ol>",
    );
    expect(html).toContain('<p class="gb-note">A note.</p>');
    expect(html).toContain('aria-label="Copy code"');
    expect(html).toContain("example.test");
  });

  test("tables have header cells and row anchors", () => {
    expect(html).toContain('<th scope="col">Code</th>');
    expect(html).toContain('<th scope="col"><code>Meaning</code></th>');
    expect(html).toContain('<tr id="error-not_found">');
    expect(html.match(/<tr id=/g)?.length).toBe(1);
  });

  test("links: pages, files and other sites", () => {
    expect(html).toContain('<a href="/docs">the docs</a>');
    expect(html).toContain('<a href="/llms.txt">llms.txt</a>');
    expect(html).toContain(
      '<a href="https://github.com" rel="noopener noreferrer">GitHub</a>',
    );
  });

  test("banners are lazy images with reserved space when a sample exists", () => {
    expect(html).toMatch(
      /<a href="\/vercel"><img src="\/vercel\.svg\?theme=dracula" alt="Banner of vercel" width="846" height="\d+" loading="lazy" decoding="async"\/><\/a>/,
    );
    expect(html).toMatch(
      /<img src="\/someone-else\.svg" alt="No sample" loading="lazy" decoding="async"\/>/,
    );
    expect(html).toContain("<figcaption>Caption</figcaption>");
  });

  test("ends with the date and a link to the Markdown version", () => {
    expect(html).toContain(
      '<time dateTime="2026-11-13">13 November 2026</time>',
    );
    expect(html).toContain(
      '<a href="/sample.md">Read this page as Markdown</a>',
    );
  });

  test("short pages have no table of contents unless asked", () => {
    expect(html).not.toContain("gb-toc");
    const withToc = renderToStaticMarkup(<ContentPageView page={sample} toc />);
    expect(withToc).toContain('<nav class="gb-toc" aria-label="On this page">');
    expect(withToc).toContain(
      '<li><a href="#first">First section</a><ul><li><a href="#nested">Nested</a></li></ul></li>',
    );
    // The label is not a heading: the outline stays h1, h2, h3.
    expect(headingLevels(withToc)).toEqual([1, 2, 3]);
    expect(withToc).toContain('data-toc=""');
  });

  test("children are rendered between the lead and the sections", () => {
    const withChild = renderToStaticMarkup(
      <ContentPageView page={sample}>
        <p id="slot">slot</p>
      </ContentPageView>,
    );
    expect(withChild.indexOf('id="slot"')).toBeGreaterThan(
      withChild.indexOf("gb-lead"),
    );
    expect(withChild.indexOf('id="slot"')).toBeLessThan(
      withChild.indexOf('id="first"'),
    );
  });

  test("the FAQ is a last section with every answer in the markup", () => {
    const withFaq = renderToStaticMarkup(
      <ContentPageView page={sample} faq={FAQ} toc />,
    );
    expect(withFaq).toMatch(
      /<h2[^>]*id="faq"[^>]*>Frequently asked questions<\/h2>/,
    );
    for (const entry of FAQ) {
      expect(withFaq).toContain(`id="${entry.id}"`);
      expect(withFaq).toContain(`aria-labelledby="${entry.id}"`);
    }
    expect(headingLevels(withFaq).slice(0, 4)).toEqual([1, 2, 3, 2]);
    expect(withFaq).toContain('<a href="#faq">Frequently asked questions</a>');
    expect(withFaq).not.toContain("<details");
  });
});

describe("every content page", () => {
  for (const page of CONTENT_PAGES) {
    test(`${page.path}: one leading h1, no skipped level, unique ids`, () => {
      const html = renderToStaticMarkup(
        <ContentPageView
          page={page}
          faq={page.path === "/" ? FAQ : undefined}
        />,
      );
      const levels = headingLevels(html);
      expect(levels[0]).toBe(1);
      expect(levels.filter((level) => level === 1).length).toBe(1);
      for (let index = 1; index < levels.length; index += 1) {
        expect(levels[index] - levels[index - 1]).toBeLessThanOrEqual(1);
      }
      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(html.toLowerCase()).not.toContain(`o${"auth"}`);
      // In-page links have a target on the page.
      for (const [, hash] of html.matchAll(/href="#([^"]+)"/g)) {
        expect(`#${hash}: ${ids.includes(hash)}`).toBe(`#${hash}: true`);
      }
    });
  }
});

describe("isPageHref", () => {
  test("pages get client-side navigation, everything else a plain link", () => {
    for (const href of [
      "/",
      "/docs",
      "/docs#mcp",
      "/pricing?x=1",
      "/vercel/next.js",
    ]) {
      expect(`${href}: ${isPageHref(href)}`).toBe(`${href}: true`);
    }
    for (const href of [
      "#faq",
      "/llms.txt",
      "/openapi.json",
      "/docs.md",
      "/vercel.svg",
      "/mcp",
      "/mcp/server-card",
      "/api/auth/github?returnTo=/",
      "/.well-known/api-catalog",
      "/embed/vercel",
      "/b/b0123456789a.png",
      "https://github.com/vercel",
      "mailto:a@example.test",
      "//evil.test/x",
    ]) {
      expect(`${href}: ${isPageHref(href)}`).toBe(`${href}: false`);
    }
  });

  test("link text may hold code", () => {
    const html = renderToStaticMarkup(
      <Inline text={"[`getOwner`](#get-owner)"} />,
    );
    expect(html).toBe('<a href="#get-owner"><code>getOwner</code></a>');
  });
});

describe("JsonLd and the 404 body", () => {
  test("JSON-LD is one script that user text cannot close", () => {
    const html = renderToStaticMarkup(
      <JsonLd data={{ name: "</script><b>" }} />,
    );
    expect(html).toBe(
      '<script type="application/ld+json">{"name":"\\u003c/script>\\u003cb>"}</script>',
    );
  });

  test("the 404 body explains itself and links the indexes", () => {
    const html = renderToStaticMarkup(<NotFoundContent />);
    expect(headingLevels(html)).toEqual([1]);
    for (const href of ["/", "/docs", "/llms.txt", "/sitemap.xml"]) {
      expect(html).toContain(`href="${href}"`);
    }
  });
});
