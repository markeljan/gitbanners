import "server-only";
import { z } from "zod";
import {
  getStore,
  keys,
  loginKey,
  type Store,
  type WriteOp,
} from "@/lib/store";

/** The `user:{id}` document. Created at first sign-in. */
export interface User {
  /** GitHub numeric user id as a string. The primary key: logins can change. */
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string;
  /**
   * Session version. A session cookie carrying another value is rejected, so
   * changing it signs the user out everywhere.
   */
  sv: number;
  /** ISO 8601, UTC. */
  createdAt: string;
  updatedAt: string;
}

/** What sign-in knows about a GitHub account. */
export type UserProfile = Pick<User, "id" | "login" | "name" | "avatarUrl">;

/**
 * `login:{login}` document. Besides resolving a login to a user it carries
 * the default banner id, so serving `/{login}` costs two reads, not three.
 */
export interface LoginIndex {
  id: string;
  def?: string;
}

const userSchema = z.object({
  id: z.string(),
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string(),
  sv: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const loginIndexSchema = z.object({
  id: z.string(),
  def: z.string().optional(),
});

// Stored documents are validated on the way out: a record written by an older
// version of the app must read as "missing", not as a half-typed object.
function parseUser(doc: unknown): User | null {
  const parsed = userSchema.safeParse(doc);
  return parsed.success ? parsed.data : null;
}

function parseLoginIndex(doc: unknown): LoginIndex | null {
  const parsed = loginIndexSchema.safeParse(doc);
  return parsed.success ? parsed.data : null;
}

/**
 * A random 48-bit session version, never 0.
 *
 * Random rather than a counter: an account that is deleted and created again
 * starts a new record, and a counter (or the clock) could land on a value an
 * old cookie still carries. Only equality is ever checked.
 */
function newSessionVersion(): number {
  const [high, low] = crypto.getRandomValues(new Uint32Array(2));
  return (high & 0xffff) * 2 ** 32 + low + 1;
}

/** The account record, or `null` when the id has none (or it was deleted). */
export async function getUser(
  id: string,
  store: Store = getStore(),
): Promise<User | null> {
  return parseUser(await store.get(keys.user(id)));
}

/** Case-insensitive, like GitHub logins themselves. */
export async function getLoginIndex(
  login: string,
  store: Store = getStore(),
): Promise<LoginIndex | null> {
  return parseLoginIndex(await store.get(keys.login(login)));
}

/**
 * Creates or refreshes the account from a GitHub profile at sign-in.
 *
 * Keeps `createdAt` and `sv`, and moves the login index when the user renamed
 * themselves on GitHub, carrying the default banner pointer along. An index
 * that meanwhile belongs to someone else (GitHub recycles logins) is neither
 * read from nor deleted.
 */
export async function upsertUser(
  profile: UserProfile,
  store: Store = getStore(),
): Promise<User> {
  const [previousDoc, currentIndexDoc] = await store.mget([
    keys.user(profile.id),
    keys.login(profile.login),
  ]);
  const previous = parseUser(previousDoc);
  const now = new Date();
  const user: User = {
    id: profile.id,
    login: profile.login,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    sv: previous?.sv ?? newSessionVersion(),
    createdAt: previous?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };

  const renamedFrom =
    previous && loginKey(previous.login) !== loginKey(profile.login)
      ? previous.login
      : null;
  const oldIndex = renamedFrom
    ? await getLoginIndex(renamedFrom, store)
    : parseLoginIndex(currentIndexDoc);
  const ownsOldIndex = oldIndex?.id === profile.id;
  const def = ownsOldIndex ? oldIndex.def : undefined;

  const ops: WriteOp[] = [
    { op: "set", key: keys.user(profile.id), value: user },
    {
      op: "set",
      key: keys.login(profile.login),
      value: def ? { id: profile.id, def } : { id: profile.id },
    },
  ];
  if (renamedFrom && ownsOldIndex) {
    ops.push({ op: "del", key: keys.login(renamedFrom) });
  }
  await store.atomic(ops);
  return user;
}

/**
 * Invalidates every session cookie of the user ("sign out everywhere").
 * Returns the new version, or 0 when the user does not exist.
 */
export async function bumpSessionVersion(
  id: string,
  store: Store = getStore(),
): Promise<number> {
  const user = await getUser(id, store);
  if (!user) return 0;
  let sv = newSessionVersion();
  while (sv === user.sv) sv = newSessionVersion();
  await store.set(keys.user(id), {
    ...user,
    sv,
    updatedAt: new Date().toISOString(),
  });
  return sv;
}

/**
 * Hard-deletes the account: user record, login index, Pro cache and every
 * saved banner, in one atomic command.
 *
 * Returns the ids of the deleted banners so the caller can purge their cached
 * images.
 */
export async function deleteUser(
  id: string,
  store: Store = getStore(),
): Promise<string[]> {
  const [user, bannerIds] = await Promise.all([
    getUser(id, store),
    store.zrange(keys.userBanners(id)),
  ]);
  const doomed = [
    keys.user(id),
    keys.pro(id),
    keys.userBanners(id),
    ...bannerIds.map(keys.banner),
  ];
  if (user) {
    // Only when it is still ours: the login may have been recycled.
    const index = await getLoginIndex(user.login, store);
    if (index?.id === id) doomed.push(keys.login(user.login));
  }
  await store.del(doomed);
  return bannerIds;
}
