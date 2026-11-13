import "server-only";
import { z } from "zod";
import type { BannerTarget } from "@/lib/banner/types";
import { LOGIN_RE, REPO_NAME_RE } from "@/lib/github/schema";
import { getStore, keys, type Store, type WriteOp } from "@/lib/store";
import { getLoginIndex, type User } from "./users";

/** A banner configuration a signed-in user saved. Served at `/b/{id}`. */
export interface SavedBanner {
  /** "b" + 11 base36 characters. */
  id: string;
  /** Owner: GitHub numeric user id as a string. */
  userId: string;
  name: string;
  target: BannerTarget;
  /** Preset id, or `null` for the target's default preset. */
  preset: string | null;
  /**
   * Canonical option query string without the leading "?". Opaque to this
   * layer: the banner engine owns its meaning.
   */
  query: string;
  /** ISO 8601, UTC. */
  createdAt: string;
  updatedAt: string;
}

/** A saved banner as the API returns it. */
export type SavedBannerView = SavedBanner & { isDefault: boolean };

/**
 * The parts of the account a banner operation needs: the id it belongs to and
 * the login whose index entry carries the default pointer.
 */
export type BannerOwner = Pick<User, "id" | "login">;

/** Shape of a saved banner id, for validating ids that arrive in URLs. */
export const BANNER_ID_RE = /^b[0-9a-z]{11}$/;
/** Longest banner name, in characters. */
export const MAX_NAME_LENGTH = 60;
/** Longest option query string, in characters. */
export const MAX_QUERY_LENGTH = 2000;

const PRESET_RE = /^[a-z][a-z0-9-]{0,31}$/;
// The `query` production of RFC 3986. Whatever the options mean, the string is
// pasted into URLs and embed snippets, so spaces, quotes, angle brackets,
// "#" and control characters never get stored.
const QUERY_RE = /^(?:[A-Za-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9A-Fa-f]{2})*$/;

const targetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("owner"),
    login: z.string().regex(LOGIN_RE, "Not a valid GitHub login"),
  }),
  z.strictObject({
    kind: z.literal("repo"),
    owner: z.string().regex(LOGIN_RE, "Not a valid GitHub login"),
    name: z.string().regex(REPO_NAME_RE, "Not a valid repository name"),
  }),
]);

const fields = {
  name: z
    .string()
    .trim()
    .min(1)
    .max(MAX_NAME_LENGTH)
    // A label for lists and `alt` texts: one line, nothing invisible.
    .regex(/^\P{Cc}*$/u, "Must not contain control characters"),
  target: targetSchema,
  preset: z
    .string()
    .regex(PRESET_RE, "Lower-case letters, digits and hyphens, at most 32")
    .nullable(),
  // `location.search` starts with "?"; the stored form does not.
  query: z.preprocess(
    (value) =>
      typeof value === "string" && value.startsWith("?")
        ? value.slice(1)
        : value,
    z
      .string()
      .max(MAX_QUERY_LENGTH)
      .regex(QUERY_RE, "Not a valid URL query string"),
  ),
};

/** Body of a create request. Unknown keys are rejected so typos surface. */
export const bannerInputSchema = z.strictObject({
  name: fields.name,
  target: fields.target,
  preset: fields.preset.default(null),
  query: fields.query.default(""),
});

/**
 * Body of an update request: every field optional and without defaults, so
 * an absent field means "leave as is".
 */
export const bannerPatchSchema = z.strictObject({
  name: fields.name.optional(),
  target: fields.target.optional(),
  preset: fields.preset.optional(),
  query: fields.query.optional(),
});

/** A validated create body: every field present. */
export type BannerInput = z.infer<typeof bannerInputSchema>;
/** A validated update body: only the fields to change. */
export type BannerPatch = z.infer<typeof bannerPatchSchema>;

