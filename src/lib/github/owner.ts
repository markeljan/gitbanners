/**
 * Users and organizations: `/{owner}`.
 *
 * Request plan. Wall-clock on a warm connection, measured 2026-11-13 on
 * torvalds, markeljan, gaearon and sindresorhus; every GraphQL document costs
 * 1 rate-limit point:
 *
 *   OwnerCore        0.3-0.5 s  tells user from organization + fast-path data
 *   UserExtras       0.4-1.0 s  pinned and top repositories, language bytes
 *   UserTotals       0.2-1.3 s  commits / pull requests / issues / reviews
 *   UserRepoStats    0.3-1.7 s  per page of 100 repositories (star total)
 *   UserYearReview   0.3-0.7 s  only when a calendar year is requested
 *   REST user orgs   0.1-0.2 s
 *
 * `fetchOwnerPreview` sends OwnerCore only (0.4 s). `fetchOwner` needs all
 * of them for a user, and which slow document is the slowest depends on the
 * account. So it fires them TOGETHER with OwnerCore instead of after it: the
 * fetch takes max(...) rather than OwnerCore + max(...). Measured, a complete
 * user takes 0.8-0.9 s this way instead of about 1.25 s, i.e. the whole
 * OwnerCore round trip is saved. (An account with more than 200 starred
 * repositories takes 3-4 s either way: star pages are cursor-paged and can
 * only follow each other.)
 *
 * The price of that speculation is paid when the login is NOT a user: the
 * user documents come back `NOT_FOUND` in about 0.15 s, and 3 points (4 with
 * a year) plus one REST request are spent for nothing. To pay that at most
 * once per login and process, logins that resolved to an organization, or to
 * nothing at all, are remembered and fetched without speculation from then
 * on. The preview, which normally runs first, never speculates and fills that
 * memory, so in the usual page flow an organization costs no wasted point at
 * all. Unknown logins matter as much: the banner of a deleted or renamed
 * account stays embedded in READMEs, "not found" is only cached for five
 * minutes, and every one of those re-checks should cost 1 point, not 4.
 *
 * The reverse is not done: an organization's own extras (1 point and up to
 * 9 REST requests) always start after OwnerCore. Most of them need its
 * repository list, and speculating them would tax every user lookup instead.
 */
import { isValidYear, MIN_YEAR, yearWindow } from "./calendar";
import { graphql, type RequestOptions, rest, withDeadline } from "./client";
import { GitHubError } from "./errors";
import { fetchPublicOwner } from "./fallback";
import { createNameMemory } from "./memory";
import {
  isPublic,
  LIMITS,
  type NormalizeContext,
  sumCommitActivity,
  toAvatarRefs,
  toOrg,
  toUser,
  type UserSlowPath,
} from "./normalize";
import { optional } from "./optional";
import { isPresent } from "./present";
import {
  ORG_EXTRAS,
  OWNER_CORE,
  USER_EXTRAS,
  USER_REPO_STATS,
  USER_TOTALS,
  USER_YEAR_REVIEW,
} from "./queries";
import {
  decode,
  OrgExtrasDataSchema,
  OwnerCoreDataSchema,
  type RawOrgCore,
  type RawOrgExtras,
  type RawUserCore,
  type RawUserExtras,
  type RawUserTotals,
  type RawYearReview,
  RestAccountsSchema,
  RestOrgSchema,
  UserExtrasDataSchema,
  UserRepoStatsDataSchema,
  UserTotalsDataSchema,
  UserYearReviewDataSchema,
} from "./raw";
import { fetchAccountList, fetchCommitActivity } from "./rest-data";
import {
  type AvatarRef,
  type CommitActivity,
  isValidLogin,
  type Org,
  type Owner,
} from "./schema";
import { getServerToken } from "./token";

