/**
 * Raw GitHub responses -> the normalized model of `schema.ts`.
 *
 * Pure functions, no I/O. Objects are built to satisfy the zod schemas by
 * construction (the inputs were validated once in `raw.ts`); the tests run
 * `Schema.parse` on the results so the two cannot drift apart unnoticed.
 *
 * Privacy is enforced here a second time: any repository that is not
 * `visibility: PUBLIC` is dropped, whatever the token was allowed to see.
 */
import {
  bestDay,
  computeStreak,
  emptyCalendar,
  toCalendar,
  utcDate,
} from "./calendar";
import { isPresent } from "./present";
import type {
  RawLanguage,
  RawLanguageBytes,
  RawOrgCore,
  RawOrgExtras,
  RawOwnerHit,
  RawRepoCard,
  RawRepoCore,
  RawRepoHit,
  RawUserCore,
  RawUserExtras,
  RawUserTotals,
  RawYearReview,
  RestAccount,
  RestCommitWeek,
  RestOrg,
  RestStarWeek,
  RestUser,
} from "./raw";
import type {
  AvatarRef,
  Calendar,
  CommitActivity,
  Contributor,
  Entity,
  Language,
  LanguageShare,
  Org,
  Repo,
  RepoActivityWeek,
  RepoSummary,
  StarHistoryPoint,
  Suggestion,
  User,
  YearInReview,
} from "./schema";

/** GitHub's own grey for languages Linguist has no colour for. */
export const FALLBACK_LANGUAGE_COLOR = "#8b949e";

/** List sizes promised by `schema.ts`. */
export const LIMITS = {
  repos: 6,
  languages: 8,
  organizations: 8,
  people: 24,
  contributors: 30,
  yearTopRepos: 5,
  activityWeeks: 52,
  starWeeks: 30,
  suggestions: 6,
} as const;

/** Release, CI and dependency accounts are not "the people behind a repository". */
const BOT_LOGIN_RE = /(\[bot\]|-bot)$/i;

/** GitHub answers `null` or `""` for unset text; both mean "absent". */
function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** `https://…`, `http://…`: the value already says how to reach it. */
const WEB_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
/** `mailto:x`, `javascript:…`: a scheme, not a `host:port`. */
const OTHER_SCHEME_RE = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

/**
 * A website or homepage field as a link target, or `null`.
 *
 * GitHub stores these as free text, and people often leave out the scheme
 * (`danabra.mov`). Used as an `href` as is, that is a relative link to a
 * page of this site. A value without a scheme gets `https://`; the result
 * must then parse as an http(s) URL with a dotted host name. Anything else
 * (`mailto:`, `javascript:`, a lone word) is not a website and is dropped.
 */
export function cleanUrl(value: string | null | undefined): string | null {
  let text = clean(value);
  if (!text) return null;
  if (text.startsWith("//")) text = `https:${text}`;
  else if (!WEB_SCHEME_RE.test(text)) {
    if (OTHER_SCHEME_RE.test(text)) return null;
    text = `https://${text}`;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname.includes(".") || url.hostname.endsWith(".")) return null;
  return text;
}

/**
 * The one definition of "public" for a repository node: both flags must say
 * so. Internal (enterprise) repositories are `isPrivate` as well.
 */
export function isPublic(repo: {
  isPrivate: boolean;
  visibility: string;
}): boolean {
  return !repo.isPrivate && repo.visibility === "PUBLIC";
}

/** The public repositories of a connection's `nodes`. */
function publicNodes<T extends { isPrivate: boolean; visibility: string }>(
  nodes: readonly (T | null)[] | null | undefined,
): T[] {
  return (nodes ?? []).filter(isPresent).filter(isPublic);
}

/** `2026-11-13T01:02:03Z`: second precision is plenty for "fetched at". */
function timestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function unixWeekToDate(seconds: number): string {
  return utcDate(new Date(seconds * 1000));
}

function toLanguage(raw: RawLanguage | null | undefined): Language | null {
  if (!raw) return null;
  return { name: raw.name, color: raw.color || FALLBACK_LANGUAGE_COLOR };
}

