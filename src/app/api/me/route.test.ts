/**
 * GET and DELETE /api/me, driven directly with a fake cookie jar: what the
 * session endpoint reveals to whom, when it clears or renews cookies, and
 * what an account deletion removes.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SignJWT } from "jose";
import {
  expectMethodGuards,
  installFakeCookies,
  randomSecret,
  setEnv,
} from "../../../../tests/e2e/auth/helpers";

// Must be in place before the handlers are evaluated.
const cookies = installFakeCookies();

const { completeSignIn, getSession, requireUser } = await import(
  "@/lib/auth/session"
);
const { createBanner, getBanner, setDefaultBanner } = await import(
  "@/lib/db/banners"
);
const { bumpSessionVersion, deleteUser, getUser } = await import(
  "@/lib/db/users"
);
const { FREE, PRO } = await import("@/lib/pro");
const { setStore, StoreUnavailableError } = await import("@/lib/store");
const { MemoryStore } = await import("@/lib/store/memory");
const route = await import("./route");
const { DELETE, GET } = route;

const PROBLEM = "application/problem+json";
const SAME_ORIGIN = { "sec-fetch-site": "same-origin" };
const alice = {
  id: 4242,
  login: "Alice",
  name: "Alice A.",
  avatarUrl: "https://avatars.githubusercontent.com/u/4242?v=4",
};
const bob = { id: 5151, login: "Bob", name: null, avatarUrl: "" };
const input = {
  name: "Mine",
  target: { kind: "owner", login: "torvalds" },
  preset: null,
  query: "",
} as const;

let store = new MemoryStore();
let secret = "";
let restore = () => {};
beforeEach(() => {
  secret = randomSecret();
  restore = setEnv({
    NODE_ENV: "test",
    SESSION_SECRET: secret,
    SESSION_SECRET_PREVIOUS: undefined,
    // The server-side stargazer lookup must stay offline in unit tests.
    GITHUB_TOKEN: undefined,
    PRO_REPO: "disabled",
    // Bob is Pro, Alice is on the free plan.
    PRO_LOGINS: "bob",
    VERCEL: undefined,
    VERCEL_ENV: undefined,
    KV_REST_API_URL: undefined,
    KV_REST_API_TOKEN: undefined,
    UPSTASH_REDIS_REST_URL: undefined,
    UPSTASH_REDIS_REST_TOKEN: undefined,
  });
  store = new MemoryStore();
  setStore(store);
  cookies.request();
});
afterEach(() => {
  restore();
  setStore(undefined);
});

/** Signs in and returns the `Cookie` header that browser now sends. */
async function signIn(profile: typeof alice | typeof bob): Promise<string> {
  cookies.request();
  await completeSignIn(profile);
  return cookies.nextCookieHeader();
}

function me(cookieHeader: string): Promise<Response> {
  cookies.request(cookieHeader);
  return GET();
}

function remove(
  cookieHeader: string,
  headers: Record<string, string> = SAME_ORIGIN,
): Promise<Response> {
  cookies.request(cookieHeader);
  return DELETE(
    new Request("http://localhost:3000/api/me", { method: "DELETE", headers }),
  );
}

const ANONYMOUS = {
  user: null,
  pro: false,
  entitlements: FREE,
  banners: { count: 0, max: 3 },
};

