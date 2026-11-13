import { describe, expect, test } from "bun:test";
import { Redis } from "@upstash/redis";
import { installRealFetch } from "../../tests/e2e/auth/helpers";
import { startUpstashShim } from "../../tests/e2e/auth/upstash-shim";
import { clientIp, type LimitResult, limit, POLICIES } from "./ratelimit";
import { MemoryStore } from "./store/memory";
import type { RateLimitOutcome, RateLimitRule, Store } from "./store/types";
import { UpstashStore } from "./store/upstash";

installRealFetch();

/**
 * A store whose limiter gives a scripted answer and records what it was asked.
 */
function scripted(answer: (now: number) => RateLimitOutcome | Error) {
  const calls: [RateLimitRule, string][] = [];
  const store = new Proxy(new MemoryStore(), {
    get(target, property) {
      if (property !== "rateLimit") return Reflect.get(target, property);
      return async (rule: RateLimitRule, identifier: string) => {
        calls.push([rule, identifier]);
        const outcome = answer(Date.now());
        if (outcome instanceof Error) throw outcome;
        return outcome;
      };
    },
  }) as Store;
  return { store, calls };
}

describe("policies", () => {
  test("the four named policies", () => {
    expect(POLICIES).toEqual({
      api: { name: "api", limit: 120, windowSeconds: 60 },
      search: { name: "search", limit: 60, windowSeconds: 60 },
      mutations: { name: "mutations", limit: 30, windowSeconds: 60 },
      auth: { name: "auth", limit: 20, windowSeconds: 600 },
    });
  });

  test("limit() hands the policy and the identifier to the store", async () => {
    const { store, calls } = scripted((now) => ({
      success: true,
      limit: 20,
      remaining: 19,
      reset: now + 1000,
    }));
    await limit("auth", "ip:203.0.113.7", store);
    expect(calls).toEqual([[POLICIES.auth, "ip:203.0.113.7"]]);
  });
});

describe("RateLimit headers (IETF structured fields)", () => {
  test("allowed: policy and remaining quota, no Retry-After", async () => {
    const { store } = scripted((now) => ({
      success: true,
      limit: 120,
      remaining: 119,
      reset: now + 17_200,
    }));
    expect(await limit("api", "u:1", store)).toEqual({
      ok: true,
      policy: "api",
      limit: 120,
      remaining: 119,
      resetSeconds: 18,
      headers: {
        "RateLimit-Policy": '"api";q=120;w=60',
        RateLimit: '"api";r=119;t=18',
      },
    });
  });

  test("blocked: adds Retry-After", async () => {
    const { store } = scripted((now) => ({
      success: false,
      limit: 30,
      remaining: 0,
      reset: now + 41_500,
    }));
    expect(await limit("mutations", "u:1", store)).toEqual({
      ok: false,
      policy: "mutations",
      limit: 30,
      remaining: 0,
      resetSeconds: 42,
      headers: {
        "RateLimit-Policy": '"mutations";q=30;w=60',
        RateLimit: '"mutations";r=0;t=42',
        "Retry-After": "42",
      },
    });
  });

  test("the auth policy advertises its ten-minute window", async () => {
    const { store } = scripted((now) => ({
      success: true,
      limit: 20,
      remaining: 3,
      reset: now + 599_500,
    }));
    expect((await limit("auth", "ip:1", store)).headers).toEqual({
      "RateLimit-Policy": '"auth";q=20;w=600',
      RateLimit: '"auth";r=3;t=600',
    });
  });

  test("odd numbers are clamped: no negative quota, Retry-After at least 1", async () => {
    const { store } = scripted((now) => ({
      success: false,
      limit: 60,
      remaining: -4,
      reset: now - 2000,
    }));
    const result = await limit("search", "ip:1", store);
    expect(result.remaining).toBe(0);
    expect(result.resetSeconds).toBe(0);
    expect(result.headers).toEqual({
      "RateLimit-Policy": '"search";q=60;w=60',
      RateLimit: '"search";r=0;t=0',
      "Retry-After": "1",
    });
  });
});

describe("failing open", () => {
  const OPEN: LimitResult = {
    ok: true,
    policy: "api",
    limit: 120,
    remaining: 120,
    resetSeconds: 60,
    // The static policy only: no counters were measured.
    headers: { "RateLimit-Policy": '"api";q=120;w=60' },
  };

  test("a degraded outcome never becomes counters", async () => {
    // What the Upstash SDK reports on a timeout, passed through unfiltered.
    const { store } = scripted(() => ({
      success: true,
      limit: 0,
      remaining: 0,
      reset: 0,
      degraded: true,
    }));
    expect(await limit("api", "u:1", store)).toEqual(OPEN);
  });

  test("a limiter that throws lets the request through", async () => {
    const { store } = scripted(() => new Error("redis is down"));
    expect(await limit("api", "u:1", store)).toEqual(OPEN);
  });

  test("end to end: a Redis slower than the limiter's timeout", async () => {
    const shim = startUpstashShim();
    shim.delayMs = 1300;
    try {
      const store = new UpstashStore(
        new Redis({ url: shim.url, token: shim.token, retry: false }),
        "t:",
      );
      const result = await limit("api", "u:1", store);
      expect(result).toEqual(OPEN);
      expect(result.headers.RateLimit).toBeUndefined();
      expect(result.headers["Retry-After"]).toBeUndefined();
    } finally {
      shim.stop();
    }
  });
});