/** Options accepted by every fetcher of the data layer. */
export interface FetchOptions {
  /**
   * A signed-in user's token, to spend their rate limit instead of the
   * server's. Results fetched with it can include what only that user may
   * see (private contribution counts with the `read:user` scope) and must
   * never be stored in a shared cache.
   */
  token?: string;
  /** Aborts all requests of the fetch. */
  signal?: AbortSignal;
  /**
   * Calendar year for the calendar and the window stats of a user, 2008 to
   * the current UTC year. `null` or omitted: the last 12 months.
   */
  year?: number | null;
  /** Clock override for deterministic tests. */
  now?: Date;
}

/** Star totals stop after this many pages (300 repositories, 3 points). */
const MAX_STAR_PAGES = 3;

/** Logins this process has seen resolve to an organization. */
const knownOrganizations = createNameMemory();
/**
 * Logins this process has seen resolve to nothing. Kept apart from the
 * organizations so that a crawler probing random names cannot push the
 * organizations out.
 */
const knownMissing = createNameMemory();

type RawOwnerCore = RawUserCore | RawOrgCore;

interface OwnerRequest {
  login: string;
  transport: RequestOptions;
  context: NormalizeContext;
  /** `from` / `to` of the requested year, `null` for the last 12 months. */
  window: { from: string; to: string } | null;
}

/**
 * Validates the arguments. Returns `null` for a login GitHub cannot have
 * (callers answer "not found" without a network call).
 * @throws GitHubError `invalid` for a year outside 2008..current year.
 */
function toRequest(login: string, opts: FetchOptions): OwnerRequest | null {
  if (!isValidLogin(login)) return null;
  const now = opts.now ?? new Date();
  const year = opts.year ?? null;
  if (year !== null && !isValidYear(year, now)) {
    throw new GitHubError(
      "invalid",
      `year must be an integer from ${MIN_YEAR} to ${now.getUTCFullYear()}`,
    );
  }
  return {
    login,
    // One deadline for the whole fetch: star pages and an organization's
    // extras follow other requests, and their timeouts must not add up.
    transport: { token: opts.token, signal: withDeadline(opts.signal) },
    context: { now, year },
    window: year === null ? null : yearWindow(year),
  };
}

function hasToken(opts: FetchOptions): boolean {
  return Boolean(opts.token || getServerToken());
}

async function fetchCore(request: OwnerRequest): Promise<RawOwnerCore | null> {
  const { data } = await graphql(
    OWNER_CORE,
    { login: request.login, ...request.window },
    request.transport,
  );
  const owner = decode(OwnerCoreDataSchema, data, "OwnerCore").repositoryOwner;
  knownOrganizations.note(request.login, owner?.__typename === "Organization");
  knownMissing.note(request.login, owner === null);
  return owner;
}

async function fetchExtras(
  request: OwnerRequest,
): Promise<RawUserExtras | null> {
  const { data } = await graphql(
    USER_EXTRAS,
    { login: request.login },
    request.transport,
  );
  return decode(UserExtrasDataSchema, data, "UserExtras").user;
}

async function fetchTotals(
  request: OwnerRequest,
): Promise<RawUserTotals | null> {
  const { data } = await graphql(
    USER_TOTALS,
    { login: request.login, ...request.window },
    request.transport,
  );
  const user = decode(UserTotalsDataSchema, data, "UserTotals").user;
  return user?.contributionsCollection ?? null;
}

/** One page of {@link USER_REPO_STATS}: its star sum and where to go next. */
async function fetchStarPage(
  request: OwnerRequest,
  after: string | null,
): Promise<{ stars: number; next: string | null } | null> {
  const { data } = await graphql(
    USER_REPO_STATS,
    { login: request.login, after },
    request.transport,
  );
  const user = decode(UserRepoStatsDataSchema, data, "UserRepoStats").user;
  if (!user) return null;
  const { nodes, pageInfo } = user.repositories;
  let stars = 0;
  let lastStars = 0;
  for (const node of nodes ?? []) {
    if (!node) continue;
    stars += node.stargazerCount;
    lastStars = node.stargazerCount;
  }
  // Sorted by stars: once a page ends on zero, the rest adds nothing.
  const more = pageInfo.hasNextPage && lastStars > 0;
  return { stars, next: more ? (pageInfo.endCursor ?? null) : null };
}

