import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  mock,
  spyOn,
  test,
} from "bun:test";
import { GitHubError } from "./errors";
import {
  createMemorySnapshotStore,
  NEGATIVE_FRESH_SECONDS,
  PROVISIONAL_FRESH_SECONDS,
  type SnapshotOptions,
  type SnapshotStore,
  setSnapshotStore,
  withSnapshot,
} from "./snapshot";

/** A clock the tests move by hand, in seconds. */
let seconds = 0;
const now = () => seconds * 1000;
const advance = (by: number) => {
  seconds += by;
};

/** freshFor 900 s, staleFor one week: the values `cached.ts` uses. */
function options<T>(
  extra: Partial<SnapshotOptions<T>> = {},
): SnapshotOptions<T> {
  return { freshFor: 900, staleFor: 604_800, now, ...extra };
}

let keys = 0;
const freshKey = () => `test:${++keys}`;
let warn: Mock<typeof console.warn>;

beforeEach(() => {
  seconds = 1_000_000;
  setSnapshotStore(createMemorySnapshotStore({ now }));
  warn = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  setSnapshotStore(createMemorySnapshotStore());
});

describe("withSnapshot", () => {
  test("loads once, then serves the fresh snapshot without loading", async () => {
    const key = freshKey();
    const load = mock(async () => ({ login: "torvalds" }));

    expect(await withSnapshot(key, load, options())).toEqual({
      login: "torvalds",
    });
    advance(899);
    expect(await withSnapshot(key, load, options())).toEqual({
      login: "torvalds",
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("reloads once the snapshot is older than freshFor", async () => {
    const key = freshKey();
    let version = 0;
    const load = mock(async () => ({ version: ++version }));

    expect(await withSnapshot(key, load, options())).toEqual({ version: 1 });
    advance(900);
    expect(await withSnapshot(key, load, options())).toEqual({ version: 2 });
    // The reload refreshed the snapshot.
    advance(899);
    expect(await withSnapshot(key, load, options())).toEqual({ version: 2 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  test.each([
    "rate_limited",
    "unavailable",
  ] as const)("serves the stale snapshot when the reload fails with %s", async (code) => {
    const key = freshKey();
    const failing = mock(async (): Promise<{ v: number }> => {
      throw new GitHubError(code, "GitHub is having a moment");
    });
    await withSnapshot(key, async () => ({ v: 1 }), options());

    advance(86_400 * 6);
    expect(await withSnapshot(key, failing, options())).toEqual({ v: 1 });
    expect(failing).toHaveBeenCalledTimes(1);
    // Still stale: the next call tries GitHub again.
    expect(await withSnapshot(key, failing, options())).toEqual({ v: 1 });
    expect(failing).toHaveBeenCalledTimes(2);
  });

  test("a snapshot older than staleFor is not served: the error surfaces", async () => {
    const key = freshKey();
    const error = new GitHubError("unavailable", "down");
    await withSnapshot(
      key,
      async () => ({ v: 1 }),
      options({ staleFor: 3600 }),
    );

    advance(3599);
    expect(
      await withSnapshot<{ v: number }>(
        key,
        async () => Promise.reject(error),
        options({ staleFor: 3600 }),
      ),
    ).toEqual({ v: 1 });
    advance(1);
    await expect(
      withSnapshot(
        key,
        async () => Promise.reject(error),
        options({ staleFor: 3600 }),
      ),
    ).rejects.toBe(error);
  });

  test.each([
    "forbidden",
    "invalid",
  ] as const)("%s is never papered over with a stale snapshot", async (code) => {
    const key = freshKey();
    const error = new GitHubError(code, "not transient");
    await withSnapshot(key, async () => ({ v: 1 }), options());
    advance(1000);
    await expect(
      withSnapshot(key, async () => Promise.reject(error), options()),
    ).rejects.toBe(error);
  });

  test("errors that are not GitHub's propagate untouched", async () => {
    const key = freshKey();
    const bug = new TypeError("cannot read properties of undefined");
    await withSnapshot(key, async () => ({ v: 1 }), options());
    advance(1000);
    await expect(
      withSnapshot(key, async () => Promise.reject(bug), options()),
    ).rejects.toBe(bug);
  });

  test("without any snapshot a failing load throws and stores nothing", async () => {
    const key = freshKey();
    const error = new GitHubError("rate_limited", "slow down", {
      retryAfter: 30,
    });
    await expect(
      withSnapshot(key, async () => Promise.reject(error), options()),
    ).rejects.toBe(error);
    const load = mock(async () => "value");
    expect(await withSnapshot(key, load, options())).toBe("value");
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("null is cached, but only for min(freshFor, 300) seconds", async () => {
    const key = freshKey();
    const load = mock(async (): Promise<string | null> => null);

    expect(await withSnapshot(key, load, options())).toBeNull();
    advance(NEGATIVE_FRESH_SECONDS - 1);
    expect(await withSnapshot(key, load, options())).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    advance(1);
    expect(await withSnapshot(key, load, options())).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);

    const short = freshKey();
    await withSnapshot(short, load, options({ freshFor: 60 }));
    advance(60);
    await withSnapshot(short, load, options({ freshFor: 60 }));
    expect(load).toHaveBeenCalledTimes(4);
    expect(NEGATIVE_FRESH_SECONDS).toBe(300);
  });

  test("a cached null is never served stale", async () => {
    const key = freshKey();
    const error = new GitHubError("unavailable", "down");
    await withSnapshot(
      key,
      async (): Promise<string | null> => null,
      options(),
    );
    advance(NEGATIVE_FRESH_SECONDS);
    await expect(
      withSnapshot(
        key,
        async (): Promise<string | null> => Promise.reject(error),
        options(),
      ),
    ).rejects.toBe(error);
  });

  test("a login that appears replaces its cached null", async () => {
    const key = freshKey();
    await withSnapshot(
      key,
      async (): Promise<string | null> => null,
      options(),
    );
    advance(NEGATIVE_FRESH_SECONDS);
    expect(
      await withSnapshot(
        key,
        async (): Promise<string | null> => "now exists",
        options(),
      ),
    ).toBe("now exists");
    advance(899);
    expect(
      await withSnapshot(
        key,
        async (): Promise<string | null> => null,
        options(),
      ),
    ).toBe("now exists");
  });

  test("concurrent calls for one key share one load", async () => {
    const key = freshKey();
    const gate = Promise.withResolvers<{ v: number }>();
    const load = mock(() => gate.promise);

    const calls = [
      withSnapshot(key, load, options()),
      withSnapshot(key, load, options()),
      withSnapshot(key, load, options()),
    ];
    const other = withSnapshot(freshKey(), async () => ({ v: 2 }), options());
    await Bun.sleep(1);
    expect(load).toHaveBeenCalledTimes(1);
    gate.resolve({ v: 1 });
    expect(await Promise.all(calls)).toEqual([{ v: 1 }, { v: 1 }, { v: 1 }]);
    expect(await other).toEqual({ v: 2 });
  });

  test("a shared load that fails rejects every caller, and the next call retries", async () => {
    const key = freshKey();
    const error = new GitHubError("unavailable", "down");
    const gate = Promise.withResolvers<string>();
    const load = mock(() => gate.promise);

    const first = withSnapshot(key, load, options());
    const second = withSnapshot(key, load, options());
    gate.reject(error);
    await expect(first).rejects.toBe(error);
    await expect(second).rejects.toBe(error);
    await Promise.allSettled([first, second]);

    expect(await withSnapshot(key, async () => "recovered", options())).toBe(
      "recovered",
    );
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("provisional values are re-checked after a minute", async () => {
    const key = freshKey();
    interface Repo {
      activity: number[] | null;
    }
    let computing = true;
    const load = mock(
      async (): Promise<Repo> => ({ activity: computing ? null : [1, 2, 3] }),
    );
    const opts = options<Repo>({
      provisional: (repo) => repo.activity === null,
    });

    expect(await withSnapshot(key, load, opts)).toEqual({ activity: null });
    advance(PROVISIONAL_FRESH_SECONDS - 1);
    await withSnapshot(key, load, opts);
    expect(load).toHaveBeenCalledTimes(1);

    computing = false;
    advance(1);
    expect(await withSnapshot(key, load, opts)).toEqual({
      activity: [1, 2, 3],
    });
    // The settled value now lives its full freshFor.
    advance(899);
    await withSnapshot(key, load, opts);
    expect(load).toHaveBeenCalledTimes(2);
    expect(PROVISIONAL_FRESH_SECONDS).toBe(60);
  });

  test("a value that stays provisional gets one quick re-check per freshFor, not one a minute", async () => {
    const key = freshKey();
    interface Repo {
      activity: number[] | null;
    }
    // GitHub never finishes computing (or its statistics service is down).
    const load = mock(async (): Promise<Repo> => ({ activity: null }));
    const opts = options<Repo>({
      provisional: (repo) => repo.activity === null,
    });

    await withSnapshot(key, load, opts);
    advance(PROVISIONAL_FRESH_SECONDS);
    await withSnapshot(key, load, opts);
    expect(load).toHaveBeenCalledTimes(2);

    // The re-check did not help: from here on the value lives its freshFor.
    for (let minute = 0; minute < 14; minute += 1) {
      advance(60);
      await withSnapshot(key, load, opts);
    }
    expect(load).toHaveBeenCalledTimes(2);
    advance(59);
    await withSnapshot(key, load, opts);
    expect(load).toHaveBeenCalledTimes(2);

    // The regular refresh, and again exactly one quick re-check after it.
    advance(1);
    await withSnapshot(key, load, opts);
    expect(load).toHaveBeenCalledTimes(3);
    advance(PROVISIONAL_FRESH_SECONDS);
    await withSnapshot(key, load, opts);
    expect(load).toHaveBeenCalledTimes(4);
    advance(899);
    await withSnapshot(key, load, opts);
    expect(load).toHaveBeenCalledTimes(4);

    // Over half an hour: 4 loads instead of 30.
  });

  test("the quick re-check is back once a value has settled", async () => {
    const key = freshKey();
    interface Repo {
      activity: number[] | null;
    }
    let computing = true;
    const load = mock(
      async (): Promise<Repo> => ({ activity: computing ? null : [1] }),
    );
    const opts = options<Repo>({
      provisional: (repo) => repo.activity === null,
    });

    // Provisional twice, so the stored value is marked as re-checked.
    await withSnapshot(key, load, opts);
    advance(PROVISIONAL_FRESH_SECONDS);
    await withSnapshot(key, load, opts);
    // The regular refresh finds the statistics ready.
    computing = false;
    advance(900);
    expect(await withSnapshot(key, load, opts)).toEqual({ activity: [1] });
    expect(load).toHaveBeenCalledTimes(3);

    // A push resets GitHub's statistics: provisional again at the next
    // refresh, and that deserves a quick re-check like the first time.
    computing = true;
    advance(900);
    expect(await withSnapshot(key, load, opts)).toEqual({ activity: null });
    computing = false;
    advance(PROVISIONAL_FRESH_SECONDS);
    expect(await withSnapshot(key, load, opts)).toEqual({ activity: [1] });
    expect(load).toHaveBeenCalledTimes(5);
  });

  test("a provisional value found long after it was stored is re-checked quickly", async () => {
    const key = freshKey();
    interface Repo {
      activity: number[] | null;
    }
    const load = mock(async (): Promise<Repo> => ({ activity: null }));
    const opts = options<Repo>({
      provisional: (repo) => repo.activity === null,
    });

    // One visitor, then nobody for three days: the statistics went cold.
    await withSnapshot(key, load, opts);
    advance(3 * 86_400);
    await withSnapshot(key, load, opts);
    expect(load).toHaveBeenCalledTimes(2);
    // That load was a regular refresh, not the quick re-check.
    advance(PROVISIONAL_FRESH_SECONDS);
    await withSnapshot(key, load, opts);
    expect(load).toHaveBeenCalledTimes(3);
  });

  test("a provisional value is still good enough to serve stale", async () => {
    const key = freshKey();
    const opts = options<{ activity: null }>({ provisional: () => true });
    await withSnapshot(key, async () => ({ activity: null }), opts);
    advance(3600);
    expect(
      await withSnapshot(
        key,
        async () => Promise.reject(new GitHubError("rate_limited", "x")),
        opts,
      ),
    ).toEqual({ activity: null });
  });

  test("a stored value of an older shape is ignored", async () => {
    const key = freshKey();
    const isCurrent = (value: unknown): value is { version: 2 } =>
      typeof value === "object" &&
      value !== null &&
      "version" in value &&
      value.version === 2;
    // Written by "the previous deployment".
    await withSnapshot(key, async () => ({ version: 1 }), options());

    const load = mock(async () => ({ version: 2 as const }));
    expect(
      await withSnapshot(key, load, options({ accept: isCurrent })),
    ).toEqual({ version: 2 });
    expect(load).toHaveBeenCalledTimes(1);

    // And it is not served stale either.
    const other = freshKey();
    await withSnapshot(other, async () => ({ version: 1 }), options());
    advance(1000);
    const error = new GitHubError("unavailable", "down");
    await expect(
      withSnapshot(
        other,
        async (): Promise<{ version: 2 }> => Promise.reject(error),
        options({ accept: isCurrent }),
      ),
    ).rejects.toBe(error);
  });

  test("values are stored for staleFor, nulls only for their negative window", async () => {
    const set = mock(
      async (_key: string, _value: unknown, _ttlSeconds: number) => {},
    );
    setSnapshotStore({ get: async () => null, set });
    await withSnapshot("a", async () => ({ v: 1 }), options());
    await withSnapshot("b", async () => null, options());
    await withSnapshot("c", async () => null, options({ freshFor: 120 }));
    // The stored JSON is an envelope around the value.
    expect(set.mock.calls).toEqual([
      ["a", { value: { v: 1 }, rechecked: false }, 604_800],
      ["b", { value: null, rechecked: false }, 300],
      ["c", { value: null, rechecked: false }, 120],
    ]);
  });

  test("an entry without the envelope (an older build's) is ignored", async () => {
    const store = createMemorySnapshotStore({ now });
    setSnapshotStore(store);
    const key = freshKey();
    await store.set(key, { v: 1 }, 604_800);

    const load = mock(async () => ({ v: 2 }));
    expect(await withSnapshot(key, load, options())).toEqual({ v: 2 });
    expect(load).toHaveBeenCalledTimes(1);

    // Not served stale either: nobody knows what it is.
    const other = freshKey();
    await store.set(other, { v: 1 }, 604_800);
    const error = new GitHubError("unavailable", "down");
    await expect(
      withSnapshot(other, async () => Promise.reject(error), options()),
    ).rejects.toBe(error);
  });

  test("an injected store is process-wide, not per copy of the module", async () => {
    // Next.js may load this module once per server bundle. The store lives
    // on globalThis so that injecting it once is enough for all of them.
    const injected = createMemorySnapshotStore({ now });
    setSnapshotStore(injected);
    const slot: unknown = Reflect.get(
      globalThis,
      Symbol.for("gitbanners.github.snapshot"),
    );
    expect(slot).toHaveProperty("store", injected);

    const key = freshKey();
    await withSnapshot(key, async () => ({ v: 1 }), options());
    expect((await injected.get(key))?.value).toEqual({
      value: { v: 1 },
      rechecked: false,
    });
  });

  test("a broken store never breaks the data path", async () => {
    const broken: SnapshotStore = {
      get: async () => {
        throw new Error("redis: connection refused");
      },
      set: async () => {
        throw new Error("redis: connection refused");
      },
    };
    setSnapshotStore(broken);
    const load = mock(async () => ({ v: 1 }));
    expect(await withSnapshot(freshKey(), load, options())).toEqual({ v: 1 });
    expect(load).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(2);

    const error = new GitHubError("unavailable", "down");
    await expect(
      withSnapshot(freshKey(), async () => Promise.reject(error), options()),
    ).rejects.toBe(error);
  });
});

describe("createMemorySnapshotStore", () => {
  test("stores with a timestamp and forgets after the ttl", async () => {
    const store = createMemorySnapshotStore({ now });
    await store.set("k", { v: 1 }, 10);
    expect(await store.get("k")).toEqual({ value: { v: 1 }, storedAt: now() });
    advance(9);
    expect((await store.get("k"))?.value).toEqual({ v: 1 });
    advance(1);
    expect(await store.get("k")).toBeNull();
    expect(await store.get("never-set")).toBeNull();
  });

  test("is bounded: the least recently used entry goes first", async () => {
    const store = createMemorySnapshotStore({ maxEntries: 3, now });
    await store.set("a", 1, 100);
    await store.set("b", 2, 100);
    await store.set("c", 3, 100);
    // Reading "a" makes "b" the oldest.
    await store.get("a");
    await store.set("d", 4, 100);
    expect(await store.get("b")).toBeNull();
    expect((await store.get("a"))?.value).toBe(1);
    expect((await store.get("c"))?.value).toBe(3);
    expect((await store.get("d"))?.value).toBe(4);
  });

  test("the default bound is 500 entries", async () => {
    const store = createMemorySnapshotStore({ now });
    for (let index = 0; index < 501; index += 1) {
      await store.set(`k${index}`, index, 100);
    }
    expect(await store.get("k0")).toBeNull();
    expect((await store.get("k1"))?.value).toBe(1);
    expect((await store.get("k500"))?.value).toBe(500);
  });

  test("overwriting a key replaces value and timestamp", async () => {
    const store = createMemorySnapshotStore({ now });
    await store.set("k", "old", 100);
    advance(50);
    await store.set("k", "new", 100);
    expect(await store.get("k")).toEqual({ value: "new", storedAt: now() });
  });
});
