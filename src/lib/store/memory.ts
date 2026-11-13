/**
 * In-process `Store` with optional JSON-file persistence.
 *
 * For local development and tests only: one process, no locking. Values go
 * through `JSON.stringify` exactly like they would on the way to Redis, so a
 * test that passes here cannot depend on object identity or on values JSON
 * cannot represent.
 *
 * It is also what a deployment without Redis runs on, so nothing in it may
 * grow with traffic: entries with a TTL (caches) are capped at
 * `MAX_EXPIRING_ENTRIES`, the oldest written making room for new ones.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type RateLimitOutcome,
  type RateLimitRule,
  type Store,
  StoreUnavailableError,
  type WriteOp,
  wholeSeconds,
} from "./types";

interface Entry {
  json: string;
  /** Epoch milliseconds, or `null` for entries that never expire. */
  expiresAt: number | null;
}

/** On-disk shape. Expiring entries are caches and are deliberately left out. */
interface Snapshot {
  version: 1;
  docs: Record<string, unknown>;
  zsets: Record<string, Record<string, number>>;
}

const SWEEP_INTERVAL_MS = 60_000;
const MAX_RATE_LIMIT_BUCKETS = 10_000;
/**
 * How many entries with a TTL are kept. The same bound as the data layer's
 * own in-memory snapshot cache, which this store replaces when it is plugged
 * in as the snapshot store.
 */
export const MAX_EXPIRING_ENTRIES = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * See the file comment. Construct directly in tests; the app uses `getStore()`.
 */
export class MemoryStore implements Store {
  readonly kind = "memory" as const;

  private readonly docs = new Map<string, Entry>();
  /** Keys of `docs` that have a TTL, oldest write first. */
  private readonly expiring = new Set<string>();
  private readonly zsets = new Map<string, Map<string, number>>();
  /** Rate-limit buckets. Never persisted. */
  private readonly windows = new Map<
    string,
    { count: number; expiresAt: number }
  >();
  private loaded: Promise<void> | undefined;
  private writing: Promise<void> = Promise.resolve();
  private lastSweep = 0;

  /** @param file JSON file to persist to. Omit for a pure in-memory store. */
  constructor(private readonly file?: string) {}

  async get(key: string): Promise<unknown> {
    await this.ready();
    return this.read(key);
  }

  async mget(keys: readonly string[]): Promise<unknown[]> {
    await this.ready();
    return keys.map((key) => this.read(key));
  }

  set(
    key: string,
    value: object,
    options: { ttlSeconds?: number } = {},
  ): Promise<void> {
    return this.atomic([
      { op: "set", key, value, ttlSeconds: options.ttlSeconds },
    ]);
  }

  del(keys: readonly string[]): Promise<void> {
    return this.atomic(keys.map((key) => ({ op: "del", key })));
  }

  async zrange(
    key: string,
    options: { reverse?: boolean } = {},
  ): Promise<string[]> {
    await this.ready();
    // Redis order: by score, ties broken by member; `REV` reverses both.
    const members = [...(this.zsets.get(key) ?? [])]
      .sort(([a, x], [b, y]) => x - y || (a < b ? -1 : a > b ? 1 : 0))
      .map(([member]) => member);
    return options.reverse ? members.reverse() : members;
  }

  async zcard(key: string): Promise<number> {
    await this.ready();
    return this.zsets.get(key)?.size ?? 0;
  }

  async atomic(ops: readonly WriteOp[]): Promise<void> {
    await this.ready();
    // Serialised before anything is applied: a value JSON cannot represent
    // has to fail the whole batch, not leave half of it behind.
    const json = ops.map((op) =>
      op.op === "set" ? JSON.stringify(op.value) : "",
    );
    // Synchronous from here to the end of the loop: nothing can interleave.
    let durable = false;
    ops.forEach((op, i) => {
      durable = this.apply(op, json[i]) || durable;
    });
    if (durable) await this.persist();
  }

  /**
   * Sliding-window counter with the same maths as `@upstash/ratelimit`'s
   * `slidingWindow` (the previous bucket counts in proportion to how much of
   * it still overlaps the window), so limits behave the same in development.
   */
  async rateLimit(
    rule: RateLimitRule,
    identifier: string,
  ): Promise<RateLimitOutcome> {
    const windowMs = rule.windowSeconds * 1000;
    const now = Date.now();
    const bucket = Math.floor(now / windowMs);
    const current = `${rule.name}:${identifier}:${bucket}`;
    const previous = `${rule.name}:${identifier}:${bucket - 1}`;
    const carried = Math.floor(
      (1 - (now % windowMs) / windowMs) *
        (this.windows.get(previous)?.count ?? 0),
    );
    const used = this.windows.get(current)?.count ?? 0;
    const reset = (bucket + 1) * windowMs;
    if (carried + used >= rule.limit) {
      return { success: false, limit: rule.limit, remaining: 0, reset };
    }
    this.windows.set(current, { count: used + 1, expiresAt: reset + windowMs });
    if (this.windows.size > MAX_RATE_LIMIT_BUCKETS) {
      for (const [key, value] of this.windows) {
        if (value.expiresAt < now) this.windows.delete(key);
      }
    }
    return {
      success: true,
      limit: rule.limit,
      remaining: rule.limit - (used + 1 + carried),
      reset,
    };
  }