/**
 * Stars over a user's owned public non-fork repositories. GitHub has no
 * aggregate, so pages of 100 (most-starred first) are summed until one ends
 * on a repository without stars, at most {@link MAX_STAR_PAGES} pages: for
 * the few accounts with more than 300 starred repositories the result is a
 * close lower bound.
 */
async function fetchStarTotal(request: OwnerRequest): Promise<number | null> {
  let stars = 0;
  let after: string | null = null;
  for (let page = 0; page < MAX_STAR_PAGES; page += 1) {
    const result = await fetchStarPage(request, after);
    if (!result) return null;
    stars += result.stars;
    if (result.next === null) break;
    after = result.next;
  }
  return stars;
}

async function fetchYearReview(
  request: OwnerRequest,
  year: number,
): Promise<RawYearReview | null> {
  const previous = yearWindow(year - 1);
  const { data } = await graphql(
    USER_YEAR_REVIEW,
    {
      login: request.login,
      ...yearWindow(year),
      previousFrom: previous.from,
      previousTo: previous.to,
    },
    request.transport,
  );
  return decode(UserYearReviewDataSchema, data, "UserYearReview").user;
}

/**
 * Public organization memberships. REST on purpose: the GraphQL
 * `user.organizations` connection also lists private memberships whenever
 * the token can see them.
 */
async function fetchOrganizations(
  request: OwnerRequest,
): Promise<AvatarRef[] | null> {
  const response = await rest(
    `/users/${encodeURIComponent(request.login)}/orgs?per_page=${LIMITS.organizations}`,
    request.transport,
  );
  if (response.data === null) return null;
  return toAvatarRefs(
    decode(RestAccountsSchema, response.data, "user organizations"),
    LIMITS.organizations,
  );
}

/**
 * Starts every slow-path request of a user at once. The returned promise
 * never rejects: a part that fails is `null` and the user comes out
 * incomplete. That also makes it safe to start before OwnerCore has answered.
 */
function startUserSlowPath(request: OwnerRequest): Promise<UserSlowPath> {
  const { login, context } = request;
  return Promise.all([
    optional("UserExtras", login, fetchExtras(request)),
    optional("UserTotals", login, fetchTotals(request)),
    optional("UserRepoStats", login, fetchStarTotal(request)),
    optional("public organizations", login, fetchOrganizations(request)),
    context.year === null
      ? null
      : optional(
          "UserYearReview",
          login,
          fetchYearReview(request, context.year),
        ),
  ]).then(([extras, totals, stars, organizations, review]) => ({
    extras,
    totals,
    stars,
    organizations,
    review,
  }));
}

async function fetchOrgFollowers(
  login: string,
  transport: RequestOptions,
): Promise<number | null> {
  const response = await rest(`/orgs/${encodeURIComponent(login)}`, transport);
  if (response.data === null) return null;
  const profile = decode(RestOrgSchema, response.data, "organization profile");
  return profile.followers ?? null;
}

async function fetchOrgExtras(
  login: string,
  transport: RequestOptions,
): Promise<RawOrgExtras | null> {
  const { data } = await graphql(ORG_EXTRAS, { login }, transport);
  return decode(OrgExtrasDataSchema, data, "OrgExtras").organization;
}

/**
 * Weekly commits summed over the organization's top repositories, `null` as
 * soon as one of them is unavailable or still being computed: a partial sum
 * would draw a chart that silently misses a repository.
 */
async function fetchOrgActivity(
  core: RawOrgCore,
  transport: RequestOptions,
): Promise<CommitActivity | null> {
  const repos = (core.topRepos.nodes ?? [])
    .filter(isPresent)
    .filter(isPublic)
    .slice(0, LIMITS.repos);
  if (repos.length === 0) return { total: 0, weeks: [] };
  const activities = await Promise.all(
    repos.map((repo) =>
      optional(
        "commit activity",
        `${repo.owner.login}/${repo.name}`,
        fetchCommitActivity(repo.owner.login, repo.name, transport),
      ),
    ),
  );
  return activities.every(isPresent) ? sumCommitActivity(activities) : null;
}

