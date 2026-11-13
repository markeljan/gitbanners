import { afterEach, describe, expect, test } from "bun:test";
import { setEnv } from "../../../tests/e2e/auth/helpers";
import {
  getStore,
  hasUpstashEnv,
  setStore,
  snapshotStore,
  storeIsDurable,
} from "./index";
import { MemoryStore } from "./memory";
import type { Store } from "./types";

const NO_REDIS = {
  UPSTASH_REDIS_REST_URL: undefined,
  UPSTASH_REDIS_REST_TOKEN: undefined,
  KV_REST_API_URL: undefined,
  KV_REST_API_TOKEN: undefined,
  VERCEL: undefined,
  VERCEL_ENV: undefined,
  GB_STORE_FILE: undefined,
};

let restore = () => {};
afterEach(() => {
  restore();
  setStore(undefined);
});

function env(vars: Record<string, string | undefined>): void {
  restore = setEnv({ ...NO_REDIS, ...vars });
  setStore(undefined);
}

describe("getStore", () => {
  test("needs a URL and a token under either pair of names", () => {
    env({});
    expect(hasUpstashEnv()).toBe(false);
    env({ KV_REST_API_URL: "https://x.upstash.io" });
    expect(hasUpstashEnv()).toBe(false);
    env({ KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "t" });
    expect(hasUpstashEnv()).toBe(true);
    env({
      UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "t",
    });
    expect(hasUpstashEnv()).toBe(true);
  });

  test("picks Upstash when configured, memory otherwise, and is a singleton", () => {
    env({});
    const memory = getStore();
    expect(memory.kind).toBe("memory");
    expect(getStore()).toBe(memory);

    env({ KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "t" });
    expect(getStore().kind).toBe("upstash");
  });

  test("setStore swaps the instance", () => {
    env({});
    const mine = new MemoryStore();
    setStore(mine);
    expect(getStore()).toBe(mine);
  });
});

describe("storeIsDurable", () => {
  test("memory is fine locally", () => {
    env({});
    expect(storeIsDurable()).toBe(true);
  });

  test("memory on Vercel is not: the app boots, accounts stay off", () => {
    env({ VERCEL: "1" });
    expect(getStore().kind).toBe("memory");
    expect(storeIsDurable()).toBe(false);
    env({ VERCEL_ENV: "preview" });
    expect(storeIsDurable()).toBe(false);
  });

  test("Upstash is durable everywhere", () => {
    env({
      VERCEL: "1",
      VERCEL_ENV: "production",
      KV_REST_API_URL: "https://x.upstash.io",
      KV_REST_API_TOKEN: "t",
    });
    expect(storeIsDurable()).toBe(true);
  });
});

describe("snapshotStore", () => {
  test("round-trips a value with its write time under snap:{key}", async () => {
    const store = new MemoryStore();
    const snapshots = snapshotStore(store);
    expect(await snapshots.get("user:torvalds")).toBeNull();

    const before = Date.now();
    await snapshots.set("user:torvalds", { stars: 1, tags: ["a"] }, 60);
    const hit = await snapshots.get("user:torvalds");
    expect(hit?.value).toEqual({ stars: 1, tags: ["a"] });
    expect(hit?.storedAt).toBeGreaterThanOrEqual(before);
    expect(hit?.storedAt).toBeLessThanOrEqual(Date.now());
    expect(await store.get("snap:user:torvalds")).toEqual(hit);
  });

  test("keeps falsy values and uses the process-wide store by default", async () => {
    env({});
    const snapshots = snapshotStore();
    await snapshots.set("zero", 0, 60);
    await snapshots.set("nothing", null, 60);
    expect((await snapshots.get("zero"))?.value).toBe(0);
    expect((await snapshots.get("nothing"))?.value).toBeNull();
    expect(await getStore().get("snap:zero")).not.toBeNull();
  });

  test("entries expire, and a missing lifetime stores nothing", async () => {
    const store = new MemoryStore();
    const snapshots = snapshotStore(store);
    await snapshots.set("short", { v: 1 }, 1);
    await snapshots.set("never", { v: 1 }, 0);
    await snapshots.set("negative", { v: 1 }, -5);
    await snapshots.set("nan", { v: 1 }, Number.NaN);
    await snapshots.set("forever", { v: 1 }, Number.POSITIVE_INFINITY);
    expect(await snapshots.get("short")).not.toBeNull();
    expect(await snapshots.get("never")).toBeNull();
    expect(await snapshots.get("negative")).toBeNull();
    expect(await snapshots.get("nan")).toBeNull();
    expect(await snapshots.get("forever")).toBeNull();
    await Bun.sleep(1100);
    expect(await snapshots.get("short")).toBeNull();
  });

  test("is a cache: a broken store means a miss, never an exception", async () => {
    const broken = new Proxy(new MemoryStore(), {
      get(target, property) {
        if (property === "get" || property === "set") {
          return () => Promise.reject(new Error("redis is down"));
        }
        return Reflect.get(target, property);
      },
    }) as Store;
    const snapshots = snapshotStore(broken);
    expect(await snapshots.get("k")).toBeNull();
    await snapshots.set("k", { v: 1 }, 60);
  });

  test("ignores documents that are not snapshots", async () => {
    const store = new MemoryStore();
    await store.set("snap:odd", { storedAt: "yesterday", value: 1 });
    await store.set("snap:bare", { storedAt: 5 });
    const snapshots = snapshotStore(store);
    expect(await snapshots.get("odd")).toBeNull();
    expect(await snapshots.get("bare")).toBeNull();
  });
});
