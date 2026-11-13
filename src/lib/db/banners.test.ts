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
  BANNER_ID_RE,
  type BannerInput,
  bannerInputSchema,
  bannerPatchSchema,
  countBanners,
  createBanner,
  deleteBanner,
  getBanner,
  getDefaultBanner,
  getDefaultBannerId,
  getOwnedBanner,
  listBanners,
  MAX_QUERY_LENGTH,
  newBannerId,
  type SavedBanner,
  setDefaultBanner,
  toBannerView,
  updateBanner,
} from "./banners";
import { getLoginIndex, upsertUser } from "./users";

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

const owner = { id: "4242", login: "Octo-Test" };
const input = (over: Partial<BannerInput> = {}): BannerInput => ({
  name: "My banner",
  target: { kind: "owner", login: "Octo-Test" },
  preset: null,
  query: "",
  ...over,
});

async function create(
  store: Store,
  over: Partial<BannerInput> = {},
  max = 50,
): Promise<SavedBanner> {
  const result = await createBanner(owner.id, input(over), max, store);
  if (!result.ok) throw new Error("expected the banner to be created");
  return result.banner;
}

describe("banner validation", () => {
  const valid = {
    name: "  Profile card  ",
    target: { kind: "owner", login: "torvalds" },
  };

  test("fills defaults and trims the name", () => {
    expect(bannerInputSchema.parse(valid)).toEqual({
      name: "Profile card",
      target: { kind: "owner", login: "torvalds" },
      preset: null,
      query: "",
    });
  });

  test("accepts owner and repository targets", () => {
    for (const target of [
      { kind: "owner", login: "a" },
      { kind: "owner", login: "foo--bar-" },
      { kind: "owner", login: "0" },
      { kind: "repo", owner: "vercel", name: "next.js" },
      { kind: "repo", owner: "x", name: ".github" },
    ]) {
      expect(bannerInputSchema.safeParse({ ...valid, target }).success).toBe(
        true,
      );
    }
  });

  test("rejects targets GitHub could not have", () => {
    for (const target of [
      { kind: "owner", login: "" },
      { kind: "owner", login: "-leading" },
      { kind: "owner", login: "has_underscore" },
      { kind: "owner", login: "a".repeat(40) },
      { kind: "owner", login: "a/b" },
      { kind: "owner", login: "ok", extra: true },
      { kind: "repo", owner: "vercel", name: ".." },
      { kind: "repo", owner: "vercel", name: "a/b" },
      { kind: "repo", owner: "vercel", name: "a".repeat(101) },
      { kind: "repo", owner: "ver cel", name: "next.js" },
      { kind: "repo", name: "next.js" },
      { kind: "org", login: "vercel" },
      "vercel",
      null,
    ]) {
      expect(bannerInputSchema.safeParse({ ...valid, target }).success).toBe(
        false,
      );
    }
  });

  test("name: 1 to 60 characters after trimming", () => {
    const parse = (name: unknown) =>
      bannerInputSchema.safeParse({ ...valid, name }).success;
    expect(parse("a")).toBe(true);
    expect(parse("a".repeat(60))).toBe(true);
    expect(parse(` ${"a".repeat(60)} `)).toBe(true);
    expect(parse("a".repeat(61))).toBe(false);
    expect(parse("   ")).toBe(false);
    expect(parse("")).toBe(false);
    expect(parse(42)).toBe(false);
    // One visible line: emoji and accents are fine, control characters are not.
    expect(parse("Profil d'été 🚀")).toBe(true);
    expect(parse("two\nlines")).toBe(false);
    expect(parse("tab\there")).toBe(false);
    expect(parse("nul\u0000")).toBe(false);
  });

  test("preset: null or a slug of at most 32 characters", () => {
    const parse = (preset: unknown) =>
      bannerInputSchema.safeParse({ ...valid, preset }).success;
    for (const ok of [null, "a", "top-repos", "wrapped-2026", "a".repeat(32)]) {
      expect(parse(ok)).toBe(true);
    }
    for (const bad of ["", "Top", "9lives", "-x", "a_b", "a".repeat(33), 5]) {
      expect(parse(bad)).toBe(false);
    }
  });

  test("query: an opaque URL query string of at most 2000 characters", () => {
    const parse = (query: unknown) =>
      bannerInputSchema.safeParse({ ...valid, query });
    for (const ok of [
      "",
      "theme=dark&size=x",
      "title=Hello%20World&hide=bio,meta",
      "colors=bg:0d1117;text:fff&a=(b)",
      "a".repeat(MAX_QUERY_LENGTH),
    ]) {
      expect(parse(ok).success).toBe(true);
    }
    for (const bad of [
      "a".repeat(MAX_QUERY_LENGTH + 1),
      "theme=dark size=x",
      "x=<script>",
      'x="quoted"',
      "x=1#fragment",
      "x=100%",
      "x=%zz",
      "x=\n",
      "título=1",
      7,
    ]) {
      expect(parse(bad).success).toBe(false);
    }
    // `location.search` can be passed as is.
    expect(parse("?theme=dark").data?.query).toBe("theme=dark");
  });

  test("unknown keys are rejected so typos surface", () => {
    expect(bannerInputSchema.safeParse({ ...valid, userId: "1" }).success).toBe(
      false,
    );
    expect(bannerPatchSchema.safeParse({ nmae: "x" }).success).toBe(false);
  });

  test("a patch has no defaults: absent means unchanged", () => {
    expect(bannerPatchSchema.parse({})).toEqual({});
    expect(bannerPatchSchema.parse({ preset: null })).toEqual({ preset: null });
    expect(bannerPatchSchema.parse({ query: "?a=1" })).toEqual({
      query: "a=1",
    });
    expect(bannerPatchSchema.safeParse({ name: "" }).success).toBe(false);
  });

  test("ids are a letter plus 11 base36 characters and do not repeat", () => {
    const ids = new Set(Array.from({ length: 2000 }, newBannerId));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(id).toMatch(BANNER_ID_RE);
  });
});

