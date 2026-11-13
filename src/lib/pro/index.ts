/**
 * Pro = the signed-in user starred the repository.
 *
 * The decision is made at sign-in, where a fresh GitHub token is at hand, and
 * cached in `pro:{id}`. Later re-checks need no user token at all: they go
 * through the server-side stargazer lookup. An outage never downgrades
 * anyone: when no check can answer, the last known value stays.
 */
import "server-only";
import { hasStarred } from "@/lib/auth/github";
import { getUser } from "@/lib/db/users";
import { LOGIN_RE, REPO_NAME_RE } from "@/lib/github/schema";
import { forbidden, type ProblemOverrides } from "@/lib/http/problem";
import { site } from "@/lib/site";
import { getStore, keys, type Store } from "@/lib/store";
import { type Entitlements, entitlementsFor } from "./entitlements";

/** Which check produced a positive Pro decision. */
export type ProSource = "allowlist" | "user_token" | "stargazers";

/** The `pro:{id}` document. */
export interface ProStatus {
  pro: boolean;
  /**
   * When this value was last decided, epoch milliseconds: confirmed by a
   * check, or kept because no check could answer. Freshness is `now - at`.
   */
  at: number;
  /** `null` whenever `pro` is false. */
  source: ProSource | null;
}

/** A repository as `owner` and `name`, both already validated. */
export interface StarRepo {
  owner: string;
  name: string;
}

/**
 * Server-side "is this user a stargazer?" lookup, matched on the numeric user
 * id. It works with the server's own credentials, so it also covers a private
 * repository and needs nothing from the user.
 */
export type StargazerLookup = (
  repo: StarRepo,
  userId: number,
  opts?: { token?: string; maxPages?: number; signal?: AbortSignal },
) => Promise<"starred" | "not_starred" | "unknown">;

/**
 * Everything with side effects, injectable so the rules can be tested alone.
 */
export interface ProDeps {
  store: Store;
  findStargazer: StargazerLookup;
  hasStarred: typeof hasStarred;
  now: () => number;
}

/** How long a cached decision is trusted before it is re-checked. */
export const PRO_FRESH_MS = {
  /** A star rarely goes away, so Pro is re-checked a few times a day. */
  pro: 6 * 60 * 60 * 1000,
  /** Someone who just starred should not wait long. */
  free: 60 * 1000,
} as const;

const STARGAZER_TIMEOUT_MS = 5000;

const NOT_PRO: ProStatus = Object.freeze({ pro: false, at: 0, source: null });

/**
 * Imported lazily so this module, and its tests, load without the GitHub data
 * layer. A failing import is treated like any other failed lookup.
 */
const findStargazerLazily: StargazerLookup = async (repo, userId, opts) => {
  const { findStargazer } = await import("@/lib/github/stargazers");
  return findStargazer(repo, userId, opts);
};

function resolveDeps(deps: Partial<ProDeps> = {}): ProDeps {
  return {
    store: deps.store ?? getStore(),
    findStargazer: deps.findStargazer ?? findStargazerLazily,
    hasStarred: deps.hasStarred ?? hasStarred,
    now: deps.now ?? Date.now,
  };
}

/**
 * The repository whose stargazers are Pro: `PRO_REPO` when set, the product's
 * own repository otherwise. `null` when the value is not `owner/name`, in
 * which case only the allowlist can grant Pro.
 */
export function proRepo(): StarRepo | null {
  const [owner, name, ...rest] = (process.env.PRO_REPO || site.repo.slug).split(
    "/",
  );
  if (rest.length > 0 || !owner || !name) return null;
  if (!LOGIN_RE.test(owner) || !REPO_NAME_RE.test(name)) return null;
  return { owner, name };
}

/**
 * "owner/name" of the repository to star, for messages. Falls back to the
 * product's own repository when `PRO_REPO` is unusable.
 */
export function proRepoSlug(): string {
  const repo = proRepo();
  return repo ? `${repo.owner}/${repo.name}` : site.repo.slug;
}

/**
 * `PRO_LOGINS`: comma-separated logins that are always Pro, case-insensitive.
 */
export function isAllowlisted(login: string): boolean {
  if (!login) return false;
  return (process.env.PRO_LOGINS ?? "")
    .toLowerCase()
    .split(",")
    .map((entry) => entry.trim())
    .includes(login.toLowerCase());
}

function parseStatus(doc: unknown): ProStatus | null {
  if (typeof doc !== "object" || doc === null) return null;
  const { pro, at, source } = doc as Partial<ProStatus>;
  if (typeof pro !== "boolean" || typeof at !== "number") return null;
  const known =
    source === "allowlist" ||
    source === "user_token" ||
    source === "stargazers";
  return { pro, at, source: pro && known ? source : null };
}

function isFresh(status: ProStatus, now: number): boolean {
  return now - status.at < (status.pro ? PRO_FRESH_MS.pro : PRO_FRESH_MS.free);
}

async function save(
  store: Store,
  userId: string,
  status: ProStatus,
): Promise<ProStatus> {
  await store.set(keys.pro(userId), status);
  return status;
}

/**
 * No check could answer: keep what we knew, and trust it for a full freshness
 * window again (six hours for Pro, a minute otherwise).
 *
 * Not "ask again in a moment". For some accounts an inconclusive lookup is the
 * steady state rather than a hiccup: the server token may not be allowed to
 * list stargazers, or the list is too long to prove someone's absence. Asking
 * GitHub again every minute for each of them would spend the quota of the
 * server token, which every banner on the site depends on.
 *
 * A cached allowlist grant is the exception. The allowlist is our own
 * configuration and was just consulted, so a user who is no longer on it has
 * nothing left that speaks for Pro.
 */