/** A repository card, or `null` when the repository is not public. */
export function toRepoSummary(
  raw: RawRepoCard,
  pinned: boolean,
): RepoSummary | null {
  if (!isPublic(raw)) return null;
  return {
    owner: raw.owner.login,
    name: raw.name,
    description: clean(raw.description),
    stars: raw.stargazerCount,
    forks: raw.forkCount,
    language: toLanguage(raw.primaryLanguage),
    isFork: raw.isFork,
    isArchived: raw.isArchived,
    pinned,
  };
}

/**
 * Language mix by bytes over the given repositories, largest first.
 *
 * `percent` is the share of ALL bytes in those repositories (including
 * languages beyond the ones listed), in tenths of a percent distributed with
 * the largest-remainder method: every share is within 0.1 of its exact value
 * and all languages plus the unlisted rest add up to exactly 100.0, so a
 * consumer can draw "Other" as `100 - sum` without a rounding sliver.
 * Languages whose share rounds to 0.0 are left out.
 */
export function toLanguageShares(
  repos: readonly { languages?: RawLanguageBytes | null }[],
  max: number = LIMITS.languages,
): LanguageShare[] {
  const byName = new Map<string, { color: string; bytes: number }>();
  let totalBytes = 0;
  for (const { languages } of repos) {
    if (!languages) continue;
    let listed = 0;
    for (const edge of languages.edges ?? []) {
      if (!edge || edge.size <= 0) continue;
      listed += edge.size;
      const known = byName.get(edge.node.name);
      if (known) known.bytes += edge.size;
      else {
        byName.set(edge.node.name, {
          color: edge.node.color || FALLBACK_LANGUAGE_COLOR,
          bytes: edge.size,
        });
      }
    }
    // `totalSize` also counts languages past the listed ones.
    totalBytes += Math.max(languages.totalSize, listed);
  }
  if (totalBytes <= 0) return [];

  const sorted = [...byName].sort(
    ([nameA, a], [nameB, b]) => b.bytes - a.bytes || (nameA < nameB ? -1 : 1),
  );
  const listedBytes = sorted.reduce((sum, [, entry]) => sum + entry.bytes, 0);
  // Exact integer maths (bytes * 1000 stays far below 2^53). The last quota
  // is the unlisted rest, so that all quotas together are the whole.
  const quotas = [
    ...sorted.map(([, entry]) => entry.bytes),
    totalBytes - listedBytes,
  ].map((bytes) => {
    const remainder = (bytes * 1000) % totalBytes;
    return { tenths: (bytes * 1000 - remainder) / totalBytes, remainder };
  });
  const spare = 1000 - quotas.reduce((sum, quota) => sum + quota.tenths, 0);
  // Stable sort: on equal remainders the larger language is served first.
  const byRemainder = [...quotas].sort((a, b) => b.remainder - a.remainder);
  for (const quota of byRemainder.slice(0, spare)) quota.tenths += 1;

  return (
    sorted
      .map(([name, entry], index) => ({
        name,
        color: entry.color,
        percent: (quotas[index]?.tenths ?? 0) / 10,
        bytes: entry.bytes,
      }))
      // A share that rounds to 0.0 would only add a "0 %" row to a legend.
      .filter((language) => language.percent > 0)
      .slice(0, max)
  );
}

/**
 * Repositories for a user banner: pinned public repositories first, then the
 * top owned ones by stars, without duplicates.
 */
