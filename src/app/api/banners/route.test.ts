/**
 * The saved-banner API (`/api/banners` and `/api/banners/{id}`), driven
 * directly with a fake cookie jar. The point of this file is authorization:
 * who may read and change which banner, and what each plan may do.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  expectMethodGuards,
  installFakeCookies,
  randomSecret,
  setEnv,
} from "../../../../tests/e2e/auth/helpers";

// Must be in place before the handlers are evaluated.
const cookies = installFakeCookies();

const { completeSignIn } = await import("@/lib/auth/session");
const { getBanner, getDefaultBanner, setDefaultBanner } = await import(
  "@/lib/db/banners"
);
const { setStore } = await import("@/lib/store");
const { MemoryStore } = await import("@/lib/store/memory");
const collection = await import("./route");
const item = await import("./[id]/route");

const PROBLEM = "application/problem+json";
const SAME_ORIGIN = { "sec-fetch-site": "same-origin" };
const alice = { id: 4242, login: "Alice", name: null, avatarUrl: "" };
const bob = { id: 5151, login: "Bob", name: null, avatarUrl: "" };
const banner = { name: "Mine", target: { kind: "owner", login: "torvalds" } };
/** A banner of Bob's own profile, the only kind that can be his default. */
const bobsProfile = { name: "Me", target: { kind: "owner", login: "bob" } };

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
    // Bob is Pro, Alice is on the free plan.
    PRO_LOGINS: "bob",
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
async function signIn(profile: typeof alice): Promise<string> {
  cookies.request();
  await completeSignIn(profile);
  return cookies.nextCookieHeader();
}