describe("with a real limiter", () => {
  test("in memory: the mutations policy blocks the 31st request", async () => {
    const store = new MemoryStore();
    const results = [];
    for (let i = 0; i < 31; i++) {
      results.push(await limit("mutations", "u:1", store));
    }
    expect(results.slice(0, 30).every((result) => result.ok)).toBe(true);
    expect(results[0].remaining).toBeLessThanOrEqual(29);
    const blocked = results[30];
    expect(blocked.ok).toBe(false);
    expect(blocked.headers.RateLimit).toMatch(/^"mutations";r=0;t=\d+$/);
    expect(Number(blocked.headers["Retry-After"])).toBeGreaterThanOrEqual(1);
    expect(Number(blocked.headers["Retry-After"])).toBeLessThanOrEqual(60);
    // Another user is unaffected.
    expect((await limit("mutations", "u:2", store)).ok).toBe(true);
  });

  test("on Upstash (REST shim): same headers from the real SDK", async () => {
    const shim = startUpstashShim();
    try {
      const store = new UpstashStore(
        new Redis({ url: shim.url, token: shim.token, retry: false }),
        "t:",
      );
      const first = await limit("auth", "ip:203.0.113.7", store);
      expect(first.ok).toBe(true);
      expect(first.headers["RateLimit-Policy"]).toBe('"auth";q=20;w=600');
      expect(first.headers.RateLimit).toMatch(/^"auth";r=\d+;t=\d+$/);
      expect(first.resetSeconds).toBeGreaterThan(0);
      expect(first.resetSeconds).toBeLessThanOrEqual(600);
      const second = await limit("auth", "ip:203.0.113.7", store);
      expect(second.remaining).toBe(first.remaining - 1);
    } finally {
      shim.stop();
    }
  });
});

describe("clientIp", () => {
  const request = (headers: Record<string, string>) =>
    new Request("http://localhost/", { headers });

  const from = (address: string) =>
    clientIp(request({ "x-forwarded-for": address }));

  test("the first address of X-Forwarded-For", () => {
    expect(from("203.0.113.7, 10.0.0.1")).toBe("203.0.113.7");
    expect(from(" 198.51.100.20 ")).toBe("198.51.100.20");
  });

  test("loopback when the header is missing or empty", () => {
    expect(clientIp(request({}))).toBe("127.0.0.1");
    expect(from("")).toBe("127.0.0.1");
    expect(from(" , 203.0.113.7")).toBe("127.0.0.1");
  });

  test("an IPv6 client is counted by its /64 network", () => {
    // One subscriber owns the whole /64: every spelling and every interface
    // id of it must land in the same bucket.
    const sameNetwork = [
      "2001:db8:abcd:12::1",
      "2001:db8:abcd:12:ffff:ffff:ffff:ffff",
      "2001:0DB8:ABCD:0012:0000:0000:0000:0001",
      "2001:db8:abcd:12:1:2:3:4",
      "[2001:db8:abcd:12::1]:443",
      "2001:db8:abcd:12::1%eth0",
    ];
    for (const address of sameNetwork) {
      expect(from(address)).toBe("2001:db8:abcd:12::/64");
    }
    // The neighbouring networks are somebody else.
    expect(from("2001:db8:abcd:13::1")).toBe("2001:db8:abcd:13::/64");
    expect(from("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(from("::1")).toBe("0:0:0:0::/64");
  });

  test("an IPv4 client behind a dual-stack socket stays an IPv4 client", () => {
    expect(from("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(from("::FFFF:203.0.113.7")).toBe("203.0.113.7");
    expect(from("::ffff:cb00:7107")).toBe("203.0.113.7");
    expect(from("203.0.113.7:51234")).toBe("203.0.113.7");
  });

  test("what is not an address shares one bucket instead of naming its own", () => {
    for (const junk of [
      "unknown",
      "localhost",
      "999.1.1.1",
      "1.2.3",
      "1.2.3.4.5",
      "2001:db8:::1",
      "2001:db8::1::2",
      "1:2:3:4:5:6:7:8:9",
      "1:2:3:4:5:6:7",
      "1:2:3:4:5:6:7::8",
      "g::1",
      "12345::1",
      "[2001:db8::1",
      `evil-key-${"x".repeat(500)}`,
      "ip:203.0.113.7:0",
    ]) {
      expect(`${junk} -> ${from(junk)}`).toBe(`${junk} -> unknown`);
    }
  });

  test("rotating through a /64 does not escape a per-address limit", async () => {
    const store = new MemoryStore();
    const outcomes = [];
    for (let i = 0; i < 22; i++) {
      const ip = from(`2001:db8:abcd:12::${i.toString(16)}`);
      outcomes.push((await limit("auth", `ip:${ip}`, store)).ok);
    }
    expect(outcomes.slice(0, 20).every(Boolean)).toBe(true);
    expect(outcomes.slice(20)).toEqual([false, false]);
  });
});
