import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Redis } from "@upstash/redis";
import { installRealFetch } from "../../../tests/e2e/auth/helpers";
import {
  startUpstashShim,
  type UpstashShim,
} from "../../../tests/e2e/auth/upstash-shim";
import { MAX_EXPIRING_ENTRIES, MemoryStore } from "./memory";
import { type Store, StoreUnavailableError } from "./types";
import { UpstashStore } from "./upstash";

installRealFetch();

let shim: UpstashShim;
beforeAll(() => {
  shim = startUpstashShim();
});
afterAll(() => shim.stop());

const shimRedis = () =>
  new Redis({ url: shim.url, token: shim.token, retry: false });

const stores: [string, () => Store][] = [
  ["memory", () => new MemoryStore()],
  ["upstash (REST shim)", () => new UpstashStore(shimRedis(), "t:")],
];

for (const [name, make] of stores) {
  describe(`Store contract: ${name}`, () => {
    let store: Store;
    beforeEach(async () => {
      await shim.flush();
      store = make();
    });

    test("documents round-trip as JSON; a missing key is null", async () => {
      expect(await store.get("user:1")).toBeNull();
      const doc = { id: "1", login: "007", n: 5, nested: { ok: true } };
      await store.set("user:1", doc);
      expect(await store.get("user:1")).toEqual(doc);
      // Values that look numeric keep their type inside a document.
      expect((await store.get("user:1")) as typeof doc).toMatchObject({
        id: "1",
        login: "007",
      });
    });

    test("stored documents are copies, not references", async () => {
      const doc = { tags: ["a"] };
      await store.set("k", doc);
      doc.tags.push("b");
      const read = (await store.get("k")) as typeof doc;
      expect(read.tags).toEqual(["a"]);
      read.tags.push("c");
      expect(((await store.get("k")) as typeof doc).tags).toEqual(["a"]);
    });

    test("mget keeps the order of the keys and answers null for gaps", async () => {
      await store.set("a", { v: 1 });
      await store.set("c", { v: 3 });
      expect(await store.mget(["c", "b", "a"])).toEqual([
        { v: 3 },
        null,
        { v: 1 },
      ]);
      expect(await store.mget([])).toEqual([]);
    });

    test("del removes documents and sorted sets; an empty list is fine", async () => {
      await store.set("a", { v: 1 });
      await store.set("b", { v: 2 });
      await store.atomic([{ op: "zadd", key: "z", score: 1, member: "m" }]);
      await store.del([]);
      await store.del(["a", "z", "never-existed"]);
      expect(await store.mget(["a", "b"])).toEqual([null, { v: 2 }]);
      expect(await store.zcard("z")).toBe(0);
    });

    test("entries with a TTL expire", async () => {
      await store.set("snap:x", { v: 1 }, { ttlSeconds: 1 });
      expect(await store.get("snap:x")).toEqual({ v: 1 });
      await Bun.sleep(1100);
      expect(await store.get("snap:x")).toBeNull();
    });

    test("a TTL is rounded up to whole seconds and lasts at least one", async () => {
      // Redis only knows whole seconds and rejects zero; both implementations
      // must round the same way or a test on one says nothing about the other.
      await store.set("snap:fraction", { v: 1 }, { ttlSeconds: 0.2 });
      await store.atomic([
        { op: "set", key: "snap:zero", value: { v: 2 }, ttlSeconds: 0 },
      ]);
      await Bun.sleep(300);
      expect(await store.mget(["snap:fraction", "snap:zero"])).toEqual([
        { v: 1 },
        { v: 2 },
      ]);
      await Bun.sleep(900);
      expect(await store.mget(["snap:fraction", "snap:zero"])).toEqual([
        null,
        null,
      ]);
    });

    test("writing a key again replaces its lifetime", async () => {
      await store.set("k", { v: 1 }, { ttlSeconds: 1 });
      // Without a TTL the entry becomes permanent, as SET does in Redis.
      await store.set("k", { v: 2 });
      await Bun.sleep(1100);
      expect(await store.get("k")).toEqual({ v: 2 });
    });

    test("sorted sets: order by score, reverse, re-score, remove", async () => {
      expect(await store.zrange("z")).toEqual([]);
      expect(await store.zcard("z")).toBe(0);
      await store.atomic([
        { op: "zadd", key: "z", score: 10, member: "b1" },
        { op: "zadd", key: "z", score: 30, member: "b2" },
        { op: "zadd", key: "z", score: 20, member: "b3" },
      ]);
      expect(await store.zrange("z")).toEqual(["b1", "b3", "b2"]);
      expect(await store.zrange("z", { reverse: true })).toEqual([
        "b2",
        "b3",
        "b1",
      ]);
      expect(await store.zcard("z")).toBe(3);
      // Adding an existing member moves it instead of duplicating it.
      await store.atomic([{ op: "zadd", key: "z", score: 40, member: "b1" }]);
      expect(await store.zrange("z", { reverse: true })).toEqual([
        "b1",
        "b2",
        "b3",
      ]);
      await store.atomic([
        { op: "zrem", key: "z", member: "b2" },
        { op: "zrem", key: "z", member: "not-there" },
      ]);
      expect(await store.zrange("z")).toEqual(["b3", "b1"]);
      expect(await store.zcard("z")).toBe(2);
    });

    test("sorted-set members come back as strings, ties in member order", async () => {
      await store.atomic([
        { op: "zadd", key: "z", score: 1, member: "b" },
        { op: "zadd", key: "z", score: 1, member: "123" },
        { op: "zadd", key: "z", score: 1, member: "a" },
      ]);
      const members = await store.zrange("z");
      expect(members).toEqual(["123", "a", "b"]);
      expect(members.every((member) => typeof member === "string")).toBe(true);
    });

    test("atomic applies every write, in order", async () => {
      await store.set("old", { v: 0 });
      await store.atomic([
        { op: "set", key: "doc", value: { v: 1 } },
        { op: "set", key: "doc", value: { v: 2 } },
        { op: "zadd", key: "z", score: 1, member: "m" },
        { op: "del", key: "old" },
      ]);
      expect(await store.mget(["doc", "old"])).toEqual([{ v: 2 }, null]);
      expect(await store.zrange("z")).toEqual(["m"]);
      await store.atomic([]);
    });

    test("a batch with a value JSON cannot represent applies nothing", async () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      await expect(
        store.atomic([
          { op: "set", key: "fine", value: { v: 1 } },
          { op: "zadd", key: "z", score: 1, member: "m" },
          { op: "set", key: "broken", value: cyclic },
        ]),
      ).rejects.toThrow();
      expect(await store.get("fine")).toBeNull();
      expect(await store.zcard("z")).toBe(0);
    });

    test("sliding-window rate limit", async () => {
      // An hour-long window keeps the test away from window boundaries.
      const rule = { name: "api", limit: 3, windowSeconds: 3600 };
      const first = await store.rateLimit(rule, "ip:1.2.3.4");
      expect(first).toMatchObject({ success: true, limit: 3, remaining: 2 });
      expect(first.reset).toBeGreaterThan(Date.now());
      expect(first.reset - Date.now()).toBeLessThanOrEqual(3_600_000);
      expect((await store.rateLimit(rule, "ip:1.2.3.4")).remaining).toBe(1);
      expect((await store.rateLimit(rule, "ip:1.2.3.4")).remaining).toBe(0);
      expect(await store.rateLimit(rule, "ip:1.2.3.4")).toMatchObject({
        success: false,
        limit: 3,
        remaining: 0,
      });
      // Identifiers and policies are independent of each other.
      expect((await store.rateLimit(rule, "ip:5.6.7.8")).success).toBe(true);
      expect(
        (await store.rateLimit({ ...rule, name: "auth" }, "ip:1.2.3.4"))
          .success,
      ).toBe(true);
    });
  });
}