interface Call {
  /** `Cookie` header of the caller; empty for an anonymous request. */
  as: string;
  method?: string;
  id?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

function call({ as, method = "GET", id, body, headers }: Call) {
  cookies.request(as);
  const request = new Request(
    `http://localhost:3000/api/banners${id === undefined ? "" : `/${id}`}`,
    {
      method,
      headers: {
        ...(method === "GET" ? {} : SAME_ORIGIN),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  if (id === undefined) {
    if (method === "GET") return collection.GET(request);
    if (method === "POST") return collection.POST(request);
    throw new Error(`no ${method} handler on the collection`);
  }
  const context = { params: Promise.resolve({ id }) };
  if (method === "GET") return item.GET(request, context);
  if (method === "PATCH") return item.PATCH(request, context);
  if (method === "DELETE") return item.DELETE(request, context);
  throw new Error(`no ${method} handler on an item`);
}

async function create(as: string, body: unknown = banner): Promise<string> {
  const response = await call({ as, method: "POST", body });
  expect(response.status).toBe(201);
  return (await response.json()).banner.id;
}

async function listIds(as: string): Promise<string[]> {
  const response = await call({ as });
  expect(response.status).toBe(200);
  const { banners } = await response.json();
  return banners.map((entry: { id: string }) => entry.id);
}

test("methods a route does not have are 405 problems that name the real ones", async () => {
  await expectMethodGuards(collection, "/api/banners", ["GET", "POST"]);
  await expectMethodGuards(item, "/api/banners/b00000000000", [
    "GET",
    "PATCH",
    "DELETE",
  ]);
});

describe("authentication", () => {
  test("every operation needs a session: 401 problem, nothing touched", async () => {
    const id = await create(await signIn(alice));
    const attempts: Call[] = [
      { as: "" },
      { as: "", method: "POST", body: banner },
      { as: "", id },
      { as: "", id, method: "PATCH", body: { name: "Hacked" } },
      { as: "", id, method: "DELETE" },
      { as: "gb_session=not-a-jwt", id, method: "DELETE" },
    ];
    for (const attempt of attempts) {
      const response = await call(attempt);
      expect(response.status).toBe(401);
      expect(response.headers.get("content-type")).toBe(PROBLEM);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect((await response.json()).code).toBe("unauthorized");
    }
    expect((await getBanner(id))?.name).toBe("Mine");
  });

  test("writes need a same-origin request", async () => {
    const as = await signIn(alice);
    const id = await create(as);
    const crossSite = { "sec-fetch-site": "cross-site" };
    const attempts: Call[] = [
      { as, method: "POST", body: banner, headers: crossSite },
      { as, id, method: "PATCH", body: { name: "x" }, headers: crossSite },
      { as, id, method: "DELETE", headers: crossSite },
    ];
    for (const attempt of attempts) {
      const response = await call(attempt);
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("cross_origin_request");
    }
    expect(await listIds(as)).toEqual([id]);
    expect((await getBanner(id))?.name).toBe("Mine");
  });
});

describe("a banner belongs to the user who saved it", () => {
  test("someone else's banner answers exactly like one that does not exist", async () => {
    const aliceCookie = await signIn(alice);
    const bobCookie = await signIn(bob);
    const id = await create(aliceCookie);
    const before = await getBanner(id);

    const attempts: Omit<Call, "as" | "id">[] = [
      { method: "GET" },
      { method: "PATCH", body: { name: "Hacked" } },
      { method: "PATCH", body: { target: { kind: "owner", login: "bob" } } },
      { method: "PATCH", body: { isDefault: true } },
      { method: "PATCH", body: { isDefault: false } },
      { method: "DELETE" },
    ];
    for (const attempt of attempts) {
      const foreign = await call({ as: bobCookie, id, ...attempt });
      const missing = await call({
        as: bobCookie,
        id: "b00000000000",
        ...attempt,
      });
      expect(foreign.status).toBe(404);
      expect(foreign.headers.get("content-type")).toBe(PROBLEM);
      expect(foreign.headers.get("cache-control")).toBe("private, no-store");
      // Nothing in the answer tells a taken id from a free one.
      expect(await foreign.json()).toEqual(await missing.json());
    }

    // Untouched, still Alice's, and not Bob's default.
    expect(await getBanner(id)).toEqual(before);
    expect(await listIds(aliceCookie)).toEqual([id]);
    expect(await listIds(bobCookie)).toEqual([]);
    expect((await getDefaultBanner("bob"))?.banner).toBeNull();
    expect((await getDefaultBanner("alice"))?.banner).toBeNull();
  });

  test("a list only ever contains the caller's banners", async () => {
    const aliceCookie = await signIn(alice);
    const bobCookie = await signIn(bob);
    const mine = await create(aliceCookie);
    const theirs = await create(bobCookie);
    expect(await listIds(aliceCookie)).toEqual([mine]);
    expect(await listIds(bobCookie)).toEqual([theirs]);
  });

  test("the owner is taken from the session, never from the body", async () => {
    const as = await signIn(alice);
    const response = await call({
      as,
      method: "POST",
      body: { ...banner, userId: "5151" },
    });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_body");
    const patch = await call({
      as,
      id: await create(as),
      method: "PATCH",
      body: { userId: "5151" },
    });
    expect(patch.status).toBe(400);
    const smuggled = await call({
      as,
      method: "POST",
      body: { ...banner, id: "b00000000000", createdAt: "2000-01-01" },
    });
    expect(smuggled.status).toBe(400);
  });

  test("ids that are not banner ids are 404, whatever they contain", async () => {
    const as = await signIn(alice);
    for (const id of ["nope", "user:4242", "../user:4242", "B00000000000"]) {
      for (const method of ["GET", "PATCH", "DELETE"]) {
        const response = await call({
          as,
          id,
          method,
          body: method === "PATCH" ? { name: "x" } : undefined,
        });
        expect(`${method} ${id}: ${response.status}`).toBe(
          `${method} ${id}: 404`,
        );
      }
    }
    // The account record a crafted id pointed at is still there.
    expect(await store.get("user:4242")).not.toBeNull();
  });
});

describe("plan limits are enforced on the server", () => {
  test("the free plan stops at three banners", async () => {
    const as = await signIn(alice);
    for (let i = 0; i < 3; i++) await create(as);
    const response = await call({ as, method: "POST", body: banner });
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toBe(PROBLEM);
    expect(await response.json()).toMatchObject({
      code: "banner_limit_reached",
      limit: 3,
      plan: "free",
    });
    expect((await listIds(as)).length).toBe(3);
  });

  test("a burst of parallel creates cannot overshoot the limit", async () => {
    const as = await signIn(alice);
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        call({ as, method: "POST", body: banner }),
      ),
    );
    const created = responses.filter((response) => response.status === 201);
    expect(created.length).toBeLessThanOrEqual(3);
    expect(
      responses.every((response) => [201, 403].includes(response.status)),
    ).toBe(true);
    expect((await listIds(as)).length).toBe(created.length);
  });

  test("Pro may keep more than three", async () => {
    const as = await signIn(bob);
    for (let i = 0; i < 5; i++) await create(as);
    expect((await listIds(as)).length).toBe(5);
  });

  test("only Pro may choose the banner served at the profile URL", async () => {
    const as = await signIn(alice);
    const refused = await call({
      as,
      method: "POST",
      body: { ...banner, isDefault: true },
    });
    expect(refused.status).toBe(403);
    expect((await refused.json()).code).toBe("pro_required");
    // Refused before anything was stored.
    expect(await listIds(as)).toEqual([]);

    const id = await create(as);
    const patch = await call({
      as,
      id,
      method: "PATCH",
      body: { isDefault: true },
    });
    expect(patch.status).toBe(403);
    expect(await patch.json()).toMatchObject({ code: "pro_required" });
    expect((await getDefaultBanner("alice"))?.banner).toBeNull();
  });

  test("Pro: set, move and clear the default", async () => {
    const as = await signIn(bob);
    const first = await create(as, { ...bobsProfile, isDefault: true });
    expect((await getDefaultBanner("BOB"))?.banner?.id).toBe(first);

    const second = await create(as, bobsProfile);
    const moved = await call({
      as,
      id: second,
      method: "PATCH",
      body: { isDefault: true },
    });
    expect((await moved.json()).banner.isDefault).toBe(true);
    expect((await getDefaultBanner("bob"))?.banner?.id).toBe(second);

    // Saying "not the default" about a banner that is not changes nothing.
    await call({
      as,
      id: first,
      method: "PATCH",
      body: { isDefault: false },
    });
    expect((await getDefaultBanner("bob"))?.banner?.id).toBe(second);

    const deleted = await call({ as, id: second, method: "DELETE" });
    expect(deleted.status).toBe(204);
    expect((await getDefaultBanner("bob"))?.banner).toBeNull();
  });

  test("someone who lost Pro can still take their default down", async () => {
    const as = await signIn(bob);
    const id = await create(as, { ...bobsProfile, isDefault: true });
    // Off the allowlist; the cached decision is made to look stale.
    setEnv({ PRO_LOGINS: undefined });
    await store.set("pro:5151", { pro: true, at: 0, source: "allowlist" });

    const again = await call({
      as,
      id,
      method: "PATCH",
      body: { isDefault: true },
    });
    expect(again.status).toBe(403);
    const cleared = await call({
      as,
      id,
      method: "PATCH",
      body: { isDefault: false },
    });
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).banner.isDefault).toBe(false);
    expect((await getDefaultBanner("bob"))?.banner).toBeNull();
  });
});