export function toUserRepos(extras: RawUserExtras): RepoSummary[] {
  const repos: RepoSummary[] = [];
  const seen = new Set<string>();
  const add = (raw: RawRepoCard | null, pinned: boolean) => {
    const repo = raw && toRepoSummary(raw, pinned);
    if (!repo) return;
    const key = `${repo.owner}/${repo.name}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    repos.push(repo);
  };
  for (const node of extras.pinnedItems.nodes ?? []) add(node, true);
  for (const node of extras.topRepos.nodes ?? []) add(node, false);
  return repos.slice(0, LIMITS.repos);
}

/** REST account list -> avatar references, capped at `max`. */
export function toAvatarRefs(
  accounts: readonly (RestAccount | null)[],
  max: number,
): AvatarRef[] {
  const refs: AvatarRef[] = [];
  for (const account of accounts) {
    if (account) {
      refs.push({ login: account.login, avatarUrl: account.avatar_url });
    }
  }
  return refs.slice(0, max);
}

/** REST contributors -> top human contributors, most commits first. */
export function toContributors(
  accounts: readonly (RestAccount | null)[],
): Contributor[] {
  const contributors: Contributor[] = [];
  for (const account of accounts) {
    if (!account) continue;
    if (account.type === "Bot" || BOT_LOGIN_RE.test(account.login)) continue;
    contributors.push({
      login: account.login,
      avatarUrl: account.avatar_url,
      contributions: account.contributions ?? 0,
    });
  }
  return contributors
    .sort((a, b) => b.contributions - a.contributions)
    .slice(0, LIMITS.contributors);
}

/** REST `stats/commit_activity` -> weekly activity, oldest first. */
export function toCommitActivity(
  weeks: readonly RestCommitWeek[],
): CommitActivity {
  const normalized = weeks
    .map(
      (week): RepoActivityWeek => ({
        week: unixWeekToDate(week.week),
        commits: week.total,
        days: week.days?.length === 7 ? [...week.days] : null,
      }),
    )
    .sort((a, b) => (a.week < b.week ? -1 : 1))
    .slice(-LIMITS.activityWeeks);
  return {
    total: normalized.reduce((sum, week) => sum + week.commits, 0),
    weeks: normalized,
  };
}

/**
 * Adds up the activity of several repositories week by week. Repositories
 * whose statistics were computed on different days can be one week apart, so
 * weeks are matched by date and the most recent 52 are kept.
 */
export function sumCommitActivity(
  activities: readonly CommitActivity[],
): CommitActivity {
  const byWeek = new Map<string, RepoActivityWeek>();
  for (const activity of activities) {
    for (const week of activity.weeks) {
      const sum = byWeek.get(week.week);
      if (!sum) {
        byWeek.set(week.week, {
          ...week,
          days: week.days ? [...week.days] : null,
        });
        continue;
      }
      sum.commits += week.commits;
      // Per-day totals only stay meaningful if every repository has them.
      const { days } = sum;
      sum.days =
        days && week.days
          ? days.map((value, index) => value + (week.days?.[index] ?? 0))
          : null;
    }
  }
  const weeks = [...byWeek.values()]
    .sort((a, b) => (a.week < b.week ? -1 : 1))
    .slice(-LIMITS.activityWeeks);
  return { total: weeks.reduce((sum, week) => sum + week.commits, 0), weeks };
}

/**
 * REST `stargazers/history` (new stars per week, any order) -> cumulative
 * stars at the end of each week, oldest first.
 *
 * The endpoint reports the history of *current* stars, so the series is
 * anchored on today's count and walked backwards: one page (30 weeks) is
 * enough, no need to fetch the repository's whole history.
 */
export function toStarHistory(
  weeks: readonly RestStarWeek[],
  currentStars: number,
): StarHistoryPoint[] {
  const newestFirst = [...weeks]
    .sort((a, b) => b.week - a.week)
    .slice(0, LIMITS.starWeeks);
  const points: StarHistoryPoint[] = [];
  let stars = currentStars;
  for (const week of newestFirst) {
    points.push({ week: unixWeekToDate(week.week), stars });
    stars = Math.max(0, stars - week.total);
  }
  return points.reverse();
}

/** Year-in-review extras. `raw` is `null` when they could not be fetched. */
export function toYearInReview(
  year: number,
  raw: RawYearReview | null,
): YearInReview {
  if (!raw) return { year, previousTotal: null, topRepos: [] };
  const topRepos = raw.contributionsCollection.commitContributionsByRepository
    .filter(
      (entry) =>
        isPublic(entry.repository) && entry.contributions.totalCount > 0,
    )
    .map((entry) => ({
      fullName: entry.repository.nameWithOwner,
      commits: entry.contributions.totalCount,
    }))
    .sort((a, b) => b.commits - a.commits)
    .slice(0, LIMITS.yearTopRepos);
  return {
    year,
    previousTotal: raw.previous.contributionCalendar.totalContributions,
    topRepos,
  };
}

/** Clock and window of one fetch, injected so normalization stays pure. */
export interface NormalizeContext {
  /** "Now": decides today (UTC) for the calendar and stamps `fetchedAt`. */
  now: Date;
  /** Requested calendar year, `null` for the last 12 months. */
  year: number | null;
}

/**
 * The slow-path parts of a user. Each is `null` when it was not requested
 * (preview) or its request failed; the user is then marked incomplete.
 */
export interface UserSlowPath {
  /** Pinned + top repositories with language bytes. */
  extras: RawUserExtras | null;
  /** Contribution-type totals for the calendar window. */
  totals: RawUserTotals | null;
  /** Stars over owned public non-fork repositories. */
  stars: number | null;
  /** Public organization memberships. */
  organizations: AvatarRef[] | null;
  /** Year-in-review extras; only requested together with a year. */
  review: RawYearReview | null;
}

/** Public profile fields shared by the GraphQL and the REST source. */
interface UserProfile {
  login: string;
  id: number;
  name: string | null;
  avatarUrl: string;
  bio: string | null;
  company: string | null;
  location: string | null;
  websiteUrl: string | null;
  twitter: string | null;
  pronouns: string | null;
  createdAt: string;
  followers: number;
  following: number;
  repositories: number;
}

function assembleUser(
  profile: UserProfile,
  calendar: Calendar,
  years: readonly number[],
  slow: UserSlowPath | null,
  context: NormalizeContext,
): User {
  const { year } = context;
  const { repositories, ...identity } = profile;
  return {
    kind: "user",
    ...identity,
    stats: {
      contributions: calendar.total,
      commits: slow?.totals?.totalCommitContributions ?? null,
      pullRequests: slow?.totals?.totalPullRequestContributions ?? null,
      issues: slow?.totals?.totalIssueContributions ?? null,
      reviews: slow?.totals?.totalPullRequestReviewContributions ?? null,
      contributedTo:
        slow?.totals?.totalRepositoriesWithContributedCommits ?? null,
      repositories,
      stars: slow?.stars ?? null,
    },
    calendar,
    streak: computeStreak(calendar.days, utcDate(context.now)),
    bestDay: bestDay(calendar.days),
    years: [...years].sort((a, b) => b - a),
    repos: slow?.extras ? toUserRepos(slow.extras) : [],
    languages: slow?.extras
      ? toLanguageShares(publicNodes(slow.extras.topRepos.nodes))
      : [],
    organizations: slow?.organizations ?? [],
    wrapped: year === null ? null : toYearInReview(year, slow?.review ?? null),
    complete:
      slow !== null &&
      slow.extras !== null &&
      slow.totals !== null &&
      slow.stars !== null &&
      slow.organizations !== null &&
      (year === null || slow.review !== null),
    fetchedAt: timestamp(context.now),
  };
}

/**
 * A user from the `OwnerCore` response.
 * @param slow `null` for the preview (fast path only): every slow-path stat
 *   is then `null`, the lists are empty and `complete` is false.
 */
export function toUser(
  core: RawUserCore,
  slow: UserSlowPath | null,
  context: NormalizeContext,
): User {
  const { contributionCalendar, contributionYears } =
    core.contributionsCollection;
  const calendar = toCalendar(
    contributionCalendar.weeks,
    utcDate(context.now),
    contributionCalendar.totalContributions,
  );
  return assembleUser(
    {
      login: core.login,
      id: core.databaseId,
      name: clean(core.name),
      avatarUrl: core.avatarUrl,
      bio: clean(core.bio),
      company: clean(core.company),
      location: clean(core.location),
      websiteUrl: cleanUrl(core.websiteUrl),
      twitter: clean(core.twitterUsername),
      pronouns: clean(core.pronouns),
      createdAt: core.createdAt,
      followers: core.followers.totalCount,
      following: core.following.totalCount,
      repositories: core.publicRepos.totalCount,
    },
    calendar,
    contributionYears,
    slow,
    context,
  );
}

/**
 * A user from the unauthenticated REST profile (tokenless fallback): fast
 * path only, never complete.
 * @param calendar The public contribution calendar, `null` when unavailable.
 */
export function toUserFromRest(
  profile: RestUser,
  calendar: Calendar | null,
  context: NormalizeContext,
): User {
  const today = utcDate(context.now);
  return assembleUser(
    {
      login: profile.login,
      id: profile.id,
      name: clean(profile.name),
      avatarUrl: profile.avatar_url,
      bio: clean(profile.bio),
      company: clean(profile.company),
      location: clean(profile.location),
      websiteUrl: cleanUrl(profile.blog),
      twitter: clean(profile.twitter_username),
      pronouns: null,
      createdAt: profile.created_at,
      followers: profile.followers ?? 0,
      following: profile.following ?? 0,
      repositories: profile.public_repos ?? 0,
    },
    calendar ?? emptyCalendar(today, today),
    [],
    null,
    context,
  );
}

/**
 * Everything about an organization that does not come from `OwnerCore`.
 * Each part is `null` when its request failed.
 */
export interface OrgParts {
  /** REST `followers`; GraphQL has no such field for organizations. */
  followers: number | null;
  /** Public member count. */
  members: number | null;
  /** Public members. */
  people: AvatarRef[] | null;
  /** Star / fork totals and language bytes (`OrgExtras`). */
  extras: RawOrgExtras | null;
  /** `null` also while GitHub is still computing the statistics. */
  activity: CommitActivity | null;
}

/** An organization from the `OwnerCore` response plus its extra requests. */
export function toOrg(
  core: RawOrgCore,
  parts: OrgParts,
  context: Pick<NormalizeContext, "now">,
): Org {
  const pinned = new Set(
    (core.pinnedItems.nodes ?? [])
      .filter(isPresent)
      .map((node) => node.nameWithOwner.toLowerCase()),
  );
  const repos = publicNodes(core.topRepos.nodes)
    .map((raw) =>
      toRepoSummary(
        raw,
        pinned.has(`${raw.owner.login}/${raw.name}`.toLowerCase()),
      ),
    )
    .filter(isPresent)
    .slice(0, LIMITS.repos);
  // Totals over the top 100 repositories; without them, over the 6 we have.
  const counted = parts.extras
    ? (parts.extras.repositories.nodes ?? []).filter(isPresent).map((node) => ({
        stars: node.stargazerCount,
        forks: node.forkCount,
      }))
    : repos;
  return {
    kind: "org",
    login: core.login,
    id: core.databaseId,
    name: clean(core.name),
    avatarUrl: core.avatarUrl,
    description: clean(core.description),
    location: clean(core.location),
    websiteUrl: cleanUrl(core.websiteUrl),
    twitter: clean(core.twitterUsername),
    isVerified: core.isVerified,
    createdAt: core.createdAt,
    stats: {
      repositories: core.publicRepos.totalCount,
      stars: counted.reduce((sum, repo) => sum + repo.stars, 0),
      forks: counted.reduce((sum, repo) => sum + repo.forks, 0),
      members: parts.members,
      followers: parts.followers,
    },
    repos,
    languages: toLanguageShares(publicNodes(parts.extras?.languageRepos.nodes)),
    activity: parts.activity,
    people: (parts.people ?? []).slice(0, LIMITS.people),
    fetchedAt: timestamp(context.now),
  };
}

/**
 * An organization from its unauthenticated REST profile (tokenless
 * fallback): identity and counts only, no repositories, people or activity.
 */
export function toOrgFromRest(
  profile: RestOrg,
  context: Pick<NormalizeContext, "now">,
): Org {
  return {
    kind: "org",
    login: profile.login,
    id: profile.id,
    name: clean(profile.name),
    avatarUrl: profile.avatar_url,
    description: clean(profile.description),
    location: clean(profile.location),
    websiteUrl: cleanUrl(profile.blog),
    twitter: clean(profile.twitter_username),
    isVerified: profile.is_verified ?? false,
    createdAt: profile.created_at,
    stats: {
      repositories: profile.public_repos ?? 0,
      stars: 0,
      forks: 0,
      members: null,
      followers: profile.followers ?? null,
    },
    repos: [],
    languages: [],
    activity: null,
    people: [],
    fetchedAt: timestamp(context.now),
  };
}

/** Everything about a repository that comes from REST. */
export interface RepoParts {
  contributors: Contributor[];
  contributorCount: number | null;
  activity: CommitActivity | null;
  starHistory: StarHistoryPoint[] | null;
}

/**
 * A repository from the `RepoCore` response plus its REST add-ons, or `null`
 * when it is not public. `fullName` is the canonical `nameWithOwner`, which
 * differs from the requested name after a rename or transfer.
 */
export function toRepo(
  core: RawRepoCore,
  parts: RepoParts,
  context: Pick<NormalizeContext, "now">,
): Repo | null {
  if (!isPublic(core)) return null;
  const license = clean(core.licenseInfo?.spdxId);
  const release = core.latestRelease;
  return {
    kind: "repo",
    owner: {
      login: core.owner.login,
      avatarUrl: core.owner.avatarUrl,
      kind: core.owner.__typename === "Organization" ? "org" : "user",
    },
    name: core.name,
    fullName: core.nameWithOwner,
    description: clean(core.description),
    homepageUrl: cleanUrl(core.homepageUrl),
    stars: core.stargazerCount,
    forks: core.forkCount,
    watchers: core.watchers.totalCount,
    openIssues: core.openIssues.totalCount,
    openPullRequests: core.openPullRequests.totalCount,
    language: toLanguage(core.primaryLanguage),
    languages: toLanguageShares([core]),
    // GitHub says NOASSERTION when it found a licence file it cannot name.
    license: license === "NOASSERTION" ? null : license,
    topics: (core.repositoryTopics.nodes ?? [])
      .filter(isPresent)
      .map((node) => node.topic.name),
    createdAt: core.createdAt,
    pushedAt: clean(core.pushedAt),
    isArchived: core.isArchived,
    isFork: core.isFork,
    latestRelease: release
      ? {
          tag: release.tagName,
          name: clean(release.name),
          publishedAt: clean(release.publishedAt),
        }
      : null,
    commits: core.defaultBranchRef?.target?.history?.totalCount ?? null,
    activity: parts.activity,
    starHistory: parts.starHistory,
    contributors: parts.contributors.slice(0, LIMITS.contributors),
    contributorCount: parts.contributorCount,
    fetchedAt: timestamp(context.now),
  };
}

/** A user or organization search hit as a typeahead suggestion. */
export function toOwnerSuggestion(hit: RawOwnerHit): Suggestion {
  return {
    kind: hit.__typename === "Organization" ? "org" : "user",
    slug: hit.login,
    title: clean(hit.name),
    avatarUrl: hit.avatarUrl,
    stars: null,
  };
}

/** A repository search hit as a suggestion, or `null` when it is not public. */
export function toRepoSuggestion(hit: RawRepoHit): Suggestion | null {
  if (!isPublic(hit)) return null;
  return {
    kind: "repo",
    slug: hit.nameWithOwner,
    title: clean(hit.description),
    avatarUrl: hit.owner.avatarUrl,
    stars: hit.stargazerCount,
  };
}

/**
 * True when the entity was most likely fetched while GitHub was still
 * computing its weekly commit statistics (HTTP 202): the chart is missing now
 * and will be there within seconds, so the entity deserves a quick re-fetch
 * instead of a full cache lifetime.
 *
 * The cause of a missing chart is not part of the model, so it is inferred:
 * the activity is `null` while another REST-only field of the same fetch
 * arrived. When REST as a whole is failing or throttled both are missing,
 * and re-fetching every minute would only make that worse. An organization
 * without repositories (the tokenless fallback returns none) has no
 * statistics to wait for.
 */
export function isStatisticsPending(entity: Entity): boolean {
  switch (entity.kind) {
    case "repo":
      return entity.activity === null && entity.starHistory !== null;
    case "org":
      return (
        entity.activity === null &&
        entity.repos.length > 0 &&
        entity.stats.followers !== null
      );
    case "user":
      return false;
  }
}
