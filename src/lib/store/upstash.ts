/**
 * Upstash Redis (REST) implementation of `Store`.
 *
 * Client behaviour this file relies on (@upstash/redis 1.41, verified):
 * values are JSON-stringified on write and JSON-parsed on read, commands are
 * plain `fetch` calls with no connection state, and `multi()` is one request.
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import {
  type RateLimitOutcome,
  type RateLimitRule,
  type Store,
  StoreUnavailableError,
  type WriteOp,
  wholeSeconds,
} from "./types";

const COMMAND_TIMEOUT_MS = 2500;
const LIMITER_TIMEOUT_MS = 1000;

/**
 * Prefix for every key. Preview deployments share the production database,
 * so they get their own namespace and can never touch production data.
 */
export function keyNamespace(): string {
  if (process.env.KEY_NAMESPACE) return process.env.KEY_NAMESPACE;
  const env = process.env.VERCEL_ENV;
  return !env || env === "production" ? "gb:" : `gb:${env}:`;
}

/**
 * `Redis.fromEnv()` reads `UPSTASH_REDIS_REST_URL/TOKEN`, falling back to the
 * `KV_REST_API_URL/TOKEN` names the Vercel Marketplace integration injects.
 */
export function createRedis(): Redis {
  return Redis.fromEnv({
    // The defaults (5 retries, about 4 s worst case) are too slow for a
    // request.
    retry: { retries: 2, backoff: (attempt) => 40 * 2 ** attempt },
    // Must be a function: one shared AbortSignal.timeout() would fire once and
    // then abort every later command.
    signal: () => AbortSignal.timeout(COMMAND_TIMEOUT_MS),
    enableTelemetry: false,
  });
}

/**
 * Every command failure surfaces as `StoreUnavailableError`; only the rate
 * limiter swallows failures (it fails open).
 */
export class UpstashStore implements Store {
  readonly kind = "upstash" as const;
  private readonly limiters = new Map<string, Ratelimit>();

  constructor(
    private readonly redis: Redis = createRedis(),
    private readonly namespace: string = keyNamespace(),
  ) {}

  get(key: string): Promise<unknown> {
    return this.run(() => this.redis.get<unknown>(this.k(key)));
  }

  mget(keys: readonly string[]): Promise<unknown[]> {
    // MGET with no keys is a Redis error.
    if (keys.length === 0) return Promise.resolve([]);
    return this.run(() =>
      this.redis.mget<unknown[]>(...keys.map((key) => this.k(key))),
    );
  }

  async set(
    key: string,
    value: object,
    options: { ttlSeconds?: number } = {},
  ): Promise<void> {
    const { ttlSeconds } = options;
    await this.run(() =>
      ttlSeconds === undefined
        ? this.redis.set(this.k(key), value)
        : this.redis.set(this.k(key), value, { ex: wholeSeconds(ttlSeconds) }),
    );
  }

  async del(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.run(() => this.redis.del(...keys.map((key) => this.k(key))));
  }

  async zrange(
    key: string,
    options: { reverse?: boolean } = {},
  ): Promise<string[]> {
    const members = await this.run(() =>
      this.redis.zrange<unknown[]>(
        this.k(key),
        0,
        -1,
        options.reverse ? { rev: true } : undefined,
      ),
    );
    // Replies are JSON-parsed, so an all-digit member arrives as a number.
    return members.map(String);
  }

  zcard(key: string): Promise<number> {
    return this.run(() => this.redis.zcard(this.k(key)));
  }

  async atomic(ops: readonly WriteOp[]): Promise<void> {
    if (ops.length === 0) return;
    const tx = this.redis.multi();
    for (const op of ops) {
      const key = this.k(op.key);
      switch (op.op) {
        case "set":
          if (op.ttlSeconds === undefined) tx.set(key, op.value);
          else tx.set(key, op.value, { ex: wholeSeconds(op.ttlSeconds) });
          break;
        case "del":
          tx.del(key);
          break;
        case "zadd":
          tx.zadd(key, { score: op.score, member: op.member });
          break;
        case "zrem":
          tx.zrem(key, op.member);
          break;
      }
    }
    await this.run(() => tx.exec());
  }

  async rateLimit(
    rule: RateLimitRule,
    identifier: string,
  ): Promise<RateLimitOutcome> {
    const open: RateLimitOutcome = {
      success: true,
      limit: rule.limit,
      remaining: rule.limit,
      reset: Date.now() + rule.windowSeconds * 1000,
      degraded: true,
    };
    try {
      const result = await this.limiter(rule).limit(identifier);
      // Slow Redis: the SDK itself answers
      // { success: true, limit: 0, remaining: 0, reset: 0, reason: "timeout" }.
      if (result.reason === "timeout") return open;
      return {
        success: result.success,
        limit: result.limit,
        remaining: Math.max(0, result.remaining),
        reset: result.reset,
      };
    } catch {
      // Redis unreachable: a broken limiter must not take the API down.
      return open;
    }
  }

  private k(key: string): string {
    return `${this.namespace}${key}`;
  }

  private limiter(rule: RateLimitRule): Ratelimit {
    const id = `${rule.name}:${rule.limit}:${rule.windowSeconds}`;
    let limiter = this.limiters.get(id);
    if (!limiter) {
      limiter = new Ratelimit({
        redis: this.redis,
        limiter: Ratelimit.slidingWindow(rule.limit, `${rule.windowSeconds} s`),
        prefix: `${this.namespace}rl:${rule.name}`,
        // Analytics would add a command per call and a promise to keep alive.
        analytics: false,
        // Fail open after one second instead of the default five.
        timeout: LIMITER_TIMEOUT_MS,
      });
      this.limiters.set(id, limiter);
    }
    return limiter;
  }

  private async run<T>(command: () => Promise<T>): Promise<T> {
    try {
      return await command();
    } catch (error) {
      throw new StoreUnavailableError(error);
    }
  }
}
