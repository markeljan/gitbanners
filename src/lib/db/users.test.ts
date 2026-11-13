import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { Redis } from "@upstash/redis";
import { installRealFetch } from "../../../tests/e2e/auth/helpers";
import {
  startUpstashShim,
  type UpstashShim,
} from "../../../tests/e2e/auth/upstash-shim";
import { MemoryStore } from "../store/memory";
import type { Store } from "../store/types";
import { UpstashStore } from "../store/upstash";
import {
  bumpSessionVersion,
  deleteUser,
  getLoginIndex,
  getUser,
  upsertUser,
} from "./users";

installRealFetch();

let shim: UpstashShim;
beforeAll(() => {
  shim = startUpstashShim();
});
afterAll(() => shim.stop());

const stores: [string, () => Store][] = [
  ["memory", () => new MemoryStore()],
  [
    "upstash (REST shim)",
    () =>
      new UpstashStore(
        new Redis({ url: shim.url, token: shim.token, retry: false }),
        "t:",
      ),
  ],
];

const profile = (over: Partial<Parameters<typeof upsertUser>[0]> = {}) => ({
  id: "4242",
  login: "Octo-Test",
  name: null,
  avatarUrl: "https://avatars.githubusercontent.com/u/4242?v=4",
  ...over,
});

