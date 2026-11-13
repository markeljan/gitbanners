import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  installFakeCookies,
  randomSecret,
  setEnv,
} from "../../../tests/e2e/auth/helpers";

// Must be in place before the module under test is evaluated.
const cookies = installFakeCookies();

const { bumpSessionVersion, deleteUser, getUser, upsertUser } = await import(
  "../db/users"
);
const { setStore, StoreUnavailableError } = await import("../store");
const { MemoryStore } = await import("../store/memory");
const { signSession, signSignInTx } = await import("./session-token");
const {
  clearSessionCookie,
  completeSignIn,
  consumeSignInCookie,
  cookieNames,
  getSession,
  loginChanged,
  refreshSessionCookie,
  requireUser,
  setSessionCookie,
  setSignInCookie,
  withUser,
} = await import("./session");

const claims = {
  uid: "4242",
  login: "Octo-Test",
  name: null,
  avatarUrl: "https://avatars.githubusercontent.com/u/4242?v=4",
  sv: 1,
};
const profile = {
  id: 4242,
  login: "Octo-Test",
  name: "Octo",
  avatarUrl: "https://avatars.githubusercontent.com/u/4242?v=4",
};
const tx = {
  state: "s".repeat(43),
  codeVerifier: "v".repeat(43),
  returnTo: "/",
};

