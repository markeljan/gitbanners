import "server-only";

/**
 * Cached entry points of the GitHub data layer, and the ONLY Next-specific
 * file in it. Pages, route handlers and the MCP server call these; everything
 * else in `src/lib/github` is plain TypeScript that runs under `bun test`.
 *
 * Decisions, in one place:
 *
 * - Directive: `'use cache: remote'` on every wrapper. The remote handler is
 *   shared between server instances (plain `'use cache'` is per-instance
 *   memory), which is what keeps one GitHub token within its rate limit.
 * - Keys: arguments are trimmed and lower-cased in a small un-cached outer
 *   function, so `/Vercel` and `/vercel` share one entry. Invalid input never
 *   reaches the cache.
 * - cacheLife: the `github` profile from next.config.ts (stale 300 s,
 *   revalidate 900 s, expire 1 day) for results. `minutes` (revalidate 60 s)
 *   for "not found", so a login registered a minute ago shows up soon, and
 *   for entities whose weekly statistics GitHub was still computing, so the
 *   chart appears a minute later instead of a quarter of an hour later.
 *   Only the first of those runs asks GitHub again: `withSnapshot` grants
 *   one quick re-check, and while the statistics stay missing the later runs
 *   are answered from the snapshot until the normal refresh is due.
 *   Never anything shorter-lived than `minutes`: such an entry cannot be
 *   prerendered and turns `ensureStatic` routes into HTTP 500.
 * - cacheTag: `owner:{login}` / `repo:{owner}/{name}` (lower-case), plus the
 *   matching `entityCacheTag()` value that responses carry in
 *   `Vercel-Cache-Tag`, so one `revalidateTag` reaches data and CDN copies.
 *   Suggestions are tagged `search`.
 * - Snapshots: inside the cached function `withSnapshot` keeps results for a
 *   week and serves them when GitHub throttles or is down (the framework
 *   cache forgets everything on each deployment). Fresh for 900 s, in step
 *   with `revalidate`. Stored values are checked against the schema when
 *   read, and token-less results live under their own key prefix.
 * - Partial failures: a refresh that lost an optional part (a user's
 *   totals, a repository's chart) keeps that part from the snapshot it
 *   replaces, see `inherit.ts`.
 * - Errors propagate as `GitHubError`; a thrown result is not cached. An
 *   error that leaves a `'use cache'` function is re-created by React, and
 *   in a production build nothing but its `digest` survives (verified under
 *   `next start`: the caller gets a plain `Error` with a generic message).
 *   `GitHubError` therefore writes code, status and retry delay into its
 *   digest, and every public wrapper here rebuilds the error from it.
 * - No token: a bundled sample is returned for the handful of targets that
 *   have one, which keeps token-less builds and previews working. Everything
 *   else falls through to the fetchers' own tokenless behaviour.
 */
import { cacheLife, cacheTag } from "next/cache";
import type { BannerTarget } from "@/lib/banner/types";
import { entityCacheTag } from "@/lib/http/cache-headers";
import { asGitHubError } from "./errors";
import { inheritOwner, inheritRepo } from "./inherit";
import { isStatisticsPending } from "./normalize";
import { fetchOwner, fetchOwnerPreview } from "./owner";
import { fetchRepo } from "./repo";
import { getSample } from "./samples";
import {
  type Entity,
  isValidLogin,
  isValidRepoName,
  type Owner,
  OwnerSchema,
  OwnerSuggestionSchema,
  type Repo,
  RepoSchema,
  type Suggestion,
} from "./schema";
import { parseSearchQuery, searchGitHub, searchQueryKey } from "./search";
import { withSnapshot } from "./snapshot";
import { hasGitHubToken } from "./token";

/** Seconds a snapshot counts as fresh: the `github` profile's `revalidate`. */
const FRESH_SECONDS = 900;
/** Seconds a snapshot may be served when GitHub fails: one week. */
const STALE_SECONDS = 604_800;
/** Stale suggestions are only worth a day, and prefixes are many. */
const STALE_SEARCH_SECONDS = 86_400;

// Snapshots outlive deployments: a stored value is only used if it still
// matches today's schema.
const isOwner = (value: unknown): value is Owner | null =>
  value === null || OwnerSchema.safeParse(value).success;
const isRepo = (value: unknown): value is Repo | null =>
  value === null || RepoSchema.safeParse(value).success;
const isSuggestions = (value: unknown): value is Suggestion[] =>
  OwnerSuggestionSchema.array().safeParse(value).success;

/** Entities that will look better in a minute: see `isStatisticsPending`. */
const isPending = (entity: Entity | null): boolean =>
  entity !== null && isStatisticsPending(entity);

/**
 * Snapshot key prefix. Results fetched without a token are degraded (no slow
 * path, no repositories). In their own namespace they cannot replace good
 * snapshots when a deployment without a token, a preview for instance,
 * shares the store with production.
 */
const scope = (): string => (hasGitHubToken() ? "" : "anonymous:");

async function cachedOwner(
  login: string,
  year: number | null,
): Promise<Owner | null> {
  "use cache: remote";
  cacheTag(`owner:${login}`, entityCacheTag("owner", login));
  const owner = await withSnapshot(
    `${scope()}owner:${login}:${year ?? "recent"}`,
    () => fetchOwner(login, { year }),
    {
      freshFor: FRESH_SECONDS,
      staleFor: STALE_SECONDS,
      provisional: isPending,
      accept: isOwner,
      inherit: inheritOwner,
    },
  );
  if (owner === null || isPending(owner)) cacheLife("minutes");
  else cacheLife("github");
  return owner;
}