describe("the profile default shows the user's own profile", () => {
  test("a default of another target is refused, and the real one stays", async () => {
    const as = await signIn(bob);
    const mine = await create(as, { ...bobsProfile, isDefault: true });
    for (const target of [
      { kind: "owner", login: "torvalds" },
      { kind: "repo", owner: "bob", name: "dotfiles" },
    ]) {
      const refused = await call({
        as,
        method: "POST",
        body: { name: "Other", target, isDefault: true },
      });
      expect(refused.status).toBe(422);
      expect(refused.headers.get("content-type")).toBe(PROBLEM);
      expect(await refused.json()).toMatchObject({
        code: "default_not_own_profile",
      });
    }
    // Refused before anything was stored.
    expect(await listIds(as)).toEqual([mine]);
    expect((await getDefaultBanner("bob"))?.banner?.id).toBe(mine);
  });

  test("the login is compared without case", async () => {
    const as = await signIn(bob);
    const id = await create(as, {
      name: "Me",
      target: { kind: "owner", login: "BOB" },
      isDefault: true,
    });
    expect((await getDefaultBanner("bob"))?.banner?.id).toBe(id);
  });

  test("a banner of someone else cannot be made the default", async () => {
    const as = await signIn(bob);
    const mine = await create(as, { ...bobsProfile, isDefault: true });
    const other = await create(as);
    const patch = await call({
      as,
      id: other,
      method: "PATCH",
      body: { isDefault: true },
    });
    expect(patch.status).toBe(422);
    expect((await patch.json()).code).toBe("default_not_own_profile");
    expect((await getDefaultBanner("bob"))?.banner?.id).toBe(mine);
  });

  test("the default cannot be moved to another target", async () => {
    const as = await signIn(bob);
    const id = await create(as, { ...bobsProfile, isDefault: true });
    const moved = await call({
      as,
      id,
      method: "PATCH",
      body: { target: { kind: "repo", owner: "vercel", name: "next.js" } },
    });
    expect(moved.status).toBe(422);
    expect((await moved.json()).code).toBe("default_not_own_profile");
    // Nothing changed: not the target, not the pointer.
    expect((await getBanner(id))?.target).toEqual({
      kind: "owner",
      login: "bob",
    });
    expect((await getDefaultBanner("bob"))?.banner?.id).toBe(id);

    // Saying it is no longer the default makes the same change valid.
    const both = await call({
      as,
      id,
      method: "PATCH",
      body: {
        target: { kind: "repo", owner: "vercel", name: "next.js" },
        isDefault: false,
      },
    });
    expect(both.status).toBe(200);
    expect((await both.json()).banner).toMatchObject({
      isDefault: false,
      target: { kind: "repo", owner: "vercel", name: "next.js" },
    });
    expect((await getDefaultBanner("bob"))?.banner).toBeNull();
  });

  test("a default of another target stored earlier can still be cleared", async () => {
    const as = await signIn(bob);
    const id = await create(as);
    // As the API allowed before it checked the target.
    await setDefaultBanner({ id: "5151", login: "bob" }, id);
    const renamed = await call({
      as,
      id,
      method: "PATCH",
      body: { name: "Renamed" },
    });
    expect(renamed.status).toBe(200);
    const again = await call({
      as,
      id,
      method: "PATCH",
      body: { isDefault: true },
    });
    expect(again.status).toBe(422);
    const cleared = await call({
      as,
      id,
      method: "PATCH",
      body: { isDefault: false },
    });
    expect(cleared.status).toBe(200);
    expect((await getDefaultBanner("bob"))?.banner).toBeNull();
  });
});

