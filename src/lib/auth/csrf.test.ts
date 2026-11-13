import { describe, expect, test } from "bun:test";
import { isSameOrigin } from "./csrf";

const post = (headers: Record<string, string>) =>
  new Request("http://localhost/api/banners", { method: "POST", headers });

describe("isSameOrigin", () => {
  test("Fetch Metadata decides when present", () => {
    expect(isSameOrigin(post({ "sec-fetch-site": "same-origin" }))).toBe(true);
    for (const site of [
      "same-site",
      "cross-site",
      "none",
      "SAME-ORIGIN",
      "x",
    ]) {
      expect(isSameOrigin(post({ "sec-fetch-site": site }))).toBe(false);
    }
  });

  test("Fetch Metadata wins over a matching Origin", () => {
    expect(
      isSameOrigin(
        post({
          "sec-fetch-site": "cross-site",
          origin: "https://gitbanners.vercel.app",
          host: "gitbanners.vercel.app",
        }),
      ),
    ).toBe(false);
    // A sibling subdomain is same-site but not same-origin.
    expect(
      isSameOrigin(
        post({
          "sec-fetch-site": "same-site",
          origin: "https://user-content.gitbanners.vercel.app",
          host: "gitbanners.vercel.app",
        }),
      ),
    ).toBe(false);
  });

  test("without Fetch Metadata the Origin host must equal the request host", () => {
    expect(
      isSameOrigin(
        post({
          origin: "https://gitbanners.vercel.app",
          host: "gitbanners.vercel.app",
        }),
      ),
    ).toBe(true);
    expect(
      isSameOrigin(
        post({ origin: "http://localhost:3000", host: "localhost:3000" }),
      ),
    ).toBe(true);
    expect(
      isSameOrigin(
        post({ origin: "https://evil.example", host: "gitbanners.vercel.app" }),
      ),
    ).toBe(false);
    // Same name, different port.
    expect(
      isSameOrigin(
        post({ origin: "http://localhost:4000", host: "localhost:3000" }),
      ),
    ).toBe(false);
  });

  test("behind a proxy the forwarded host is the one that counts", () => {
    expect(
      isSameOrigin(
        post({
          origin: "https://gitbanners.vercel.app",
          host: "internal:3000",
          "x-forwarded-host": "gitbanners.vercel.app",
        }),
      ),
    ).toBe(true);
    expect(
      isSameOrigin(
        post({
          origin: "http://internal:3000",
          host: "internal:3000",
          "x-forwarded-host": "gitbanners.vercel.app",
        }),
      ),
    ).toBe(false);
  });

  test("opaque, malformed or missing origins are refused", () => {
    expect(isSameOrigin(post({ origin: "null", host: "localhost" }))).toBe(
      false,
    );
    expect(isSameOrigin(post({ origin: "not a url", host: "localhost" }))).toBe(
      false,
    );
    // Neither header: a script, which must not ride on the cookie.
    expect(isSameOrigin(post({ host: "gitbanners.vercel.app" }))).toBe(false);
    expect(isSameOrigin(post({}))).toBe(false);
  });
});