/**
 * Completes an organization. Every extra is optional: a failure degrades the
 * banner (no followers, no people, no languages, totals from the top 6
 * repositories only, no activity chart) instead of failing it.
 */
async function completeOrg(
  core: RawOrgCore,
  request: OwnerRequest,
): Promise<Org> {
  const { transport } = request;
  const { login } = core;
  const [followers, members, extras, activity] = await Promise.all([
    optional(
      "organization profile",
      login,
      fetchOrgFollowers(login, transport),
    ),
    // Public members by contract, whoever owns the token (unlike GraphQL
    // `membersWithRole`, which counts private members for a member's token).
    optional(
      "public members",
      login,
      fetchAccountList(
        `/orgs/${encodeURIComponent(login)}/public_members`,
        LIMITS.people,
        transport,
      ),
    ),
    optional("OrgExtras", login, fetchOrgExtras(login, transport)),
    fetchOrgActivity(core, transport),
  ]);
  return toOrg(
    core,
    {
      followers,
      members: members?.total ?? null,
      people: members ? toAvatarRefs(members.accounts, LIMITS.people) : null,
      extras,
      activity,
    },
    request.context,
  );
}

/**
 * The fast path for `/{owner}`: ONE round trip.
 *
 * - User: profile, calendar, streak, best day, `stats.contributions` and
 *   `stats.repositories`. Every slow-path stat is `null`, `repos`,
 *   `languages` and `organizations` are empty, `complete` is false.
 * - Organization: the complete organization (its extra requests run too;
 *   there is no slow path worth splitting). Do not follow up with
 *   {@link fetchOwner} for an organization: it would fetch the same again.
 *
 * Without any token the public fallback of `fallback.ts` is used.
 *
 * @returns `null` for an unknown login, and for a string that cannot be a
 *   login (no request is sent). The returned `login` has GitHub's casing.
 * @throws GitHubError when GitHub cannot be asked (`invalid` for a bad year).
 */
export async function fetchOwnerPreview(
  login: string,
  opts: FetchOptions = {},
): Promise<Owner | null> {
  const request = toRequest(login, opts);
  if (!request) return null;
  if (!hasToken(opts)) return fetchPublicOwner(login, opts);
  const core = await fetchCore(request);
  if (!core) return null;
  if (core.__typename === "Organization") return completeOrg(core, request);
  return toUser(core, null, request.context);
}

/**
 * Complete data for `/{owner}`.
 *
 * For a user the slow path (repositories, languages, contribution-type
 * totals, stars, organizations, and the year in review when `opts.year` is
 * set) is fetched in parallel with the core; see the request plan at the top
 * of this file. If part of the slow path fails or times out while the core
 * succeeded, the user is still returned, with those fields `null` or empty
 * and `complete: false`.
 *
 * Without any token the public fallback of `fallback.ts` is used and users
 * are never complete.
 *
 * @returns `null` for an unknown login, and for a string that cannot be a
 *   login (no request is sent). The returned `login` has GitHub's casing.
 * @throws GitHubError when the core request fails (`invalid` for a bad year).
 */
export async function fetchOwner(
  login: string,
  opts: FetchOptions = {},
): Promise<Owner | null> {
  const request = toRequest(login, opts);
  if (!request) return null;
  if (!hasToken(opts)) return fetchPublicOwner(login, opts);
  const speculative =
    knownOrganizations.has(login) || knownMissing.has(login)
      ? null
      : startUserSlowPath(request);
  const core = await fetchCore(request);
  if (!core) return null;
  if (core.__typename === "Organization") return completeOrg(core, request);
  const slow = await (speculative ?? startUserSlowPath(request));
  return toUser(core, slow, request.context);
}