describe("GET /api/me", () => {
  test("anonymous: the free plan, private, and no cookie is written", async () => {
    const response = await me("");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(ANONYMOUS);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(cookies.written()).toEqual([]);
  });

  test("signed in: exactly the public profile, the plan and the banner count", async () => {
    const cookie = await signIn(alice);
    await createBanner("4242", input, 3);
    const response = await me(cookie);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(await response.json()).toEqual({
      user: {
        id: "4242",
        login: "Alice",
        name: "Alice A.",
        avatarUrl: "https://avatars.githubusercontent.com/u/4242?v=4",
      },
      pro: false,
      entitlements: FREE,
      banners: { count: 1, max: 3 },
    });
    // A cookie younger than a day is not re-issued.
    expect(cookies.written()).toEqual([]);
  });

  test("Pro: the Pro plan and its quota", async () => {
    const body = await (await me(await signIn(bob))).json();
    expect(body).toMatchObject({
      user: { id: "5151", login: "Bob", name: null },
      pro: true,
      entitlements: PRO,
      banners: { count: 0, max: 50 },
    });
  });

  test("the answer never contains the session version or timestamps", async () => {
    const text = await (await me(await signIn(alice))).text();
    const user = await getUser("4242");
    expect(text).not.toContain(String(user?.sv));
    expect(text).not.toContain("createdAt");
    expect(text).not.toContain('"sv"');
  });

  test("a forged or foreign-signed cookie is nobody, and is left alone", async () => {
    const forged = await new SignJWT({ login: "Alice", name: null, sv: 1 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("4242")
      .setIssuer("gitbanners")
      .setAudience("gb:session")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new Uint8Array(Buffer.from(randomSecret(), "base64")));
    await signIn(alice);
    for (const value of ["not-a-jwt", forged]) {
      const response = await me(`gb_session=${value}; gb_in=1`);
      expect(await response.json()).toEqual(ANONYMOUS);
      // Not cleared: a cookie that fails verification may be valid again (a
      // deployment that briefly ran with the wrong secret must not sign
      // everybody out). Only a session the database disowns is removed.
      expect(cookies.written()).toEqual([]);
    }
  });

  test("a revoked session is nobody and its cookies are cleared", async () => {
    const cookie = await signIn(alice);
    await bumpSessionVersion("4242");
    const response = await me(cookie);
    expect(await response.json()).toEqual(ANONYMOUS);
    expect(cookies.written()).toEqual([
      "gb_session=; Path=/; Max-Age=0; HttpOnly; SameSite=lax",
      "gb_in=; Path=/; Max-Age=0; SameSite=lax",
    ]);
  });

  test("a deleted account is nobody, also after signing up again", async () => {
    const old = await signIn(alice);
    await deleteUser("4242");
    expect(await (await me(old)).json()).toEqual(ANONYMOUS);
    expect(cookies.nextCookieHeader()).toBe("");

    await signIn(alice);
    expect((await (await me(old)).json()).user).toBeNull();
  });

  test("sliding expiry: a cookie older than a day is re-issued with fresh profile data", async () => {
    await signIn(alice);
    const user = await getUser("4242");
    const dayAndABit = Math.floor(Date.now() / 1000) - 90_000;
    const aged = await new SignJWT({
      login: "Old-Login",
      name: null,
      avatarUrl: "",
      sv: user?.sv,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("4242")
      .setIssuer("gitbanners")
      .setAudience("gb:session")
      .setIssuedAt(dayAndABit)
      .setExpirationTime(dayAndABit + 30 * 86_400)
      .sign(new Uint8Array(Buffer.from(secret, "base64")));

    const response = await me(`gb_session=${aged}; gb_in=1`);
    expect((await response.json()).user.login).toBe("Alice");
    expect(cookies.written().map((line) => line.split("=")[0])).toEqual([
      "gb_session",
      "gb_in",
    ]);
    cookies.request(cookies.nextCookieHeader());
    const renewed = await getSession();
    // The login in the cookie follows the account record.
    expect(renewed?.login).toBe("Alice");
    expect(renewed?.iat).toBeGreaterThan(dayAndABit + 80_000);
    expect(renewed?.sv).toBe(user?.sv ?? -1);
  });

  test("a revoked cookie is never renewed, however old it is", async () => {
    await signIn(alice);
    const before = await getUser("4242");
    await bumpSessionVersion("4242");
    const dayAndABit = Math.floor(Date.now() / 1000) - 90_000;
    const aged = await new SignJWT({
      login: "Alice",
      name: null,
      avatarUrl: "",
      sv: before?.sv,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("4242")
      .setIssuer("gitbanners")
      .setAudience("gb:session")
      .setIssuedAt(dayAndABit)
      .setExpirationTime(dayAndABit + 30 * 86_400)
      .sign(new Uint8Array(Buffer.from(secret, "base64")));
    const response = await me(`gb_session=${aged}; gb_in=1`);
    expect((await response.json()).user).toBeNull();
    expect(cookies.nextCookieHeader()).toBe("");
  });

  test("accounts not configured: a valid cookie is nobody and is left alone", async () => {
    const cookie = await signIn(alice);
    setEnv({ VERCEL: "1" });
    const response = await me(cookie);
    expect(await response.json()).toEqual(ANONYMOUS);
    expect(cookies.written()).toEqual([]);

    setEnv({ VERCEL: undefined, SESSION_SECRET: undefined });
    expect(await (await me(cookie)).json()).toEqual(ANONYMOUS);
    expect(cookies.written()).toEqual([]);
  });

  test("a database outage is a 503 problem, private, with Retry-After", async () => {
    const cookie = await signIn(alice);
    setStore(
      new Proxy(store, {
        get(target, property, receiver) {
          if (property === "get") {
            return async () => {
              throw new StoreUnavailableError(new Error("ECONNRESET"));
            };
          }
          return Reflect.get(target, property, receiver);
        },
      }),
    );
    const response = await me(cookie);
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toBe(PROBLEM);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await response.json()).toMatchObject({
      code: "unavailable",
      instance: "/api/me",
    });
    // The session survives the outage.
    expect(cookies.written()).toEqual([]);
  });
});

test("methods /api/me does not have are 405 problems that name the real ones", async () => {
  await expectMethodGuards(route, "/api/me", ["GET", "DELETE"]);
});

describe("DELETE /api/me", () => {
  test("anonymous: 401; cross-origin: 403; neither deletes anything", async () => {
    const cookie = await signIn(alice);
    const anonymous = await remove("");
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("content-type")).toBe(PROBLEM);

    const attempts: Record<string, string>[] = [
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      { origin: "https://evil.example", host: "localhost:3000" },
      {},
    ];
    for (const headers of attempts) {
      const response = await remove(cookie, headers);
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("cross_origin_request");
    }
    expect(await getUser("4242")).not.toBeNull();
  });

  test("removes the record, login index, Pro cache and every banner; signs out", async () => {
    const cookie = await signIn(bob);
    const first = await createBanner("5151", input, 50);
    const second = await createBanner("5151", input, 50);
    if (!first.ok || !second.ok) throw new Error("setup failed");
    await setDefaultBanner({ id: "5151", login: "Bob" }, first.banner.id);

    // Someone else, who must not be affected.
    const aliceCookie = await signIn(alice);
    const hers = await createBanner("4242", input, 3);
    if (!hers.ok) throw new Error("setup failed");

    const response = await remove(cookie);
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(cookies.written()).toEqual([
      "gb_session=; Path=/; Max-Age=0; HttpOnly; SameSite=lax",
      "gb_in=; Path=/; Max-Age=0; SameSite=lax",
    ]);

    expect(
      await store.mget([
        "user:5151",
        "login:bob",
        "pro:5151",
        `banner:${first.banner.id}`,
        `banner:${second.banner.id}`,
      ]),
    ).toEqual([null, null, null, null, null]);
    expect(await store.zcard("user:5151:banners")).toBe(0);

    // The deleted account's cookie is dead...
    cookies.request(cookie);
    expect(await requireUser()).toBeNull();
    // ...and the other account is whole.
    expect(await getBanner(hers.banner.id)).not.toBeNull();
    expect((await (await me(aliceCookie)).json()).banners.count).toBe(1);
  });

  test("a revoked session cannot delete the account", async () => {
    const cookie = await signIn(alice);
    await bumpSessionVersion("4242");
    expect((await remove(cookie)).status).toBe(401);
    expect(await getUser("4242")).not.toBeNull();
  });
});
