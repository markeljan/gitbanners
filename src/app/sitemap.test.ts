import { afterEach, describe, expect, test } from "bun:test";
import sitemap from "./sitemap";

const paths = () => sitemap().map((entry) => new URL(entry.url).pathname);
const saved = process.env.GITHUB_TOKEN;

afterEach(() => {
  if (saved === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = saved;
});

describe("sitemap", () => {
  test("without a GitHub token, only repository pages that can be built", () => {
    delete process.env.GITHUB_TOKEN;
    const listed = paths();
    expect(listed).toContain("/torvalds");
    expect(listed).toContain("/vercel/next.js");
    expect(listed).toContain("/docs");
    expect(listed).not.toContain("/react/react");
    expect(listed).not.toContain("/vercel/satori");
  });

  test("with a token, every showcase repository", () => {
    process.env.GITHUB_TOKEN = "server-token";
    const listed = paths();
    expect(listed).toContain("/react/react");
    expect(listed).toContain("/vercel/satori");
  });
});
