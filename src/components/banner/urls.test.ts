import { describe, expect, test } from "bun:test";
import { downloadHref } from "./urls";

describe("downloadHref", () => {
  test("defaults to a PNG of the default preset", () => {
    expect(downloadHref({ kind: "owner", login: "Torvalds" })).toBe(
      "/torvalds.png?download=1",
    );
  });
  test("keeps preset and options in front of the download flag", () => {
    expect(
      downloadHref(
        { kind: "repo", owner: "vercel", name: "next.js" },
        { preset: "contributors", query: "theme=dracula", format: "svg" },
      ),
    ).toBe("/vercel/next.js/contributors.svg?theme=dracula&download=1");
  });
  test("accepts a query with its question mark", () => {
    expect(
      downloadHref({ kind: "owner", login: "vercel" }, { query: "?size=x" }),
    ).toBe("/vercel.png?size=x&download=1");
  });
  test("stays relative: the file comes from the deployment in use", () => {
    expect(
      downloadHref({ kind: "owner", login: "vercel" }).startsWith("/"),
    ).toBe(true);
  });
});
