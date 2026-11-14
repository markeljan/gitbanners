/**
 * The banner image handler, called the way the rewrites call it: the request
 * keeps its public URL, the rewritten path arrives as route params. GitHub
 * is never asked: the targets used have bundled samples, and the rest never
 * parse.
 */
import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import * as route from "./route";

interface Params {
  format: string;
  owner: string;
  rest?: string[];
}

function get(
  publicPath: string,
  params: Params,
  accept = "image/avif,image/webp,image/*,*/*;q=0.8",
) {
  return route.GET(
    new NextRequest(`http://localhost${publicPath}`, { headers: { accept } }),
    { params: Promise.resolve(params) },
  );
}

async function expectImage(
  response: Response,
  contentType: string,
  state: string,
) {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toStartWith(contentType);
  expect(response.headers.get("x-banner-state")).toBe(state);
  expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
}

describe("format", () => {
  test("an upper-case suffix is the same image", async () => {
    await expectImage(
      await get("/markeljan.SVG", { format: "SVG", owner: "markeljan" }),
      "image/svg+xml",
      "ok",
    );
    await expectImage(
      await get("/markeljan.Png", { format: "Png", owner: "markeljan" }),
      "image/png",
      "ok",
    );
    const response = await get("/vercel/next.js/contributors.SVG", {
      format: "SVG",
      owner: "vercel",
      rest: ["next.js", "contributors"],
    });
    expect(response.headers.get("content-disposition")).toBe(
      'inline; filename="vercel-next.js-contributors.svg"',
    );
    await expectImage(response, "image/svg+xml", "ok");
  });

  test("an unknown format is not an image route", async () => {
    const response = await get("/-/i/gif/vercel", {
      format: "gif",
      owner: "vercel",
    });
    expect(response.status).toBe(404);
  });
});

describe("paths", () => {
  test("an overlong login is a cacheable not_found SVG", async () => {
    const owner = "a".repeat(40);
    const response = await get(`/${owner}.svg`, { format: "svg", owner });
    await expectImage(response, "image/svg+xml", "not_found");
    expect(response.headers.get("cache-control")).not.toContain("no-store");
  });

  test("/embed/{login} reaches a login named like an app route", async () => {
    // next.config.ts hands /embed/docs over as "@docs".
    const response = await get("/embed/docs.svg", {
      format: "svg",
      owner: "%40docs",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'inline; filename="docs-overview.svg"',
    );
  });

  test("a path that is no banner is still a 200 image", async () => {
    const cases: [string, Params][] = [
      // A reserved name without "@" that reached the handler some other way.
      ["/-/i/auto/docs", { format: "auto", owner: "docs" }],
      [
        "/embed/vercel/a/b/c",
        { format: "auto", owner: "vercel", rest: ["a", "b", "c"] },
      ],
      [
        "/vercel/bad%20name.png",
        { format: "png", owner: "vercel", rest: ["bad name"] },
      ],
      ["/embed/%25", { format: "SVG", owner: "%" }],
    ];
    for (const [publicPath, params] of cases) {
      const response = await get(publicPath, params);
      const type =
        params.format.toLowerCase() === "png" ? "image/png" : "image/svg+xml";
      await expectImage(response, type, "not_found");
      expect(response.headers.get("cache-control")).not.toContain("no-store");
    }
  });
});