describe("UpstashStore", () => {
  test("namespaces isolate environments that share one database", async () => {
    await shim.flush();
    const redis = shimRedis();
    const production = new UpstashStore(redis, "gb:");
    const preview = new UpstashStore(redis, "gb:preview:");
    await production.set("user:1", { id: "1" });
    await production.atomic([
      { op: "zadd", key: "user:1:banners", score: 1, member: "b1" },
    ]);
    expect(await preview.get("user:1")).toBeNull();
    expect(await preview.zcard("user:1:banners")).toBe(0);
    expect((await redis.keys("*")).sort()).toEqual([
      "gb:user:1",
      "gb:user:1:banners",
    ]);
  });

  test("a multi-write batch is one round trip", async () => {
    await shim.flush();
    const store = new UpstashStore(shimRedis(), "t:");
    await store.atomic([
      { op: "set", key: "a", value: { v: 1 } },
      { op: "zadd", key: "z", score: 1, member: "m" },
    ]);
    expect(shim.requests.map((request) => request.path)).toEqual([
      "/multi-exec",
    ]);
  });

  test("an unreachable database raises StoreUnavailableError", async () => {
    const dead = new UpstashStore(
      new Redis({ url: "http://127.0.0.1:9", token: "x", retry: false }),
      "t:",
    );
    await expect(dead.get("user:1")).rejects.toBeInstanceOf(
      StoreUnavailableError,
    );
    await expect(dead.set("user:1", { id: "1" })).rejects.toBeInstanceOf(
      StoreUnavailableError,
    );
    await expect(
      dead.atomic([{ op: "del", key: "user:1" }]),
    ).rejects.toBeInstanceOf(StoreUnavailableError);
  });

  test("the rate limiter fails open when Redis is unreachable or slow", async () => {
    const rule = { name: "api", limit: 5, windowSeconds: 60 };
    const dead = new UpstashStore(
      new Redis({ url: "http://127.0.0.1:9", token: "x", retry: false }),
      "t:",
    );
    expect(await dead.rateLimit(rule, "u:1")).toMatchObject({
      success: true,
      limit: 5,
      remaining: 5,
      degraded: true,
    });

    await shim.flush();
    // Longer than the limiter's one-second timeout.
    shim.delayMs = 1300;
    try {
      const slow = new UpstashStore(shimRedis(), "t:");
      expect(await slow.rateLimit(rule, "u:1")).toMatchObject({
        success: true,
        degraded: true,
      });
    } finally {
      shim.delayMs = 0;
    }
  });
});

