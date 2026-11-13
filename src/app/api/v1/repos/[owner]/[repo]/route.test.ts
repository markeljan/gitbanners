/**
 * GET /api/v1/repos/{owner}/{repo}, called the way Next calls it: route
 * params arrive already URL-decoded. The bundled samples answer, no network.
 */
import { describe, expect, test } from "bun:test";
import { GET } from "./route";

function get(publicPath: string, owner: string, repo: string) {
  return GET(new Request(`http://localhost${publicPath}`), {
    params: Promise.resolve({ owner, repo }),
  });
}

describe("owner and repo", () => {
  test("a stray percent sign is a 400, not a 500", async () => {
    for (const [path, owner, repo] of [
      ["/api/v1/repos/vercel/%25", "vercel", "%"],
      ["/api/v1/repos/%25/next.js", "%", "next.js"],
      ["/api/v1/repos/vercel/%2525", "vercel", "%25"],
    ]) {
      const response = await get(path, owner, repo);
      expect(`${path}: ${response.status}`).toBe(`${path}: 400`);
      expect(await response.json()).toMatchObject({ code: "invalid_request" });
    }
  });

  test("decoded names are used as they are", async () => {
    const response = await get(
      "/api/v1/repos/vercel/next%2Ejs",
      "vercel",
      "next.js",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ fullName: "vercel/next.js" });
  });
});