let store = new MemoryStore();
let restore = () => {};
beforeEach(() => {
  restore = setEnv({
    NODE_ENV: "test",
    SESSION_SECRET: randomSecret(),
    SESSION_SECRET_PREVIOUS: undefined,
    // Star checks off: these tests must never reach for the network.
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

const production = () => setEnv({ NODE_ENV: "production" });
/** Strips the value and the wall-clock `Expires` so lines can be compared. */
const shape = (line: string) =>
  line.replace(/=[^;]*/, "=<v>").replace(/ Expires=[^;]+;/, "");

describe("cookie names and flags", () => {
  test("__Host- prefix in production, plain names in development", () => {
    expect(cookieNames(true)).toEqual({
      session: "__Host-gb_session",
      signIn: "__Host-gb_signin",
      hint: "__Host-gb_in",
    });
    expect(cookieNames(false)).toEqual({
      session: "gb_session",
      signIn: "gb_signin",
      hint: "gb_in",
    });
    expect(cookieNames()).toEqual(cookieNames(false));
    production();
    expect(cookieNames()).toEqual(cookieNames(true));
  });

  test("no cookie name spells out the protocol", () => {
    for (const secure of [true, false]) {
      for (const name of Object.values(cookieNames(secure))) {
        expect(name).not.toMatch(/oauth/i);
      }
    }
  });

  test("production: Secure, HttpOnly session and a script-readable hint, 30 days", async () => {
    production();
    await setSessionCookie(claims);
    expect(cookies.written().map(shape)).toEqual([
      "__Host-gb_session=<v>; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=lax",
      "__Host-gb_in=<v>; Path=/; Max-Age=2592000; Secure; SameSite=lax",
    ]);
    expect(cookies.written()[1]).toStartWith("__Host-gb_in=1;");
  });

  test("development: the same without Secure, so plain http://localhost works", async () => {
    await setSessionCookie(claims);
    expect(cookies.written().map(shape)).toEqual([
      "gb_session=<v>; Path=/; Max-Age=2592000; HttpOnly; SameSite=lax",
      "gb_in=<v>; Path=/; Max-Age=2592000; SameSite=lax",
    ]);
  });

  test("the session cookie holds a session and no more than a few hundred bytes", async () => {
    await setSessionCookie(claims);
    const value = cookies.written()[0].split(";")[0].split("=")[1];
    expect(value.length).toBeLessThan(600);
    cookies.request(cookies.nextCookieHeader());
    expect(await getSession()).toMatchObject(claims);
  });
});

describe("the __Host- deletion trap", () => {
  test("clearing writes Secure + Path=/ + Max-Age=0, which a browser accepts", async () => {
    production();
    await clearSessionCookie();
    expect(cookies.written()).toEqual([
      "__Host-gb_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=lax",
      "__Host-gb_in=; Path=/; Max-Age=0; Secure; SameSite=lax",
    ]);
  });

  test("why not cookies().delete(): Next emits no Secure, so browsers ignore it", async () => {
    const { cookies: nextCookies } = await import("next/headers");
    (await nextCookies()).delete("__Host-gb_session");
    const [line] = cookies.written();
    expect(line).toStartWith("__Host-gb_session=;");
    // If this ever starts failing, Next fixed delete() and the workaround in
    // clearSessionCookie() can go.
    expect(line).not.toContain("Secure");
  });

  test("sign-in then sign-out leaves no cookie behind", async () => {
    production();
    await setSessionCookie(claims);
    cookies.request(cookies.nextCookieHeader());
    expect(await getSession()).not.toBeNull();
    await clearSessionCookie();
    expect(cookies.nextCookieHeader()).toBe("");
  });

  test("the transaction cookie is cleared the same way", async () => {
    production();
    await consumeSignInCookie();
    expect(cookies.written()).toEqual([
      "__Host-gb_signin=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=lax",
    ]);
  });
});

describe("getSession", () => {
  test("null without a cookie or with garbage", async () => {
    expect(await getSession()).toBeNull();
    cookies.request("gb_session=not-a-jwt");
    expect(await getSession()).toBeNull();
  });

  test("reads the cookie of the current mode only", async () => {
    const token = await signSession(claims);
    cookies.request(`gb_session=${token}`);
    expect(await getSession()).toMatchObject(claims);
    // A plain-named cookie could be planted from a sibling subdomain; in
    // production only the __Host- one counts.
    production();
    expect(await getSession()).toBeNull();
    cookies.request(`__Host-gb_session=${token}`);
    expect(await getSession()).toMatchObject(claims);
  });

  test("is not memoised across requests", async () => {
    cookies.request(`gb_session=${await signSession(claims)}`);
    expect((await getSession())?.login).toBe("Octo-Test");
    cookies.request(
      `gb_session=${await signSession({ ...claims, login: "Other" })}`,
    );
    expect((await getSession())?.login).toBe("Other");
    cookies.request();
    expect(await getSession()).toBeNull();
  });

  test("a transaction token in the session cookie is not a session", async () => {
    cookies.request(`gb_session=${await signSignInTx(tx)}`);
    expect(await getSession()).toBeNull();
  });
});

describe("sliding expiry", () => {
  test("re-issues only when the cookie is older than a day", async () => {
    const now = Math.floor(Date.now() / 1000);
    await refreshSessionCookie({ ...claims, iat: now - 3600, exp: now + 1 });
    expect(cookies.written()).toEqual([]);
    await refreshSessionCookie({
      ...claims,
      login: "Renamed",
      iat: now - 90_000,
      exp: now + 1,
    });
    expect(cookies.written().length).toBe(2);
    cookies.request(cookies.nextCookieHeader());
    const session = await getSession();
    expect(session?.login).toBe("Renamed");
    expect(session?.iat).toBeGreaterThanOrEqual(now);
  });
});

describe("sign-in transaction cookie", () => {
  test("ten minutes, HttpOnly, and consumed exactly once", async () => {
    await setSignInCookie(tx);
    expect(cookies.written().map(shape)).toEqual([
      "gb_signin=<v>; Path=/; Max-Age=600; HttpOnly; SameSite=lax",
    ]);
    cookies.request(cookies.nextCookieHeader());
    expect(await consumeSignInCookie()).toEqual(tx);
    expect(cookies.written()).toEqual([
      "gb_signin=; Path=/; Max-Age=0; HttpOnly; SameSite=lax",
    ]);
    cookies.request(cookies.nextCookieHeader());
    expect(await consumeSignInCookie()).toBeNull();
  });

  test("fits a browser's 4096-byte cookie limit with the longest returnTo", async () => {
    setEnv({ NODE_ENV: "production" });
    await setSignInCookie({ ...tx, returnTo: `/x?${"a".repeat(2557)}` });
    const [pair] = cookies.written()[0].split(";");
    expect(pair.length).toBeLessThan(4096);
    cookies.request(cookies.nextCookieHeader());
    expect((await consumeSignInCookie())?.returnTo.length).toBe(2560);
  });

  test("a session token is not a transaction", async () => {
    cookies.request(`gb_signin=${await signSession(claims)}`);
    expect(await consumeSignInCookie()).toBeNull();
  });
});

describe("completeSignIn and requireUser", () => {
  test("creates the account, decides Pro and starts the session", async () => {
    const user = await completeSignIn(profile);
    expect(user).toMatchObject({
      id: "4242",
      login: "Octo-Test",
      name: "Octo",
    });
    expect(await getUser("4242")).toEqual(user);
    expect(await store.get("pro:4242")).toMatchObject({
      pro: false,
      source: null,
    });
    expect(cookies.written().map((line) => line.split("=")[0])).toEqual([
      "gb_session",
      "gb_in",
    ]);

    cookies.request(cookies.nextCookieHeader());
    const auth = await requireUser();
    expect(auth?.user).toEqual(user);
    expect(auth?.session).toMatchObject({ uid: "4242", sv: user.sv });
  });

  test("an allowlisted login signs in as Pro", async () => {
    setEnv({ PRO_LOGINS: "octo-test" });
    await completeSignIn(profile, { accessToken: "gho_never_used" });
    expect(await store.get("pro:4242")).toMatchObject({
      pro: true,
      source: "allowlist",
    });
  });

  test("the access token is not written anywhere", async () => {
    await completeSignIn(profile, { accessToken: "gho_SECRET_TOKEN_VALUE" });
    const dump = JSON.stringify([
      await store.mget(["user:4242", "pro:4242", "login:octo-test"]),
      cookies.written(),
    ]);
    expect(dump).not.toContain("gho_SECRET_TOKEN_VALUE");
    expect(await store.get("tok:4242")).toBeNull();
  });

  test("requireUser: no cookie, revoked session, deleted account", async () => {
    expect(await requireUser()).toBeNull();

    await completeSignIn(profile);
    const signedIn = cookies.nextCookieHeader();
    cookies.request(signedIn);
    expect(await requireUser()).not.toBeNull();

    // "Sign out everywhere" on another device.
    await bumpSessionVersion("4242");
    expect(await requireUser()).toBeNull();
    // The cookie itself still verifies: only the record check catches this.
    expect(await getSession()).not.toBeNull();

    await upsertUser({
      id: "4242",
      login: "Octo-Test",
      name: null,
      avatarUrl: "",
    });
    await deleteUser("4242");
    expect(await requireUser()).toBeNull();
  });

  test("a cookie from before the account was deleted stays dead after re-registering", async () => {
    await completeSignIn(profile);
    const oldCookie = cookies.nextCookieHeader();
    await deleteUser("4242");
    cookies.request();
    await completeSignIn(profile);
    cookies.request(oldCookie);
    expect(await getSession()).not.toBeNull();
    expect(await requireUser()).toBeNull();
  });
});

describe("withUser", () => {
  const SAME_ORIGIN = { "sec-fetch-site": "same-origin" };
  const call = (
    init: RequestInit & { headers?: Record<string, string> } = {},
    handler: Parameters<typeof withUser>[2] = async () =>
      Response.json({ ok: true }),
    options: Parameters<typeof withUser>[1] = { policy: "api" },
  ) =>
    withUser(
      new Request("http://localhost/api/banners", init),
      options,
      handler,
    );

  async function signedIn(): Promise<void> {
    await completeSignIn(profile);
    cookies.request(cookies.nextCookieHeader());
  }

  test("anonymous: 401 problem, private, handler not called", async () => {
    let called = false;
    const response = await call({}, async () => {
      called = true;
      return new Response();
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      code: "unauthorized",
      instance: "/api/banners",
      resolution: "Sign in with GitHub and try again.",
    });
    expect(called).toBe(false);
  });

  test("signed in: the handler gets the user; headers are added", async () => {
    await signedIn();
    const response = await call({}, async ({ user, session, body }) =>
      Response.json({
        login: user.login,
        uid: session.uid,
        body: body ?? null,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      login: "Octo-Test",
      uid: "4242",
      body: null,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("ratelimit-policy")).toBe('"api";q=120;w=60');
    expect(response.headers.get("ratelimit")).toMatch(/^"api";r=119;t=\d+$/);
  });

  test("headers a handler sets itself are kept, except the cache policy", async () => {
    await signedIn();
    const response = await call(
      {},
      async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Cache-Control": "public, max-age=600",
            Location: "/x",
            RateLimit: '"custom";r=1;t=1',
          },
        }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("location")).toBe("/x");
    expect(response.headers.get("ratelimit")).toBe('"custom";r=1;t=1');
    expect(response.headers.get("ratelimit-policy")).toBe('"api";q=120;w=60');
    // A handler cannot opt a per-user response into a shared cache.
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  test("a problem built inside the handler leaves as private, no-store too", async () => {
    await signedIn();
    const { notFound } = await import("../http/problem");
    const inside = notFound("You have no saved banner with this id.");
    // On its own a problem only says "no-store".
    expect(inside.headers.get("cache-control")).toBe("no-store");
    const response = await call({}, async () => inside);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  test("writes need a same-origin request; reads do not", async () => {
    await signedIn();
    const matrix: [string, Record<string, string>, number][] = [
      ["same-origin", SAME_ORIGIN, 200],
      ["cross-site", { "sec-fetch-site": "cross-site" }, 403],
      ["same-site", { "sec-fetch-site": "same-site" }, 403],
      [
        "foreign Origin",
        { origin: "https://evil.example", host: "localhost" },
        403,
      ],
      [
        "matching Origin",
        { origin: "http://localhost", host: "localhost" },
        200,
      ],
      ["neither header", {}, 403],
    ];
    for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
      for (const [label, headers, status] of matrix) {
        const response = await call({ method, headers });
        expect(`${method} ${label}: ${response.status}`).toBe(
          `${method} ${label}: ${status}`,
        );
      }
    }
    expect((await call({ method: "GET" })).status).toBe(200);
    expect(
      (
        await call({
          method: "GET",
          headers: { "sec-fetch-site": "cross-site" },
        })
      ).status,
    ).toBe(200);
  });

  test("a cross-origin write is refused before the session is even read", async () => {
    await signedIn();
    const before = await store.rateLimit(
      { name: "mutations", limit: 30, windowSeconds: 60 },
      "u:4242",
    );
    const response = await call(
      { method: "POST", headers: { "sec-fetch-site": "cross-site" } },
      undefined,
      { policy: "mutations" },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "cross_origin_request",
      instance: "/api/banners",
    });
    const after = await store.rateLimit(
      { name: "mutations", limit: 30, windowSeconds: 60 },
      "u:4242",
    );
    // Only our own two probes were counted.
    expect(after.remaining).toBe(before.remaining - 1);
  });

  describe("request bodies", () => {
    const schema = z.strictObject({ name: z.string().min(1) });
    const post = (body: string, headers: Record<string, string> = {}) =>
      call(
        {
          method: "POST",
          body,
          headers: {
            ...SAME_ORIGIN,
            "content-type": "application/json",
            ...headers,
          },
        },
        async ({ body: parsed }) => Response.json(parsed, { status: 201 }),
        { policy: "mutations", body: schema },
      );

    test("a valid body reaches the handler parsed", async () => {
      await signedIn();
      const response = await post(JSON.stringify({ name: "x" }));
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ name: "x" });
    });

    test("validation failures list every issue with its path", async () => {
      await signedIn();
      const response = await post(JSON.stringify({ name: "", extra: 1 }));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toMatchObject({ code: "invalid_body", status: 400 });
      expect(
        body.errors.map((error: { path: string }) => error.path).sort(),
      ).toEqual(["", "name"]);
      expect(response.headers.get("ratelimit-policy")).toBe(
        '"mutations";q=30;w=60',
      );
    });

    test("not JSON: 400; wrong media type: 415; too large: 413", async () => {
      await signedIn();
      const notJson = await post("{ nope");
      expect(notJson.status).toBe(400);
      expect((await notJson.json()).code).toBe("bad_request");

      const form = await post("name=x", {
        "content-type": "application/x-www-form-urlencoded",
      });
      expect(form.status).toBe(415);
      expect((await form.json()).code).toBe("unsupported_media_type");

      const huge = await post(JSON.stringify({ name: "x".repeat(20_000) }));
      expect(huge.status).toBe(413);
      expect((await huge.json()).code).toBe("payload_too_large");
    });

    test("the media type itself must be application/json", async () => {
      await signedIn();
      const body = JSON.stringify({ name: "x" });
      for (const type of [
        "application/json",
        "application/json; charset=utf-8",
        "Application/JSON ;charset=UTF-8",
      ]) {
        expect((await post(body, { "content-type": type })).status).toBe(201);
      }
      // What a cross-site form or a no-cors fetch can send without a
      // preflight: a "simple" type with the real one hidden in a parameter.
      for (const type of [
        "text/plain; application/json",
        "text/plain;charset=application/json",
        "multipart/form-data; boundary=application/json",
        "application/jsonp",
        "application/json-seq",
        "",
      ]) {
        const response = await post(body, { "content-type": type });
        expect(`${type}: ${response.status}`).toBe(`${type}: 415`);
      }
    });

    test("the size limit counts bytes, not characters", async () => {
      await signedIn();
      // 9,000 two-byte characters: 9,011 UTF-16 units, 18,011 bytes.
      const response = await post(JSON.stringify({ name: "é".repeat(9000) }));
      expect(response.status).toBe(413);
      // The largest body that still fits is read and validated as usual.
      const fits = JSON.stringify({ name: "x".repeat(16 * 1024 - 11) });
      expect(new TextEncoder().encode(fits).byteLength).toBe(16 * 1024);
      expect((await post(fits)).status).toBe(201);
      expect((await post(`${fits} `)).status).toBe(413);
    });

    test("a body without Content-Length is abandoned at the limit, not buffered", async () => {
      await signedIn();
      let pulled = 0;
      const chunk = new TextEncoder().encode("x".repeat(4096));
      // Endless: reading it to the end would never finish.
      const endless = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled++;
          controller.enqueue(chunk);
        },
      });
      const response = await withUser(
        new Request("http://localhost/api/banners", {
          method: "POST",
          body: endless,
          headers: { ...SAME_ORIGIN, "content-type": "application/json" },
          duplex: "half",
        } as RequestInit),
        { policy: "mutations", body: schema },
        async () => new Response(null, { status: 201 }),
      );
      expect(response.status).toBe(413);
      expect((await response.json()).code).toBe("payload_too_large");
      // Five chunks cross the limit; a little read-ahead is the stream's own.
      expect(pulled).toBeLessThan(12);
    });

    test("a declared Content-Length over the limit is refused unread", async () => {
      await signedIn();
      const response = await post(JSON.stringify({ name: "x" }), {
        "content-length": String(16 * 1024 + 1),
      });
      expect(response.status).toBe(413);
    });

    test("a byte-order mark in front of the JSON is tolerated", async () => {
      await signedIn();
      const response = await post(`﻿${JSON.stringify({ name: "x" })}`);
      expect(response.status).toBe(201);
    });
  });

  test("over the limit: 429 problem with Retry-After, handler not called", async () => {
    await signedIn();
    let calls = 0;
    const hit = () =>
      call(
        { method: "POST", headers: SAME_ORIGIN },
        async () => {
          calls++;
          return new Response(null, { status: 204 });
        },
        { policy: "mutations" },
      );
    for (let i = 0; i < 30; i++) expect((await hit()).status).toBe(204);
    const blocked = await hit();
    expect(blocked.status).toBe(429);
    expect(calls).toBe(30);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThanOrEqual(
      1,
    );
    expect(blocked.headers.get("ratelimit")).toMatch(/^"mutations";r=0;t=\d+$/);
    expect(blocked.headers.get("cache-control")).toBe("private, no-store");
    expect(await blocked.json()).toMatchObject({
      code: "rate_limited",
      "violated-policies": ["mutations"],
    });
    // Reads have their own budget.
    expect((await call({})).status).toBe(200);
  });

  test("a database outage is a 503 problem, other errors are not swallowed", async () => {
    await signedIn();
    const outage = await call({}, async () => {
      throw new StoreUnavailableError(new Error("ECONNRESET"));
    });
    expect(outage.status).toBe(503);
    expect(outage.headers.get("retry-after")).toBe("5");
    expect(await outage.json()).toMatchObject({ code: "unavailable" });

    await expect(
      call({}, async () => {
        throw new TypeError("a bug");
      }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});

test("loginChanged tells the user to sign in again", async () => {
  const response = loginChanged();
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    code: "login_changed",
    resolution: "Sign in with GitHub again and retry.",
  });
});