describe("MemoryStore cache bound", () => {
  test("entries with a TTL are capped; the oldest written make room", async () => {
    const store = new MemoryStore();
    await store.set("user:1", { id: "1" });
    for (let i = 0; i < MAX_EXPIRING_ENTRIES + 25; i++) {
      await store.set(`snap:${i}`, { i }, { ttlSeconds: 3600 });
    }
    const all = await store.mget(
      Array.from({ length: MAX_EXPIRING_ENTRIES + 25 }, (_, i) => `snap:${i}`),
    );
    expect(all.filter((doc) => doc !== null).length).toBe(MAX_EXPIRING_ENTRIES);
    // The first 25 written are the ones that went.
    expect(all.slice(0, 25).every((doc) => doc === null)).toBe(true);
    expect(all.slice(25).every((doc) => doc !== null)).toBe(true);
    // Documents without a TTL are data, not cache: never evicted.
    expect(await store.get("user:1")).toEqual({ id: "1" });
  });

  test("rewriting an entry makes it the youngest", async () => {
    const store = new MemoryStore();
    await store.set("snap:keep", { v: 1 }, { ttlSeconds: 3600 });
    for (let i = 0; i < MAX_EXPIRING_ENTRIES - 1; i++) {
      await store.set(`snap:${i}`, { i }, { ttlSeconds: 3600 });
    }
    await store.set("snap:keep", { v: 2 }, { ttlSeconds: 3600 });
    await store.set("snap:new", { v: 3 }, { ttlSeconds: 3600 });
    expect(await store.get("snap:keep")).toEqual({ v: 2 });
    expect(await store.get("snap:0")).toBeNull();
  });

  test("an account document that was a cache entry before is not evicted", async () => {
    const store = new MemoryStore();
    await store.set("k", { v: 1 }, { ttlSeconds: 3600 });
    await store.set("k", { v: 2 });
    for (let i = 0; i < MAX_EXPIRING_ENTRIES + 5; i++) {
      await store.set(`snap:${i}`, { i }, { ttlSeconds: 3600 });
    }
    expect(await store.get("k")).toEqual({ v: 2 });
  });
});

describe("MemoryStore file persistence", () => {
  const tempDirs: string[] = [];
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "gb-store-"));
    tempDirs.push(dir);
    return dir;
  };
  afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  const tempFile = () => join(tempDir(), "nested", "store.json");

  test("survives a restart, is owner-only, and skips expiring entries", async () => {
    const file = tempFile();
    const first = new MemoryStore(file);
    await first.set("user:4242", { id: "4242", login: "Octo-Test" });
    await first.set("snap:cache", { value: 1 }, { ttlSeconds: 60 });
    await Promise.all([
      first.atomic([{ op: "zadd", key: "z", score: 2, member: "b2" }]),
      first.atomic([{ op: "zadd", key: "z", score: 1, member: "b1" }]),
    ]);

    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    expect(onDisk.docs).toEqual({
      "user:4242": { id: "4242", login: "Octo-Test" },
    });
    expect(onDisk.zsets).toEqual({ z: { b2: 2, b1: 1 } });
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const second = new MemoryStore(file);
    expect(await second.get("user:4242")).toEqual({
      id: "4242",
      login: "Octo-Test",
    });
    expect(await second.zrange("z")).toEqual(["b1", "b2"]);
    // Caches do not survive a restart.
    expect(await second.get("snap:cache")).toBeNull();
    expect(await first.get("snap:cache")).toEqual({ value: 1 });
  });

  test("refuses a file it did not write instead of overwriting it", async () => {
    const file = join(tempDir(), "other.json");
    writeFileSync(file, JSON.stringify({ name: "not-a-store" }));
    const store = new MemoryStore(file);
    await expect(store.get("a")).rejects.toBeInstanceOf(StoreUnavailableError);
    await expect(store.set("a", { v: 1 })).rejects.toBeInstanceOf(
      StoreUnavailableError,
    );
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      name: "not-a-store",
    });

    writeFileSync(file, "{ not json");
    await expect(new MemoryStore(file).get("a")).rejects.toBeInstanceOf(
      StoreUnavailableError,
    );
  });
});
