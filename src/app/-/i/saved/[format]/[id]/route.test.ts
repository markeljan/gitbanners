/**
 * The saved-banner image handler, called the way the rewrites call it. No
 * store is configured, so every id is a banner that no longer exists: that
 * is still a 200 image.
 */
import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import * as route from "./route";

function get(publicPath: string, params: { format: string; id: string }) {
  return route.GET(new NextRequest(`http://localhost${publicPath}`), {
    params: Promise.resolve(params),
  });
}

describe("format", () => {
  test("an upper-case suffix is the same image", async () => {
    for (const [format, type] of [
      ["SVG", "image/svg+xml"],
      ["PNG", "image/png"],
      ["Png", "image/png"],
      ["svg", "image/svg+xml"],
    ] as const) {
      const response = await get(`/b/abc123.${format}`, {
        format,
        id: "abc123",
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toStartWith(type);
      expect(response.headers.get("content-disposition")).toBe(
        `inline; filename="banner.${format.toLowerCase()}"`,
      );
    }
  });

  test("an unknown format is not an image route", async () => {
    const response = await get("/-/i/saved/gif/abc123", {
      format: "gif",
      id: "abc123",
    });
    expect(response.status).toBe(404);
  });
});