const savedBannerSchema = z.object({
  id: z.string().regex(BANNER_ID_RE),
  userId: z.string(),
  name: z.string(),
  target: targetSchema,
  preset: z.string().nullable(),
  query: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Validated on the way out so a damaged or outdated record reads as missing
// instead of reaching the renderer half-typed.
function parseBanner(doc: unknown): SavedBanner | null {
  const parsed = savedBannerSchema.safeParse(doc);
  return parsed.success ? parsed.data : null;
}

/**
 * "b" + 11 base36 characters from 9 random bytes (about 57 bits).
 *
 * The letter prefix keeps the id from ever looking numeric: the Upstash client
 * JSON-parses replies, so an all-digit sorted-set member would come back as a
 * number.
 */
export function newBannerId(): string {
  const n = crypto
    .getRandomValues(new Uint8Array(9))
    .reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
  return `b${n.toString(36).padStart(14, "0").slice(-11)}`;
}

function saveOps(banner: SavedBanner): WriteOp[] {
  return [
    { op: "set", key: keys.banner(banner.id), value: banner },
    {
      op: "zadd",
      key: keys.userBanners(banner.userId),
      score: Date.parse(banner.updatedAt),
      member: banner.id,
    },
  ];
}

/** Most recently updated first. */
export async function listBanners(
  userId: string,
  store: Store = getStore(),
): Promise<SavedBanner[]> {
  const ids = await store.zrange(keys.userBanners(userId), { reverse: true });
  const docs = await store.mget(ids.map(keys.banner));
  return docs.map(parseBanner).filter((banner) => banner !== null);
}

/** How many banners the user has saved; one cheap read for quota checks. */
export function countBanners(
  userId: string,
  store: Store = getStore(),
): Promise<number> {
  return store.zcard(keys.userBanners(userId));
}

/**
 * Any saved banner by id, whoever owns it: saved banners are public by URL.
 * Malformed ids answer `null` without a round trip.
 */
export async function getBanner(
  id: string,
  store: Store = getStore(),
): Promise<SavedBanner | null> {
  if (!BANNER_ID_RE.test(id)) return null;
  return parseBanner(await store.get(keys.banner(id)));
}

/**
 * The banner only when `userId` owns it. A foreign banner looks exactly like
 * a missing one, so the API never reveals which ids exist.
 */
export async function getOwnedBanner(
  userId: string,
  id: string,
  store: Store = getStore(),
): Promise<SavedBanner | null> {
  const banner = await getBanner(id, store);
  return banner?.userId === userId ? banner : null;
}

/** A plan limit is an expected outcome, not an exception. */
export type CreateBannerResult =
  | { ok: true; banner: SavedBanner }
  | { ok: false; reason: "limit" };

/**
 * Saves a new banner unless the user already has `maxBanners`.
 *
 * The count is checked again after the insert and the insert rolled back if
 * the plan limit was overshot: a burst of parallel requests would otherwise
 * all pass the first check.
 */
export async function createBanner(
  userId: string,
  input: BannerInput,
  maxBanners: number,
  store: Store = getStore(),
): Promise<CreateBannerResult> {
  const listKey = keys.userBanners(userId);
  if ((await store.zcard(listKey)) >= maxBanners) {
    return { ok: false, reason: "limit" };
  }
  const now = new Date().toISOString();
  const banner: SavedBanner = {
    id: newBannerId(),
    userId,
    name: input.name,
    target: input.target,
    preset: input.preset,
    query: input.query,
    createdAt: now,
    updatedAt: now,
  };
  await store.atomic(saveOps(banner));
  if ((await store.zcard(listKey)) > maxBanners) {
    await store.atomic([
      { op: "del", key: keys.banner(banner.id) },
      { op: "zrem", key: listKey, member: banner.id },
    ]);
    return { ok: false, reason: "limit" };
  }
  return { ok: true, banner };
}

/** Applies `patch` to a banner the user owns. `null` when there is none. */
export async function updateBanner(
  userId: string,
  id: string,
  patch: BannerPatch,
  store: Store = getStore(),
): Promise<SavedBanner | null> {
  const current = await getOwnedBanner(userId, id, store);
  if (!current) return null;
  const banner: SavedBanner = {
    ...current,
    name: patch.name ?? current.name,
    target: patch.target ?? current.target,
    // `null` is a value here ("use the default preset"), only undefined is
    // absent.
    preset: patch.preset === undefined ? current.preset : patch.preset,
    query: patch.query ?? current.query,
    updatedAt: new Date().toISOString(),
  };
  await store.atomic(saveOps(banner));
  return banner;
}

/**
 * Deletes a banner the user owns and clears the default pointer if it pointed
 * there. `null` when there is no such banner.
 */
export async function deleteBanner(
  owner: BannerOwner,
  id: string,
  store: Store = getStore(),
): Promise<{ wasDefault: boolean } | null> {
  const banner = await getOwnedBanner(owner.id, id, store);
  if (!banner) return null;
  const wasDefault = (await getDefaultBannerId(owner, store)) === id;
  const ops: WriteOp[] = [
    { op: "del", key: keys.banner(id) },
    { op: "zrem", key: keys.userBanners(owner.id), member: id },
  ];
  if (wasDefault) {
    ops.push({
      op: "set",
      key: keys.login(owner.login),
      value: { id: owner.id },
    });
  }
  await store.atomic(ops);
  return { wasDefault };
}

/** Id of the banner served at `/{login}`, or `null`. */
export async function getDefaultBannerId(
  owner: BannerOwner,
  store: Store = getStore(),
): Promise<string | null> {
  const index = await getLoginIndex(owner.login, store);
  return index?.id === owner.id ? (index.def ?? null) : null;
}

/**
 * Points `/{login}` at one of the user's banners, or clears the pointer with
 * `null`. The caller checks that the banner is the user's.
 *
 * Returns false when the login in the user record meanwhile belongs to another
 * account (the user renamed themselves and GitHub recycled the login). Their
 * session predates the rename, so it must not write to an index it no longer
 * owns; signing in again refreshes the login.
 */
export async function setDefaultBanner(
  owner: BannerOwner,
  bannerId: string | null,
  store: Store = getStore(),
): Promise<boolean> {
  const index = await getLoginIndex(owner.login, store);
  if (index && index.id !== owner.id) return false;
  await store.set(
    keys.login(owner.login),
    bannerId ? { id: owner.id, def: bannerId } : { id: owner.id },
  );
  return true;
}

/**
 * What `/{login}` should render for a registered owner: their user id and the
 * default banner, if they chose one. `null` when nobody with that login has
 * signed in. Two reads at most, no session involved.
 */
export async function getDefaultBanner(
  login: string,
  store: Store = getStore(),
): Promise<{ userId: string; banner: SavedBanner | null } | null> {
  if (!LOGIN_RE.test(login)) return null;
  const index = await getLoginIndex(login, store);
  if (!index) return null;
  const banner = index.def
    ? await getOwnedBanner(index.id, index.def, store)
    : null;
  return { userId: index.id, banner };
}

/** Adds the flag the API exposes instead of the login index internals. */
export function toBannerView(
  banner: SavedBanner,
  defaultId: string | null,
): SavedBannerView {
  return { ...banner, isDefault: banner.id === defaultId };
}
