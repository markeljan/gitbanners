/**
 * Persistence contract for accounts.
 *
 * One small key-value interface with two implementations: Upstash Redis over
 * REST in production (`upstash.ts`) and an in-process twin for local
 * development and tests (`memory.ts`). Domain logic lives one level up in
 * `src/lib/db` and `src/lib/pro`, written once against this interface.
 *
 * Key schema (every value is a JSON document):
 *
 *   user:{id}            User        id = GitHub numeric id, stable on rename
 *   login:{login_lower}  LoginIndex  login → user id + the default banner id
 *   pro:{id}             ProStatus   last Pro decision, no TTL (stale-if-error)
 *   banner:{bannerId}    SavedBanner
 *   user:{id}:banners    sorted set  member = bannerId, score = updatedAt (ms)
 *   snap:{key}           Snapshot    expiring cache of the GitHub data layer
 *   rl:{policy}:…        owned by the rate limiter
 *
 * The Upstash implementation prefixes every key with a namespace so preview
 * deployments sharing the production database can never touch production data.
 */

/**
 * One write inside an atomic batch (Redis MULTI/EXEC). Kept as data so both
 * implementations apply exactly the same sequence.
 */
export type WriteOp =
  | { op: "set"; key: string; value: object; ttlSeconds?: number }
  | { op: "del"; key: string }
  | { op: "zadd"; key: string; score: number; member: string }
  | { op: "zrem"; key: string; member: string };

/** One rate-limit policy as the store needs it. */
export interface RateLimitRule {
  /** Policy name. Part of the Redis key and of the `RateLimit` headers. */
  name: string;
  /** Requests allowed per window. */
  limit: number;
  windowSeconds: number;
}

/** What a limiter reports for one request. */
export interface RateLimitOutcome {
  success: boolean;
  limit: number;
  remaining: number;
  /** When the current window ends, epoch milliseconds. */
  reset: number;
  /**
   * True when the limiter failed open (Redis slow or unreachable). The
   * counters are then made up and must never reach a response header.
   */
  degraded?: boolean;
}

/**
 * The persistence primitives accounts are built from. Deliberately small:
 * anything Redis can do that is not listed here is not used, which is what
 * keeps the in-memory twin honest.
 */
export interface Store {
  readonly kind: "upstash" | "memory";

  /**
   * The JSON document at `key`, or `null`. Returned as `unknown` on purpose:
   * callers validate what they read instead of trusting a cast.
   */
  get(key: string): Promise<unknown>;
  /** Several documents in one round trip, in the order of `keys`. */
  mget(keys: readonly string[]): Promise<unknown[]>;
  /**
   * Values must be objects: the Upstash client JSON-parses replies, so a bare
   * `"123"` would come back as the number 123.
   *
   * With `ttlSeconds` the entry is a cache entry: it is gone after that time
   * (rounded up to whole seconds) and may be dropped earlier.
   */
  set(
    key: string,
    value: object,
    options?: { ttlSeconds?: number },
  ): Promise<void>;
  del(keys: readonly string[]): Promise<void>;

  /** Members of a sorted set ordered by score, lowest first unless reversed. */
  zrange(key: string, options?: { reverse?: boolean }): Promise<string[]>;
  zcard(key: string): Promise<number>;

  /** All writes or none, in one round trip. */
  atomic(ops: readonly WriteOp[]): Promise<void>;

  /**
   * Sliding-window rate limit. Lives on the store because the backend differs
   * (Lua on Upstash, a Map in memory). Never throws: it fails open instead.
   */
  rateLimit(rule: RateLimitRule, identifier: string): Promise<RateLimitOutcome>;
}

/**
 * Raised when the database cannot be reached or answers nonsense. Routes map
 * it to a 503 instead of a generic 500 so clients know a retry makes sense.
 */
export class StoreUnavailableError extends Error {
  constructor(cause: unknown) {
    super("The account store is unavailable", { cause });
    this.name = "StoreUnavailableError";
  }
}

/**
 * A lifetime as every implementation applies it. Redis takes whole seconds
 * and rejects zero, so a TTL is rounded up and lasts at least one second;
 * the in-memory twin rounds the same way so both expire alike.
 */
export function wholeSeconds(ttlSeconds: number): number {
  return Math.max(1, Math.ceil(ttlSeconds));
}

/** GitHub logins are case-insensitive; index keys use the lower-case form. */
export function loginKey(login: string): string {
  return login.toLowerCase();
}

/** The single place key names are spelled, so the schema above cannot drift. */
export const keys = {
  user: (id: string) => `user:${id}`,
  login: (login: string) => `login:${loginKey(login)}`,
  pro: (id: string) => `pro:${id}`,
  banner: (id: string) => `banner:${id}`,
  userBanners: (userId: string) => `user:${userId}:banners`,
  snapshot: (key: string) => `snap:${key}`,
} as const;
