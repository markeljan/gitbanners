/**
 * GET /api/v1/owners/{login}, called the way Next calls it: route params
 * arrive already URL-decoded. The bundled samples answer, no network.
 */
import { describe, expect, test } from "bun:test";
import { GET } from "./route";

function get(publicPath: string, login: string) {
  return GET(new Request(`http://localhost${publicPath}`), {
    params: Promise.resolve({ login }),
  });
}

describe("login", () => {
  test("a stray percent sign is a 400, not a 500", async () => {
    // `/owners/%25` arrives as "%", `/owners/%2525` as "%25".
    for (const [path, login] of [
      ["/api/v1/owners/%25", "%"],
      ["/api/v1/owners/%2525", "%25"],
      ["/api/v1/owners/%E0%A4%A", "%E0%A4%A"],
    ]) {
      const response = await get(path, login);
      expect(`${path}: ${response.status}`).toBe(`${path}: 400`);
      expect(await response.json()).toMatchObject({ code: "invalid_request" });
    }
  });

  test("a decoded login is used as it is", async () => {
    const response = await get("/api/v1/owners/%76ercel", "vercel");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ login: "vercel" });
  });
});