async function cachedOwnerPreview(login: string): Promise<Owner | null> {
  "use cache: remote";
  cacheTag(`owner:${login}`, entityCacheTag("owner", login));
  const owner = await withSnapshot(
    `${scope()}owner-preview:${login}`,
    () => fetchOwnerPreview(login),
    {
      freshFor: FRESH_SECONDS,
      staleFor: STALE_SECONDS,
      provisional: isPending,
      accept: isOwner,
    },
  );
  if (owner === null || isPending(owner)) cacheLife("minutes");
  else cacheLife("github");
  return owner;
}

async function cachedRepo(owner: string, name: string): Promise<Repo | null> {
  "use cache: remote";
  const slug = `${owner}/${name}`;
  cacheTag(`repo:${slug}`, entityCacheTag("repo", slug));
  const repo = await withSnapshot(
    `${scope()}repo:${slug}`,
    () => fetchRepo(owner, name),
    {
      freshFor: FRESH_SECONDS,
      staleFor: STALE_SECONDS,
      provisional: isPending,
      accept: isRepo,
      inherit: inheritRepo,
    },
  );
  if (repo === null || isPending(repo)) cacheLife("minutes");
  else cacheLife("github");
  return repo;
}

async function cachedSuggestions(query: string): Promise<Suggestion[]> {
  "use cache: remote";
  cacheTag("search");
  const suggestions = await withSnapshot(
    `${scope()}search:${query}`,
    () => searchGitHub(query),
    {
      freshFor: FRESH_SECONDS,
      staleFor: STALE_SEARCH_SECONDS,
      accept: isSuggestions,
    },
  );
  if (suggestions.length === 0) cacheLife("minutes");
  else cacheLife("github");
  return suggestions;
}

/**
 * Runs a cached wrapper and gives a failure its type back: what arrives from
 * inside `'use cache'` is no longer a `GitHubError`, see the header. Anything
 * else, Next.js' own control-flow errors included, is rethrown untouched.
 */
async function unwrap<T>(cached: () => Promise<T>): Promise<T> {
  try {
    return await cached();
  } catch (error) {
    throw asGitHubError(error) ?? error;
  }
}

/** A bundled sample of the wanted kind, only when no token is configured. */
function sampleFor(target: BannerTarget): Entity | null {
  return hasGitHubToken() ? null : getSample(target);
}

/**
 * Whether the page of a target can be built on this deployment. Accounts
 * always can (the tokenless fallback covers them). Repository data needs a
 * token, so without one only the repositories with a bundled sample can:
 * links and the sitemap leave out the others rather than point at a page
 * that can only say GitHub is not answering.
 */
export function hasPageData(target: BannerTarget): boolean {
  return (
    target.kind !== "repo" || hasGitHubToken() || getSample(target) !== null
  );
}

/**
 * Complete data of a user or organization, cached.
 *
 * @param year Calendar year (2008..current) for a user's calendar and window
 *   stats; omit for the last 12 months.
 * @returns `null` for an unknown or malformed login.
 * @throws GitHubError when GitHub cannot be asked and no snapshot exists;
 *   code `invalid` for a year out of range.
 */
export async function getOwner(
  login: string,
  year?: number | null,
): Promise<Owner | null> {
  const key = login.trim().toLowerCase();
  if (!isValidLogin(key)) return null;
  if (year == null) {
    const sample = sampleFor({ kind: "owner", login: key });
    if (sample && sample.kind !== "repo") return sample;
  }
  return unwrap(() => cachedOwner(key, year ?? null));
}

/**
 * Fast-path data of a user (profile + last 12 months of calendar, one
 * request, `complete: false`), cached. An organization comes back complete:
 * do not also call {@link getOwner} for it.
 *
 * @returns `null` for an unknown or malformed login.
 * @throws GitHubError when GitHub cannot be asked and no snapshot exists.
 */
export async function getOwnerPreview(login: string): Promise<Owner | null> {
  const key = login.trim().toLowerCase();
  if (!isValidLogin(key)) return null;
  const sample = sampleFor({ kind: "owner", login: key });
  if (sample && sample.kind !== "repo") return sample;
  return unwrap(() => cachedOwnerPreview(key));
}

/**
 * A public repository, cached. Renamed repositories resolve to their current
 * home: compare `fullName` with what was asked for to redirect.
 *
 * @returns `null` for a missing, private or malformed repository.
 * @throws GitHubError when GitHub cannot be asked and no snapshot exists
 *   (always, without a token, unless a sample is bundled).
 */
export async function getRepo(
  owner: string,
  name: string,
): Promise<Repo | null> {
  const ownerKey = owner.trim().toLowerCase();
  const nameKey = name.trim().toLowerCase();
  if (!isValidLogin(ownerKey) || !isValidRepoName(nameKey)) return null;
  const sample = sampleFor({ kind: "repo", owner: ownerKey, name: nameKey });
  if (sample?.kind === "repo") return sample;
  return unwrap(() => cachedRepo(ownerKey, nameKey));
}

/**
 * The entity behind a banner target, cached: {@link getOwner} or
 * {@link getRepo}. `year` only applies to users.
 */
export async function getEntity(
  target: BannerTarget,
  year?: number | null,
): Promise<Entity | null> {
  return target.kind === "owner"
    ? getOwner(target.login, year)
    : getRepo(target.owner, target.name);
}

/**
 * Typeahead suggestions, cached per normalized query: accounts for a login
 * prefix, repositories for `owner/prefix`. `[]` for text that cannot be
 * searched, without touching the cache.
 *
 * @throws GitHubError when the search fails and no snapshot exists.
 */
export async function getSuggestions(query: string): Promise<Suggestion[]> {
  const parsed = parseSearchQuery(query);
  if (!parsed) return [];
  return unwrap(() => cachedSuggestions(searchQueryKey(parsed)));
}
