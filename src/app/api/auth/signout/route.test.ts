/**
 * POST /api/auth/signout, driven directly with a fake cookie jar: what a
 * sign-out clears, who may revoke every session, and who may not.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import {
  expectMethodGuards,
  installFakeCookies,
  randomSecret,
  setEnv,
} from "../../../../../tests/e2e/auth/helpers";

// Must be in place before the handler is evaluated.
const cookies = installFakeCookies();

const { completeSignIn, requireUser } = await import("@/lib/auth/session");
const { getUser } = await import("@/lib/db/users");
const { setStore, StoreUnavailableError } = await import("@/lib/store");
const { MemoryStore } = await import("@/lib/store/memory");
const route = await import("./route");
const { POST } = route;

const profile = {
  id: 4242,
  login: "Octo-Test",
  name: null,
  avatarUrl: "https://avatars.githubusercontent.com/u/4242?v=4",
};
const SAME_ORIGIN = { "sec-fetch-site": "same-origin" };

let store = new MemoryStore();
let restore = () => {};
beforeEach(() => {
  restore = setEnv({
    NODE_ENV: "test",
    SESSION_SECRET: randomSecret(),
    SESSION_SECRET_PREVIOUS: undefined,
    // The server-side stargazer lookup must stay offline in unit tests.
    GITHUB_TOKEN: undefined,
    PRO_REPO: "disabled",
    PRO_LOGINS: undefined,
    VERCEL: undefined,
    VERCEL_ENV: undefined,
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
async function signIn(): Promise<string> {
  cookies.request();
  await completeSignIn(profile);
  return cookies.nextCookieHeader();
}

function signOut(
  cookieHeader: string,
  query = "",
  headers: Record<string, string> = SAME_ORIGIN,
): Promise<Response> {
  cookies.request(cookieHeader);
  return POST(
    new NextRequest(`http://localhost:3000/api/auth/signout${query}`, {
      method: "POST",
      headers,
    }),
  );
}

async function isSignedIn(cookieHeader: string): Promise<boolean> {
  cookies.request(cookieHeader);
  return (await requireUser()) !== null;
}

describe("POST /api/auth/signout", () => {
  test("only POST signs out: GET and the rest are 405 and touch nothing", async () => {
    const cookie = await signIn();
    cookies.request(cookie);
    await expectMethodGuards(route, "/api/auth/signout", ["POST"]);
    expect(cookies.written()).toEqual([]);
    expect(await isSignedIn(cookie)).toBe(true);
  });

  test("a form post: 303 to the home page, both cookies cleared", async () => {
    const response = await signOut(await signIn());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(cookies.written()).toEqual([
      "gb_session=; Path=/; Max-Age=0; HttpOnly; SameSite=lax",
      "gb_in=; Path=/; Max-Age=0; SameSite=lax",
    ]);
    expect(cookies.nextCookieHeader()).toBe("");
  });

  test("a fetch that accepts JSON: 200, private", async () => {
    const response = await signOut(await signIn(), "", {
      ...SAME_ORIGIN,
      accept: "application/json",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(cookies.nextCookieHeader()).toBe("");
  });

  test("signing out when nobody is signed in still succeeds", async () => {
    const response = await signOut("", "?everywhere=1");
    expect(response.status).toBe(303);
  });

  test("a cross-origin request is refused and changes nothing", async () => {
    const cookie = await signIn();
    const attempts: Record<string, string>[] = [
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      { origin: "https://evil.example", host: "localhost:3000" },
      {},
    ];
    for (const headers of attempts) {
      const response = await signOut(cookie, "?everywhere=1", headers);
      expect(response.status).toBe(403);
      expect(response.headers.get("content-type")).toBe(
        "application/problem+json",
      );
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({
        code: "cross_origin_request",
        instance: "/api/auth/signout",
      });
      expect(cookies.written()).toEqual([]);
    }
    expect(await isSignedIn(cookie)).toBe(true);
  });

  test("a plain sign-out leaves the user's other sessions alone", async () => {
    const laptop = await signIn();
    const phone = await signIn();
    await signOut(laptop);
    expect(await isSignedIn(phone)).toBe(true);
  });

  test("everywhere=1 revokes every session of the user", async () => {
    const laptop = await signIn();
    const phone = await signIn();
    const before = (await getUser("4242"))?.sv;
    const response = await signOut(laptop, "?everywhere=1");
    expect(response.status).toBe(303);
    expect(cookies.nextCookieHeader()).toBe("");
    expect((await getUser("4242"))?.sv).not.toBe(before);
    expect(await isSignedIn(laptop)).toBe(false);
    expect(await isSignedIn(phone)).toBe(false);
  });

  test("only everywhere=1 revokes; other values are a plain sign-out", async () => {
    const laptop = await signIn();
    const phone = await signIn();
    for (const query of ["?everywhere=0", "?everywhere=true", "?everywhere"]) {
      await signOut(laptop, query);
    }
    expect(await isSignedIn(phone)).toBe(true);
  });

  test("a revoked cookie cannot revoke the sessions that came after it", async () => {
    // A cookie that leaked. Its owner notices and signs out everywhere.
    const leaked = await signIn();
    await signOut(await signIn(), "?everywhere=1");
    expect(await isSignedIn(leaked)).toBe(false);

    // The owner signs in again; the leaked cookie still verifies (it is a
    // signed token and has not expired) but no longer speaks for the account.
    const fresh = await signIn();
    const versionBefore = (await getUser("4242"))?.sv;
    const response = await signOut(leaked, "?everywhere=1");

    // Its own browser is signed out, as asked...
    expect(response.status).toBe(303);
    expect(cookies.nextCookieHeader()).toBe("");
    // ...and nobody else is.
    expect((await getUser("4242"))?.sv).toBe(versionBefore);
    expect(await isSignedIn(fresh)).toBe(true);
  });

  test("a cookie from a deleted account revokes nothing after re-registering", async () => {
    const { deleteUser } = await import("@/lib/db/users");
    const old = await signIn();
    await deleteUser("4242");
    const fresh = await signIn();
    await signOut(old, "?everywhere=1");
    expect(await isSignedIn(fresh)).toBe(true);
  });

  test("everywhere=1 during a database outage: 503, and the cookies stay", async () => {
    const cookie = await signIn();
    const outage = new Proxy(store, {
      get(target, property, receiver) {
        if (property === "get" || property === "set") {
          return async () => {
            throw new StoreUnavailableError(new Error("ECONNRESET"));
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    setStore(outage);
    const response = await signOut(cookie, "?everywhere=1");
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json",
    );
    expect(response.headers.get("retry-after")).toBe("5");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      code: "unavailable",
      instance: "/api/auth/signout",
    });
    // Nothing was cleared: claiming success would be a lie.
    expect(cookies.written()).toEqual([]);

    // A plain sign-out needs no database and works throughout.
    expect((await signOut(cookie)).status).toBe(303);
    expect(cookies.nextCookieHeader()).toBe("");
  });
});
