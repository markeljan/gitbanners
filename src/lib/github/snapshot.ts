/**
 * Durable stale-if-error cache seam in front of the fetchers.
 *
 * The framework cache (`cached.ts`) forgets everything on each deployment
 * and cannot serve an old value when a refresh fails. This layer can: it
 * keeps the last good result for days in a store that outlives deployments
 * (injected with {@link setSnapshotStore}; an in-memory map until then) and
 * hands it out when GitHub throttles us or is down. A banner embedded in a
 * thousand READMEs keeps rendering through a GitHub incident.
 */
import { isTransient } from "./errors";

/** A value as kept by a {@link SnapshotStore}. */
export interface Snapshot {
  value: unknown;
  /** Epoch milliseconds at which the value was stored. */
  storedAt: number;
}

/**
 * Key-value store for snapshots. Values are plain JSON (an envelope around
 * the caller's value, opaque to the store). The store may drop entries at any
 * time; `ttlSeconds` is only the latest moment to do so.
 */
export interface SnapshotStore {
  get(key: string): Promise<Snapshot | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

/** Options of {@link withSnapshot}. */
export interface SnapshotOptions<T> {
  /** Seconds a stored value is returned without calling `load`. */
  freshFor: number;
  /** Seconds a stored value may be returned when `load` fails transiently. */
  staleFor: number;
  /**
   * Marks values that are expected to improve within moments (GitHub was
   * still computing part of them). They count as fresh for at most
   * {@link PROVISIONAL_FRESH_SECONDS}, so the better value is picked up soon.
   *
   * That quick re-check happens once: a value that comes back provisional
   * from it is fresh for the whole `freshFor`, like any other. Otherwise a
   * repository GitHub never finishes computing, or an outage of its
   * statistics service, would have every affected entity re-fetched every
   * minute, fifteen times the normal load, exactly while GitHub struggles.
   */
  provisional?: (value: T) => boolean;
  /**
   * Checks a stored value before it is used. Snapshots outlive deployments,
   * so an older build may have stored a different shape; a rejected value is
   * treated as absent.
   */
  accept?: (value: unknown) => value is T;
  /** Clock in epoch milliseconds, for tests. */
  now?: () => number;
}

/** Longest negative caching: an unknown login may be registered any minute. */
export const NEGATIVE_FRESH_SECONDS = 300;
/** Freshness of provisional values, see {@link SnapshotOptions.provisional}. */
export const PROVISIONAL_FRESH_SECONDS = 60;

const DEFAULT_MAX_ENTRIES = 500;

/** What is stored under a key: the caller's value and how to treat it. */
interface Kept {
  value: unknown;
  /**
   * True for a provisional value whose quick re-check has already happened,
   * see {@link SnapshotOptions.provisional}.
   */
  rechecked: boolean;
}

/** False for anything an older build stored before values had an envelope. */
function isKept(candidate: unknown): candidate is Kept {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "value" in candidate &&
    "rechecked" in candidate &&
    typeof candidate.rechecked === "boolean"
  );
}

/**
 * A bounded in-memory {@link SnapshotStore}: per-process, least recently
 * used entries are evicted first. The default until a shared store is
 * injected, and the store used in tests.
 *
 * Values are kept by reference, so treat what you get back as immutable.
 */
export function createMemorySnapshotStore(
  options: { maxEntries?: number; now?: () => number } = {},
): SnapshotStore {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Snapshot & { expiresAt: number }>();
  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      entries.delete(key);
      if (entry.expiresAt <= now()) return null;
      // Re-inserting moves the key to the young end of the map.
      entries.set(key, entry);
      return { value: entry.value, storedAt: entry.storedAt };
    },
    async set(key, value, ttlSeconds) {
      const storedAt = now();
      entries.delete(key);
      entries.set(key, {
        value,
        storedAt,
        expiresAt: storedAt + ttlSeconds * 1000,
      });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
  };
}

interface SharedState {
  store: SnapshotStore;
  /** Loads in flight, so concurrent callers of one key share one fetch. */
  inFlight: Map<string, Promise<unknown>>;
}

const SHARED_KEY = Symbol.for("gitbanners.github.snapshot");

/**
 * The store and the in-flight loads live on `globalThis`, not in module
 * scope. Next.js can load this module once per server bundle (pages, route
 * handlers, instrumentation); a module-level variable would let a store that
 * was injected in one of them go unnoticed by the others, which would then
 * quietly keep using their own in-memory default.
 */