for (const [name, make] of stores) {
  describe(`banners: ${name}`, () => {
    let store: Store;
    beforeEach(async () => {
      await shim.flush();
      store = make();
      await upsertUser({ ...owner, name: null, avatarUrl: "" }, store);
    });

    test("create stores the record with ISO timestamps", async () => {
      expect(await listBanners(owner.id, store)).toEqual([]);
      expect(await countBanners(owner.id, store)).toBe(0);
      const banner = await create(store, {
        target: { kind: "repo", owner: "vercel", name: "next.js" },
        preset: "contributors",
        query: "theme=dark",
      });
      expect(banner).toMatchObject({
        userId: "4242",
        name: "My banner",
        target: { kind: "repo", owner: "vercel", name: "next.js" },
        preset: "contributors",
        query: "theme=dark",
      });
      expect(banner.id).toMatch(BANNER_ID_RE);
      expect(new Date(banner.createdAt).toISOString()).toBe(banner.createdAt);
      expect(banner.updatedAt).toBe(banner.createdAt);
      expect(await getBanner(banner.id, store)).toEqual(banner);
      expect(await countBanners(owner.id, store)).toBe(1);
    });

    test("list is most recently updated first, and an update re-sorts", async () => {
      const first = await create(store, { name: "first" });
      await Bun.sleep(3);
      const second = await create(store, { name: "second" });
      await Bun.sleep(3);
      const third = await create(store, { name: "third" });
      const ids = async () =>
        (await listBanners(owner.id, store)).map((banner) => banner.id);
      expect(await ids()).toEqual([third.id, second.id, first.id]);

      await Bun.sleep(3);
      const renamed = await updateBanner(
        owner.id,
        first.id,
        { name: "renamed" },
        store,
      );
      expect(renamed).toMatchObject({ id: first.id, name: "renamed" });
      expect(renamed?.createdAt).toBe(first.createdAt);
      expect((renamed?.updatedAt ?? "") > first.updatedAt).toBe(true);
      expect(await ids()).toEqual([first.id, third.id, second.id]);
    });

    test("update changes only what the patch names; null clears the preset", async () => {
      const banner = await create(store, {
        preset: "stats",
        query: "theme=dark",
      });
      const patched = await updateBanner(
        owner.id,
        banner.id,
        { target: { kind: "owner", login: "torvalds" } },
        store,
      );
      expect(patched).toMatchObject({
        name: "My banner",
        target: { kind: "owner", login: "torvalds" },
        preset: "stats",
        query: "theme=dark",
      });
      const cleared = await updateBanner(
        owner.id,
        banner.id,
        { preset: null, query: "" },
        store,
      );
      expect(cleared).toMatchObject({ preset: null, query: "" });
      expect(await getBanner(banner.id, store)).toEqual(cleared);
    });

    test("other people's banners look exactly like missing ones", async () => {
      const banner = await create(store);
      expect(await getOwnedBanner("777", banner.id, store)).toBeNull();
      expect(
        await updateBanner("777", banner.id, { name: "mine now" }, store),
      ).toBeNull();
      expect(
        await deleteBanner({ id: "777", login: "intruder" }, banner.id, store),
      ).toBeNull();
      expect((await getBanner(banner.id, store))?.name).toBe("My banner");
      // Unknown and malformed ids.
      expect(await getOwnedBanner(owner.id, "b00000000000", store)).toBeNull();
      expect(
        await updateBanner(owner.id, "b00000000000", { name: "x" }, store),
      ).toBeNull();
      expect(await deleteBanner(owner, "b00000000000", store)).toBeNull();
      expect(await getBanner("user:4242", store)).toBeNull();
      expect(await getBanner("", store)).toBeNull();
    });

    test("the plan limit holds", async () => {
      for (let i = 0; i < 3; i++) await create(store, {}, 3);
      expect(await createBanner(owner.id, input(), 3, store)).toEqual({
        ok: false,
        reason: "limit",
      });
      expect(await countBanners(owner.id, store)).toBe(3);
      // A higher limit (Pro) lets the same user continue.
      expect((await createBanner(owner.id, input(), 50, store)).ok).toBe(true);
      // Limits are per user.
      expect((await createBanner("777", input(), 1, store)).ok).toBe(true);
    });

    test("a burst of parallel creates cannot overshoot the limit", async () => {
      await create(store, {}, 3);
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          createBanner(owner.id, input(), 3, store),
        ),
      );
      const stored = await listBanners(owner.id, store);
      expect(stored.length).toBeLessThanOrEqual(3);
      expect(await countBanners(owner.id, store)).toBe(stored.length);
      // Every banner reported as created exists, and nothing else does.
      const created = results.flatMap((result) =>
        result.ok ? [result.banner.id] : [],
      );
      expect(created.length).toBe(stored.length - 1);
      for (const id of created) {
        expect(await getBanner(id, store)).not.toBeNull();
      }
      for (const result of results) {
        if (!result.ok) expect(result.reason).toBe("limit");
      }
    });

    test("default banner: set, resolve by login, clear", async () => {
      const first = await create(store, { name: "first" });
      const second = await create(store, { name: "second" });
      expect(await getDefaultBannerId(owner, store)).toBeNull();
      expect(await getDefaultBanner("octo-test", store)).toEqual({
        userId: "4242",
        banner: null,
      });

      expect(await setDefaultBanner(owner, second.id, store)).toBe(true);
      expect(await getDefaultBannerId(owner, store)).toBe(second.id);
      expect((await getDefaultBanner("OCTO-test", store))?.banner).toEqual(
        second,
      );
      expect(toBannerView(second, second.id).isDefault).toBe(true);
      expect(toBannerView(first, second.id).isDefault).toBe(false);

      expect(await setDefaultBanner(owner, null, store)).toBe(true);
      expect(await getLoginIndex("octo-test", store)).toEqual({ id: "4242" });
      expect((await getDefaultBanner("octo-test", store))?.banner).toBeNull();
    });

    test("getDefaultBanner: unknown and impossible logins are null", async () => {
      expect(await getDefaultBanner("someone-else", store)).toBeNull();
      expect(await getDefaultBanner("not a login", store)).toBeNull();
      expect(await getDefaultBanner("../user:4242", store)).toBeNull();
    });

    test("deleting the default banner clears the pointer", async () => {
      const keep = await create(store, { name: "keep" });
      const gone = await create(store, { name: "gone" });
      await setDefaultBanner(owner, gone.id, store);

      expect(await deleteBanner(owner, keep.id, store)).toEqual({
        wasDefault: false,
      });
      expect(await getDefaultBannerId(owner, store)).toBe(gone.id);

      expect(await deleteBanner(owner, gone.id, store)).toEqual({
        wasDefault: true,
      });
      expect(await getBanner(gone.id, store)).toBeNull();
      expect(await listBanners(owner.id, store)).toEqual([]);
      expect(await getLoginIndex("octo-test", store)).toEqual({ id: "4242" });
    });

    test("a pointer to a banner that is gone or foreign resolves to no banner", async () => {
      await store.set("login:octo-test", { id: "4242", def: "b00000000000" });
      expect(await getDefaultBanner("octo-test", store)).toEqual({
        userId: "4242",
        banner: null,
      });
      const foreign = await createBanner("777", input(), 3, store);
      if (!foreign.ok) throw new Error("setup failed");
      await store.set("login:octo-test", {
        id: "4242",
        def: foreign.banner.id,
      });
      expect((await getDefaultBanner("octo-test", store))?.banner).toBeNull();
    });

    test("a stale session cannot write to a login that was recycled", async () => {
      const banner = await create(store);
      // The user renamed themselves on GitHub and somebody else now holds
      // "Octo-Test" here; the old session still says "Octo-Test".
      await upsertUser(
        { id: "777", login: "Octo-Test", name: null, avatarUrl: "" },
        store,
      );
      expect(await setDefaultBanner(owner, banner.id, store)).toBe(false);
      expect(await getLoginIndex("octo-test", store)).toEqual({ id: "777" });
      expect(await getDefaultBannerId(owner, store)).toBeNull();
      // Deleting their own banner still works and leaves the index alone.
      expect(await deleteBanner(owner, banner.id, store)).toEqual({
        wasDefault: false,
      });
      expect(await getLoginIndex("octo-test", store)).toEqual({ id: "777" });
    });

    test("damaged banner records are skipped", async () => {
      const banner = await create(store);
      await store.atomic([
        {
          op: "set",
          key: "banner:b0000000dead",
          value: { id: "b0000000dead" },
        },
        {
          op: "zadd",
          key: "user:4242:banners",
          score: Date.now() + 1000,
          member: "b0000000dead",
        },
      ]);
      expect(await getBanner("b0000000dead", store)).toBeNull();
      expect(
        (await listBanners(owner.id, store)).map((entry) => entry.id),
      ).toEqual([banner.id]);
    });
  });
}