function keepLastKnown(
  store: Store,
  userId: string,
  cached: ProStatus | null,
  now: number,
): Promise<ProStatus> {
  const basis = cached?.source === "allowlist" ? null : cached;
  const pro = basis?.pro ?? false;
  return save(store, userId, {
    pro,
    at: now,
    source: pro ? (basis?.source ?? null) : null,
  });
}

async function lookUpStargazer(
  deps: ProDeps,
  userId: string,
): Promise<"starred" | "not_starred" | "unknown"> {
  const repo = proRepo();
  const id = Number(userId);
  if (!repo || !Number.isSafeInteger(id)) return "unknown";
  const signal = AbortSignal.timeout(STARGAZER_TIMEOUT_MS);
  // Raced as well as passed along: the request must not hang on a lookup that
  // ignores the signal.
  const timedOut = new Promise<"unknown">((resolve) => {
    signal.addEventListener("abort", () => resolve("unknown"), { once: true });
  });
  try {
    const verdict = await Promise.race([
      deps.findStargazer(repo, id, { signal }),
      timedOut,
    ]);
    return verdict === "starred" || verdict === "not_starred"
      ? verdict
      : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Decides Pro at sign-in and caches the result. First positive wins:
 *
 *  (a) the `PRO_LOGINS` allowlist, without any network call;
 *  (b) the user's own fresh token, when one is passed;
 *  (c) the server-side stargazer lookup.
 *
 * Without a positive, a definite "no" from (b) or (c) ends Pro. When neither
 * can answer, the last known value stays.
 *
 * The local development sign-in passes no token, so the developer's personal
 * GitHub token is never used for (b).
 */
export async function decideProAtSignIn(
  user: { id: string; login: string },
  options: { accessToken?: string } = {},
  deps?: Partial<ProDeps>,
): Promise<ProStatus> {
  const d = resolveDeps(deps);
  const now = d.now();
  if (isAllowlisted(user.login)) {
    return save(d.store, user.id, { pro: true, at: now, source: "allowlist" });
  }

  const repo = proRepo();
  let notStarred = false;
  if (repo && options.accessToken) {
    const starred = await d
      .hasStarred(options.accessToken, repo)
      .catch(() => "unknown" as const);
    if (starred === true) {
      return save(d.store, user.id, {
        pro: true,
        at: now,
        source: "user_token",
      });
    }
    notStarred = starred === false;
  }

  const verdict = await lookUpStargazer(d, user.id);
  if (verdict === "starred") {
    return save(d.store, user.id, {
      pro: true,
      at: now,
      source: "stargazers",
    });
  }
  if (notStarred || verdict === "not_starred") {
    return save(d.store, user.id, { pro: false, at: now, source: null });
  }
  const cached = parseStatus(await d.store.get(keys.pro(user.id)));
  return keepLastKnown(d.store, user.id, cached, now);
}

async function recheck(
  userId: string,
  cached: ProStatus | null,
  deps: ProDeps,
): Promise<ProStatus> {
  const now = deps.now();
  const user = await getUser(userId, deps.store);
  // Nothing is written for an id that has no account (any more).
  if (!user) return NOT_PRO;
  if (isAllowlisted(user.login)) {
    return save(deps.store, userId, {
      pro: true,
      at: now,
      source: "allowlist",
    });
  }
  const verdict = await lookUpStargazer(deps, userId);
  if (verdict === "starred") {
    return save(deps.store, userId, {
      pro: true,
      at: now,
      source: "stargazers",
    });
  }
  if (verdict === "not_starred") {
    return save(deps.store, userId, { pro: false, at: now, source: null });
  }
  return keepLastKnown(deps.store, userId, cached, now);
}

/**
 * Re-checks in flight, so a burst of requests for one user asks GitHub once.
 */
const inFlight = new WeakMap<Store, Map<string, Promise<ProStatus>>>();

/**
 * The user's Pro status: one read while the cached decision is fresh (six
 * hours when Pro, a minute when not), otherwise a re-check through the
 * allowlist and the server-side stargazer lookup. No user token is involved,
 * so this is safe to call from anywhere, including for the owner of a banner
 * that an anonymous visitor is looking at.
 */
export async function getProStatus(
  userId: string,
  deps?: Partial<ProDeps>,
): Promise<ProStatus> {
  const d = resolveDeps(deps);
  const cached = parseStatus(await d.store.get(keys.pro(userId)));
  if (cached && isFresh(cached, d.now())) return cached;

  let pending = inFlight.get(d.store);
  if (!pending) {
    pending = new Map();
    inFlight.set(d.store, pending);
  }
  let check = pending.get(userId);
  if (!check) {
    const checks = pending;
    check = recheck(userId, cached, d).finally(() => checks.delete(userId));
    pending.set(userId, check);
  }
  return check;
}

/** What the user's plan allows right now. */
export async function getEntitlements(
  userId: string,
  deps?: Partial<ProDeps>,
): Promise<Entitlements> {
  return entitlementsFor((await getProStatus(userId, deps)).pro);
}

/**
 * The 403 every Pro-only feature answers with, so clients can branch on one
 * `code` and always get told how to unlock it.
 */
export function proRequired(
  detail: string,
  overrides: ProblemOverrides = {},
): Response {
  return forbidden(detail, {
    code: "pro_required",
    title: "Pro required",
    resolution: `Star ${proRepoSlug()} on GitHub, then sign in again to unlock Pro.`,
    ...overrides,
  });
}

export {
  type Entitlements,
  entitlementsFor,
  FREE,
  PRO,
} from "./entitlements";
