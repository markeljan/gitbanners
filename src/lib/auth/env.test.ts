import { afterEach, describe, expect, test } from "bun:test";
import { randomSecret, setEnv } from "../../../tests/e2e/auth/helpers";
import { site } from "../site";
import { setStore } from "../store";
import {
  accountsAvailable,
  canonicalOrigin,
  env,
  githubSignInAvailable,
  redirectTo,
  requestOrigin,
} from "./env";

const request = (headers: Record<string, string>) =>
  new Request("http://localhost:3000/api/auth/github", { headers });

let undo: (() => void)[] = [];
function setTestEnv(vars: Record<string, string | undefined>): void {
  undo.push(setEnv(vars));
  setStore(undefined);
}
afterEach(() => {
  for (const restore of undo.reverse()) restore();
  undo = [];
  setStore(undefined);
});

describe("requestOrigin", () => {
  test("uses the forwarded host and protocol, not request.url", () => {
    expect(
      requestOrigin(
        request({
          host: "localhost:3000",
          "x-forwarded-host": "gitbanners.vercel.app",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://gitbanners.vercel.app");
  });

  test("falls back to Host, and to https when no protocol is forwarded", () => {
    expect(
      requestOrigin(
        request({ host: "127.0.0.1:3111", "x-forwarded-proto": "http" }),
      ),
    ).toBe("http://127.0.0.1:3111");
    expect(requestOrigin(request({ host: "gitbanners.vercel.app" }))).toBe(
      "https://gitbanners.vercel.app",
    );
  });

  test("takes the first entry of a proxy chain", () => {
    expect(
      requestOrigin(
        request({
          "x-forwarded-host": "gitbanners.vercel.app, internal.lb",
          "x-forwarded-proto": "https, http",
        }),
      ),
    ).toBe("https://gitbanners.vercel.app");
  });

  test("normalises case and default ports so equal origins compare equal", () => {
    expect(
      requestOrigin(
        request({
          "x-forwarded-host": "GitBanners.Vercel.App:443",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://gitbanners.vercel.app");
  });

  test("a host that is not a host falls back to the request URL", () => {
    expect(
      requestOrigin(
        request({
          "x-forwarded-host": "bad host/",
          "x-forwarded-proto": "http",
        }),
      ),
    ).toBe("http://localhost:3000");
  });
});

describe("canonicalOrigin", () => {
  const preview = request({
    "x-forwarded-host": "gitbanners-git-feature.vercel.app",
    "x-forwarded-proto": "https",
  });

  test("in production it is the site URL, whatever host was used", () => {
    setTestEnv({ NODE_ENV: "production" });
    expect(canonicalOrigin(preview)).toBe(new URL(site.url).origin);
    expect(canonicalOrigin(preview)).not.toBe(requestOrigin(preview));
  });

  test("in development it is the address the developer typed", () => {
    setTestEnv({ NODE_ENV: "development" });
    const local = request({
      host: "127.0.0.1:3111",
      "x-forwarded-proto": "http",
    });
    expect(canonicalOrigin(local)).toBe("http://127.0.0.1:3111");
    expect(canonicalOrigin(preview)).toBe(requestOrigin(preview));
  });
});

describe("redirectTo", () => {
  test("relative Location, never cached", () => {
    const response = redirectTo("/studio?auth_error=access_denied");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/studio?auth_error=access_denied",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(redirectTo("/", 307).status).toBe(307);
  });
});

describe("configuration checks", () => {
  const CONFIGURED = {
    SESSION_SECRET: randomSecret(),
    GITHUB_CLIENT_ID: "client",
    GITHUB_CLIENT_SECRET: "secret",
    VERCEL: undefined,
    VERCEL_ENV: undefined,
    KV_REST_API_URL: undefined,
    KV_REST_API_TOKEN: undefined,
    UPSTASH_REDIS_REST_URL: undefined,
    UPSTASH_REDIS_REST_TOKEN: undefined,
  };

  test("everything in place", () => {
    setTestEnv(CONFIGURED);
    expect(accountsAvailable()).toBe(true);
    expect(githubSignInAvailable()).toBe(true);
  });

  test("no session secret: no accounts", () => {
    setTestEnv({ ...CONFIGURED, SESSION_SECRET: undefined });
    expect(accountsAvailable()).toBe(false);
    expect(githubSignInAvailable()).toBe(false);
  });

  test("no database on Vercel: no accounts, but nothing throws", () => {
    setTestEnv({ ...CONFIGURED, VERCEL: "1" });
    expect(accountsAvailable()).toBe(false);
    expect(githubSignInAvailable()).toBe(false);
    setTestEnv({
      KV_REST_API_URL: "https://x.upstash.io",
      KV_REST_API_TOKEN: "t",
    });
    expect(accountsAvailable()).toBe(true);
  });

  test("no GitHub app credentials: accounts exist, GitHub sign-in does not", () => {
    setTestEnv({ ...CONFIGURED, GITHUB_CLIENT_SECRET: undefined });
    expect(accountsAvailable()).toBe(true);
    expect(githubSignInAvailable()).toBe(false);
    setTestEnv({ GITHUB_CLIENT_SECRET: "secret", GITHUB_CLIENT_ID: "" });
    expect(githubSignInAvailable()).toBe(false);
  });

  test("the getters name the missing variable", () => {
    setTestEnv({ GITHUB_CLIENT_ID: undefined, GITHUB_CLIENT_SECRET: "s" });
    expect(() => env.githubClientId).toThrow("GITHUB_CLIENT_ID");
    expect(env.githubClientSecret).toBe("s");
  });
});