describe("input validation", () => {
  test("bodies are validated field by field", async () => {
    const as = await signIn(alice);
    const id = await create(as);
    const bad: unknown[] = [
      {},
      { name: "", target: banner.target },
      { name: "x".repeat(61), target: banner.target },
      { name: "ok", target: { kind: "owner", login: "not a login" } },
      { name: "ok", target: { kind: "repo", owner: "a", name: ".." } },
      { name: "ok", target: { kind: "team", login: "a" } },
      { ...banner, preset: "Has Spaces" },
      { ...banner, query: "a b" },
      { ...banner, query: "x".repeat(2001) },
      { ...banner, isDefault: "yes" },
      [],
      "a string",
      null,
    ];
    for (const body of bad) {
      const response = await call({ as, method: "POST", body });
      expect(response.status).toBe(400);
      expect(response.headers.get("content-type")).toBe(PROBLEM);
    }
    for (const body of [{}, { name: "" }, { isDefault: 1 }, { nope: true }]) {
      const response = await call({ as, id, method: "PATCH", body });
      expect(response.status).toBe(400);
    }
    expect(await listIds(as)).toEqual([id]);
    expect((await getBanner(id))?.name).toBe("Mine");
  });

  test("a valid patch changes only what it names", async () => {
    const as = await signIn(alice);
    const id = await create(as, {
      ...banner,
      preset: "streak",
      query: "theme=dracula",
    });
    const response = await call({
      as,
      id,
      method: "PATCH",
      body: { name: "Renamed" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).banner).toMatchObject({
      id,
      userId: "4242",
      name: "Renamed",
      preset: "streak",
      query: "theme=dracula",
      isDefault: false,
    });
  });
});