for (const [name, make] of stores) {
  describe(`users: ${name}`, () => {
    let store: Store;
    beforeEach(async () => {
      await shim.flush();
      store = make();
    });

    test("upsert creates the record and a case-insensitive login index", async () => {
      const user = await upsertUser(profile(), store);
      expect(user).toMatchObject({
        id: "4242",
        login: "Octo-Test",
        name: null,
      });
      expect(Number.isNaN(Date.parse(user.createdAt))).toBe(false);
      expect(user.updatedAt).toBe(user.createdAt);
      expect(await getUser("4242", store)).toEqual(user);
      expect(await getUser("nope", store)).toBeNull();
      expect(await getLoginIndex("octo-test", store)).toEqual({ id: "4242" });
      expect(await getLoginIndex("OCTO-TEST", store)).toEqual({ id: "4242" });
      expect(await getLoginIndex("someone-else", store)).toBeNull();
    });

    test("a later sign-in refreshes the profile but keeps createdAt and sv", async () => {
      const first = await upsertUser(profile(), store);
      await Bun.sleep(5);
      const second = await upsertUser(
        profile({ name: "Octo", avatarUrl: "https://avatars.example/2" }),
        store,
      );
      expect(second.createdAt).toBe(first.createdAt);
      expect(second.sv).toBe(first.sv);
      expect(second.updatedAt > first.updatedAt).toBe(true);
      expect((await getUser("4242", store))?.name).toBe("Octo");
    });

    test("numeric-looking logins, names and ids stay strings", async () => {
      await upsertUser(
        profile({ id: "123456", login: "007", name: "42" }),
        store,
      );
      const index = await getLoginIndex("007", store);
      expect(index).toEqual({ id: "123456" });
      expect(typeof index?.id).toBe("string");
      const user = await getUser("123456", store);
      expect(user?.login).toBe("007");
      expect(user?.name).toBe("42");
    });

    test("a rename moves the login index and carries the default banner pointer", async () => {
      await upsertUser(profile({ login: "old-name" }), store);
      await store.set("login:old-name", { id: "4242", def: "b00000000001" });
      await upsertUser(profile({ login: "new-name" }), store);
      expect(await getLoginIndex("old-name", store)).toBeNull();
      expect(await getLoginIndex("new-name", store)).toEqual({
        id: "4242",
        def: "b00000000001",
      });
      // Signing in again without renaming keeps the pointer.
      await upsertUser(profile({ login: "new-name" }), store);
      expect((await getLoginIndex("new-name", store))?.def).toBe(
        "b00000000001",
      );
    });

    test("a recycled login is never read from or deleted", async () => {
      await upsertUser(profile({ login: "old-name" }), store);
      await store.set("login:old-name", { id: "4242", def: "b00000000001" });
      // Somebody else registers the old login before the first user returns.
      await upsertUser(profile({ id: "777", login: "old-name" }), store);
      expect(await getLoginIndex("old-name", store)).toEqual({ id: "777" });
      // The first user comes back under a new name: the index of the old one
      // now belongs to 777 and must survive, pointer not inherited.
      await upsertUser(profile({ login: "new-name" }), store);
      expect(await getLoginIndex("old-name", store)).toEqual({ id: "777" });
      expect(await getLoginIndex("new-name", store)).toEqual({ id: "4242" });
    });

    test("bumpSessionVersion changes the version, and a later sign-in keeps it", async () => {
      const user = await upsertUser(profile(), store);
      const bumped = await bumpSessionVersion("4242", store);
      expect(bumped).not.toBe(user.sv);
      expect(bumped).toBeGreaterThan(0);
      expect((await getUser("4242", store))?.sv).toBe(bumped);
      expect((await upsertUser(profile(), store)).sv).toBe(bumped);
      expect(await bumpSessionVersion("4242", store)).not.toBe(bumped);
      expect(await bumpSessionVersion("nope", store)).toBe(0);
    });

    test("session versions are positive safe integers", async () => {
      for (let i = 0; i < 20; i++) {
        const user = await upsertUser(profile({ id: String(i + 1) }), store);
        expect(Number.isSafeInteger(user.sv)).toBe(true);
        expect(user.sv).toBeGreaterThan(0);
      }
    });

    test("deleteUser removes the record, index, Pro cache and banners", async () => {
      await upsertUser(profile(), store);
      await store.set("pro:4242", { pro: true, at: 1, source: "stargazers" });
      await store.atomic([
        {
          op: "set",
          key: "banner:b00000000001",
          value: { id: "b00000000001" },
        },
        {
          op: "set",
          key: "banner:b00000000002",
          value: { id: "b00000000002" },
        },
        {
          op: "zadd",
          key: "user:4242:banners",
          score: 1,
          member: "b00000000001",
        },
        {
          op: "zadd",
          key: "user:4242:banners",
          score: 2,
          member: "b00000000002",
        },
      ]);
      // An unrelated account must be untouched.
      await upsertUser(profile({ id: "777", login: "bystander" }), store);

      const removed = await deleteUser("4242", store);
      expect(removed.sort()).toEqual(["b00000000001", "b00000000002"]);
      expect(await getUser("4242", store)).toBeNull();
      expect(await getLoginIndex("octo-test", store)).toBeNull();
      expect(
        await store.mget([
          "pro:4242",
          "banner:b00000000001",
          "banner:b00000000002",
        ]),
      ).toEqual([null, null, null]);
      expect(await store.zcard("user:4242:banners")).toBe(0);
      expect(await getUser("777", store)).not.toBeNull();
      expect(await getLoginIndex("bystander", store)).toEqual({ id: "777" });
      // Deleting twice, or deleting nobody, is harmless.
      expect(await deleteUser("4242", store)).toEqual([]);
    });

    test("deleteUser leaves a login index that was recycled", async () => {
      await upsertUser(profile({ login: "shared" }), store);
      await store.set("login:shared", { id: "777" });
      await deleteUser("4242", store);
      expect(await getLoginIndex("shared", store)).toEqual({ id: "777" });
    });

    test("a re-created account never gets a session version it had before", async () => {
      // Immediately, within the same millisecond, and after bumps: neither the
      // clock nor a counter may bring an old value back.
      const seen = new Set<number>();
      for (let round = 0; round < 25; round++) {
        const user = await upsertUser(profile(), store);
        expect(seen.has(user.sv)).toBe(false);
        seen.add(user.sv);
        const bumped = await bumpSessionVersion("4242", store);
        expect(seen.has(bumped)).toBe(false);
        seen.add(bumped);
        await deleteUser("4242", store);
      }
    });

    test("damaged records read as missing", async () => {
      await store.set("user:1", { id: "1", login: "broken" });
      await store.set("login:broken", { def: "b1" });
      expect(await getUser("1", store)).toBeNull();
      expect(await getLoginIndex("broken", store)).toBeNull();
    });
  });
}