  private read(key: string): unknown {
    const entry = this.docs.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.forget(key);
      return null;
    }
    return JSON.parse(entry.json);
  }

  private forget(key: string): boolean {
    this.expiring.delete(key);
    return this.docs.delete(key);
  }

  /**
   * Applies one write; `json` is the serialised value of a "set". Returns true
   * when something worth persisting changed.
   */
  private apply(op: WriteOp, json: string): boolean {
    switch (op.op) {
      case "set": {
        const wasDurable = this.docs.get(op.key)?.expiresAt === null;
        const expiresAt =
          op.ttlSeconds === undefined
            ? null
            : Date.now() + wholeSeconds(op.ttlSeconds) * 1000;
        this.docs.set(op.key, { json, expiresAt });
        // Re-added so a rewritten entry counts as the youngest.
        this.expiring.delete(op.key);
        if (expiresAt !== null) {
          this.expiring.add(op.key);
          this.trim();
        }
        return expiresAt === null || wasDurable;
      }
      case "del": {
        const hadDoc = this.forget(op.key);
        const hadSet = this.zsets.delete(op.key);
        return hadDoc || hadSet;
      }
      case "zadd": {
        const set = this.zsets.get(op.key) ?? new Map<string, number>();
        set.set(op.member, op.score);
        this.zsets.set(op.key, set);
        return true;
      }
      case "zrem": {
        const set = this.zsets.get(op.key);
        if (!set?.delete(op.member)) return false;
        if (set.size === 0) this.zsets.delete(op.key);
        return true;
      }
    }
  }

  /**
   * Keeps the cache part bounded: expired entries are dropped now and then,
   * and beyond `MAX_EXPIRING_ENTRIES` the oldest written go. Without this a
   * server would keep every snapshot it ever stored until its TTL, days away.
   */
  private trim(): void {
    const now = Date.now();
    if (now - this.lastSweep >= SWEEP_INTERVAL_MS) {
      this.lastSweep = now;
      for (const key of this.expiring) {
        const expiresAt = this.docs.get(key)?.expiresAt;
        if (typeof expiresAt === "number" && expiresAt <= now) this.forget(key);
      }
    }
    for (const key of this.expiring) {
      if (this.expiring.size <= MAX_EXPIRING_ENTRIES) break;
      this.forget(key);
    }
  }

  private ready(): Promise<void> {
    this.loaded ??= this.load();
    return this.loaded;
  }

  private async load(): Promise<void> {
    if (!this.file) return;
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new StoreUnavailableError(error);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new StoreUnavailableError(
        new Error(
          `${this.file} is not valid JSON. Delete it to start with an empty store.`,
          { cause: error },
        ),
      );
    }
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      !isRecord(parsed.docs) ||
      !isRecord(parsed.zsets)
    ) {
      // Never overwrite a file this store did not write (a mistyped path).
      throw new StoreUnavailableError(
        new Error(`${this.file} is not a store file written by this app.`),
      );
    }
    for (const [key, value] of Object.entries(parsed.docs)) {
      this.docs.set(key, { json: JSON.stringify(value), expiresAt: null });
    }
    for (const [key, members] of Object.entries(parsed.zsets)) {
      if (!isRecord(members)) continue;
      const set = new Map<string, number>();
      for (const [member, score] of Object.entries(members)) {
        if (typeof score === "number") set.set(member, score);
      }
      if (set.size > 0) this.zsets.set(key, set);
    }
  }

  /**
   * Write-through, one write at a time so concurrent calls cannot interleave.
   */
  private persist(): Promise<void> {
    const file = this.file;
    if (!file) return Promise.resolve();
    this.writing = this.writing
      .catch(() => {})
      .then(() => this.writeSnapshot(file));
    return this.writing;
  }

  /** Atomic (temp file + rename) and readable by the owner only. */
  private async writeSnapshot(file: string): Promise<void> {
    const snapshot: Snapshot = { version: 1, docs: {}, zsets: {} };
    for (const [key, entry] of this.docs) {
      if (entry.expiresAt === null) snapshot.docs[key] = JSON.parse(entry.json);
    }
    for (const [key, set] of this.zsets) {
      snapshot.zsets[key] = Object.fromEntries(set);
    }
    try {
      await mkdir(dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
      await rename(temp, file);
    } catch (error) {
      throw new StoreUnavailableError(error);
    }
  }
}
