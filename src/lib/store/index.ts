import "server-only";
import { MemoryStore } from "./memory";
import { keys, type Store } from "./types";
import { UpstashStore } from "./upstash";

// On globalThis so the instance (and the data of the in-memory store) survives
// module reloads under `next dev`.
const holder = globalThis as typeof globalThis & { __gbStore?: Store };

/**
 * `Redis.fromEnv()` only warns when its variables are missing and then fails
 * on the first command, so the choice of store is made here instead.
 */
export function hasUpstashEnv(): boolean {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
      (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN),
  );
}

/** `VERCEL` only exists while system environment variables are exposed. */
function onVercel(): boolean {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
}

function memoryStoreFile(): string | undefined {
  // Functions on Vercel have a read-only file system.
  if (onVercel()) return undefined;
  if (process.env.GB_STORE_FILE) return process.env.GB_STORE_FILE;
  // Test runs must not leave state behind for the next run.
  return process.env.NODE_ENV === "test" ? undefined : ".data/store.json";
}

/**
 * The process-wide store: Upstash when its REST credentials are configured,
 * the in-memory twin otherwise.
 *
 * It never throws for a missing database. A deployment without Redis (first
 * deploy, forks) must still boot and serve public banners; whether accounts
 * may be offered is a separate question answered by `storeIsDurable()`.
 */
export function getStore(): Store {
  holder.__gbStore ??= hasUpstashEnv()
    ? new UpstashStore()
    : new MemoryStore(memoryStoreFile());
  return holder.__gbStore;
}

/**
 * Replaces the process-wide store. For tests; `undefined` re-reads the
 * environment.
 */
export function setStore(store: Store | undefined): void {
  holder.__gbStore = store;
}

/**
 * False when writes would be lost: the in-memory store on Vercel lives in a
 * single short-lived function instance. Account features refuse to work in
 * that case instead of pretending to.
 */
export function storeIsDurable(): boolean {
  return getStore().kind === "upstash" || !onVercel();
}

/** A cached value together with the time it was written. */
export interface StoredSnapshot {
  value: unknown;
  /** When the value was written, epoch milliseconds. */
  storedAt: number;
}

/**
 * Structurally the store interface the GitHub data layer accepts, so the
 * result of `snapshotStore()` can be handed to it as is.
 */
export interface SnapshotStore {
  get(key: string): Promise<StoredSnapshot | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

/**
 * Small JSON cache for the GitHub data layer (keys `snap:{key}`), so the last
 * good upstream answer can outlive a deployment.
 *
 * It is a cache, so it never throws: a failed read is a miss and a failed
 * write is dropped. `value` must be JSON-serialisable.
 */
export function snapshotStore(store: Store = getStore()): SnapshotStore {
  return {
    async get(key) {
      try {
        const doc = await store.get(keys.snapshot(key));
        if (typeof doc !== "object" || doc === null) return null;
        const { value, storedAt } = doc as Partial<StoredSnapshot>;
        if (typeof storedAt !== "number" || value === undefined) return null;
        return { value, storedAt };
      } catch {
        return null;
      }
    },
    async set(key, value, ttlSeconds) {
      // A cache entry without a (finite) lifetime would never go away.
      if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return;
      try {
        await store.set(
          keys.snapshot(key),
          { value: value ?? null, storedAt: Date.now() },
          { ttlSeconds },
        );
      } catch {
        // Losing a cache write is harmless; failing the request is not.
      }
    },
  };
}

export type {
  RateLimitOutcome,
  RateLimitRule,
  Store,
  WriteOp,
} from "./types";
export { keys, loginKey, StoreUnavailableError } from "./types";