function shared(): SharedState {
  const holder = globalThis as { [SHARED_KEY]?: SharedState };
  holder[SHARED_KEY] ??= {
    store: createMemorySnapshotStore(),
    inFlight: new Map(),
  };
  return holder[SHARED_KEY];
}

/**
 * Replaces the snapshot store for the whole process, e.g. with one backed by
 * Redis. Call it once at startup, before the first request.
 */
export function setSnapshotStore(next: SnapshotStore): void {
  shared().store = next;
}

/** Name and message only: a store client's error object can embed its URL. */
function describe(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

async function readSnapshot(key: string): Promise<Snapshot | null> {
  try {
    return await shared().store.get(key);
  } catch (error) {
    // A broken store must never take the data path down with it.
    console.warn(
      `[github] snapshot store read failed for ${key}: ${describe(error)}`,
    );
    return null;
  }
}

async function writeSnapshot(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  try {
    await shared().store.set(key, value, ttlSeconds);
  } catch (error) {
    console.warn(
      `[github] snapshot store write failed for ${key}: ${describe(error)}`,
    );
  }
}

async function resolve<T>(
  key: string,
  load: () => Promise<T>,
  opts: SnapshotOptions<T>,
): Promise<T> {
  const now = opts.now ?? Date.now;
  const negativeFor = Math.min(opts.freshFor, NEGATIVE_FRESH_SECONDS);

  const snapshot = await readSnapshot(key);
  let stored: { value: T; ageSeconds: number; rechecked: boolean } | null =
    null;
  if (snapshot && isKept(snapshot.value)) {
    const kept = snapshot.value;
    if (!opts.accept || opts.accept(kept.value)) {
      stored = {
        // Without `accept` the store is trusted to return what was put in.
        value: kept.value as T,
        ageSeconds: (now() - snapshot.storedAt) / 1000,
        rechecked: kept.rechecked,
      };
    }
  }

  if (stored) {
    const { value } = stored;
    let freshFor = opts.freshFor;
    if (value === null) freshFor = negativeFor;
    else if (!stored.rechecked && opts.provisional?.(value)) {
      freshFor = Math.min(freshFor, PROVISIONAL_FRESH_SECONDS);
    }
    if (stored.ageSeconds < freshFor) return value;
  }

  let loaded: T;
  try {
    loaded = await load();
  } catch (error) {
    // Only a real value is worth serving stale; an old "not found" is not.
    if (
      isTransient(error) &&
      stored &&
      stored.value !== null &&
      stored.ageSeconds < opts.staleFor
    ) {
      return stored.value;
    }
    throw error;
  }
  // A provisional value reloaded before `freshFor` was up: this load was its
  // quick re-check. Still provisional means waiting did not help.
  const rechecked =
    opts.provisional !== undefined &&
    loaded !== null &&
    stored !== null &&
    stored.value !== null &&
    stored.ageSeconds < opts.freshFor &&
    opts.provisional(stored.value) &&
    opts.provisional(loaded);
  const kept: Kept = { value: loaded, rechecked };
  await writeSnapshot(key, kept, loaded === null ? negativeFor : opts.staleFor);
  return loaded;
}

/**
 * Returns the value for `key`, from the snapshot store when possible.
 *
 * - A fresh snapshot (younger than `freshFor`) is returned without loading.
 * - Otherwise `load` runs; its result is stored and returned.
 * - If `load` throws a `GitHubError` with code `rate_limited` or
 *   `unavailable` and a snapshot younger than `staleFor` exists, that stale
 *   snapshot is returned instead. Every other error propagates.
 * - `null` results are stored too (negative caching), but only for
 *   `min(freshFor, 300)` seconds, and are never served stale.
 * - Concurrent calls for the same key in one process share one load.
 *
 * `T` must be JSON-serializable. Never use it for results fetched with a
 * visitor's own token: the store is shared between all visitors.
 */
export function withSnapshot<T>(
  key: string,
  load: () => Promise<T>,
  opts: SnapshotOptions<T>,
): Promise<T> {
  const { inFlight } = shared();
  const pending = inFlight.get(key);
  // Callers of one key agree on its type, so the shared promise is a T.
  if (pending) return pending as Promise<T>;
  const started = resolve(key, load, opts).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, started);
  return started;
}
