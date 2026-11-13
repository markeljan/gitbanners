/**
 * Public surface of the GitHub data layer (server side).
 *
 * - Normalized model and name validation: `@/lib/github/schema`.
 * - Cached entry points for pages and route handlers (`getOwner`, `getRepo`,
 *   ...): `@/lib/github/cached`. It is deliberately NOT re-exported here: it
 *   imports `server-only` and `next/cache`, which plain scripts and tests
 *   must be able to avoid.
 * - Client components import `@/lib/github/schema`, `@/lib/github/samples`
 *   and `@/lib/github/calendar` directly; this index also pulls in the
 *   fetchers and Node built-ins.
 */

export {
  bestDay,
  calendarFromDays,
  computeStreak,
  emptyCalendar,
  isValidYear,
  MIN_YEAR,
  type RawContributionDay,
  type RawContributionWeek,
  toCalendar,
  utcDate,
  yearWindow,
} from "./calendar";
export {
  type GraphQLErrorEntry,
  type GraphQLResult,
  getServerToken,
  graphql,
  hasGitHubToken,
  isLocalRefusal,
  lastPage,
  REQUEST_TIMEOUT_MS,
  type RequestOptions,
  type RestResult,
  rest,
  withDeadline,
} from "./client";
export {
  asGitHubError,
  GitHubError,
  type GitHubErrorCode,
  type GitHubErrorOptions,
  isGitHubError,
  isTransient,
} from "./errors";
export {
  fetchPublicCalendar,
  fetchPublicOwner,
  type PublicContributions,
  type PublicFetchOptions,
  parseContributionsHtml,
} from "./fallback";
export {
  FALLBACK_LANGUAGE_COLOR,
  isStatisticsPending,
  LIMITS,
  type NormalizeContext,
  type OrgParts,
  type RepoParts,
  sumCommitActivity,
  toAvatarRefs,
  toCommitActivity,
  toContributors,
  toLanguageShares,
  toOrg,
  toOrgFromRest,
  toOwnerSuggestion,
  toRepo,
  toRepoSuggestion,
  toRepoSummary,
  toStarHistory,
  toUser,
  toUserFromRest,
  toUserRepos,
  toYearInReview,
  type UserSlowPath,
} from "./normalize";
export { type FetchOptions, fetchOwner, fetchOwnerPreview } from "./owner";
export * from "./queries";
export { fetchRepo } from "./repo";
export {
  getSample,
  SAMPLE_ORG,
  SAMPLE_REPO,
  SAMPLE_USER,
  SAMPLES,
} from "./samples";
export {
  MIN_SEARCH_LENGTH,
  parseSearchQuery,
  type SearchOptions,
  type SearchQuery,
  searchGitHub,
  searchQueryKey,
} from "./search";
export {
  createMemorySnapshotStore,
  NEGATIVE_FRESH_SECONDS,
  PROVISIONAL_FRESH_SECONDS,
  type Snapshot,
  type SnapshotOptions,
  type SnapshotStore,
  setSnapshotStore,
  withSnapshot,
} from "./snapshot";
export {
  type FindStargazerOptions,
  findStargazer,
  type StargazerVerdict,
} from "./stargazers";
