/**
 * The Markdown handler, called the way the rewrites call it: the request
 * keeps its public URL, the rewritten path arrives as route params. GitHub
 * is never asked: the targets used have bundled samples.
 */
import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { site } from "@/lib/site";
import { expectMethodGuards } from "../../../../../tests/e2e/auth/helpers";
import * as route from "./route";

function get(publicPath: string, path?: string[], accept = "text/markdown") {
  return route.GET(
    new NextRequest(`http://localhost${publicPath}`, {
      headers: { accept },
    }),
    { params: Promise.resolve({ path }) },
  );
}

describe("content pages", () => {
  test("the homepage: Markdown, Vary, canonical and discovery links", async () => {
    const response = await get("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(response.headers.get("vary")).toBe("Accept");
    const link = response.headers.get("link") ?? "";
    expect(link).toContain(`<${site.url}/>; rel="canonical"`);
    for (const rel of [
      "sitemap",
      "describedby",
      "service-desc",
      "api-catalog",
    ]) {
      expect(link).toContain(`rel="${rel}"`);
    }
    expect(response.headers.get("cache-control")).toBe("public, max-age=0");
    expect(response.headers.get("vercel-cdn-cache-control")).toContain(
      "max-age=900",
    );
    expect(response.headers.get("x-robots-tag")).toBeNull();
    const body = await response.text();
    expect(body.startsWith("---\ntitle: ")).toBe(true);
    expect(body).toContain(
      "\n# Live GitHub banners for profiles, repos and orgs\n",
    );
    expect(body).toContain("## Frequently asked questions");
  });

  test("every other content page by its path", async () => {
    for (const path of [
      "docs",
      "pricing",
      "about",
      "contact",
      "privacy",
      "terms",
    ]) {
      const response = await get(`/${path}.md`, [path]);
      expect(response.status).toBe(200);
      expect(response.headers.get("link")).toBe(
        `<${site.url}/${path}>; rel="canonical"`,
      );
      const body = await response.text();
      expect(body).toContain(`canonical: ${site.url}/${path}\n`);
    }
  });
});

describe("banner pages", () => {
  test("an account from its sample", async () => {
    const response = await get("/vercel.md", ["vercel"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("vary")).toBe("Accept");
    expect(response.headers.get("vercel-cache-tag")).toBe("gb:owner:vercel");
    const body = await response.text();
    expect(body).toContain("# Vercel (@vercel)");
    expect(body).toContain(`${site.url}/vercel.svg`);
  });

  test("a repository preset, canonical in lower case", async () => {
    const response = await get("/Vercel/Next.js/contributors", [
      "Vercel",
      "Next.js",
      "contributors",
    ]);
    expect(response.status).toBe(200);
    expect(response.headers.get("link")).toBe(
      `<${site.url}/vercel/next.js/contributors>; rel="canonical"`,
    );
    expect(await response.text()).toContain("| Contributors (this page) |");
  });

  test("percent-encoded segments are decoded", async () => {
    const response = await get("/vercel/next%2Ejs.md", ["vercel", "next%2Ejs"]);
    expect(response.status).toBe(200);
  });
});

describe("what is not a page", () => {
  const cases: [string, string[]][] = [
    ["/__ora-404-probe-ab12cd34", ["__ora-404-probe-ab12cd34"]],
    ["/studio.md", ["studio"]],
    ["/v1", ["v1"]],
    ["/auth.md", ["auth"]],
    ["/a/b/c/d", ["a", "b", "c", "d"]],
    ["/vercel.svg.md", ["vercel.svg"]],
    ["/docs/nope.md", ["docs", "nope"]],
    // A preset organizations do not have.
    ["/vercel/streak.md", ["vercel", "streak"]],
  ];
  for (const [publicPath, path] of cases) {
    test(`${publicPath} is a 404 in Markdown`, async () => {
      const response = await get(publicPath, path);
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toBe(
        "text/markdown; charset=utf-8",
      );
      expect(response.headers.get("vary")).toBe("Accept");
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
      expect(response.headers.get("link")).toBeNull();
      const body = await response.text();
      expect(body.startsWith("# Page not found\n")).toBe(true);
      expect(body).toContain(`\`${publicPath}\``);
      expect(body).toContain(`${site.url}/llms.txt`);
      expect(body).toContain(`${site.url}/sitemap.xml`);
      expect(body).toContain(`${site.url}/docs`);
    });
  }

  test("a junk path is not cached, an unknown preset briefly", async () => {
    const junk = await get("/__x", ["__x"]);
    expect(junk.headers.get("cache-control")).toBe("no-store");
    const preset = await get("/vercel/streak.md", ["vercel", "streak"]);
    expect(preset.headers.get("cache-control")).toBe(
      "public, max-age=60, s-maxage=60",
    );
  });
});

describe("methods", () => {
  test("only GET is served", async () => {
    await expectMethodGuards(route, "/-/md", ["GET"]);
  });
});
