/**
 * Repositories: `/{owner}/{repo}`.
 *
 * One GraphQL document (RepoCore, 1 point, 0.35-0.6 s, 2 s for the largest
 * repositories) plus the three things GraphQL lacks, from REST and in
 * parallel with it: contributors with avatars, weekly commit activity and
 * star history. The REST add-ons are optional; only the core can fail the
 * fetch.
 *
 * Firing the add-ons with the core saves a round trip, and wastes three REST
 * requests when the repository turns out not to exist. Names that did not
 * resolve to a public repository are therefore remembered per process and
 * checked with the core alone from then on: a deleted repository's banner
 * stays embedded for years and is re-checked every few minutes. It also
 * keeps the add-ons of a private repository the token can see from being
 * requested more than once.
 */
import { graphql, type RequestOptions, rest, withDeadline } from "./client";
import { GitHubError, isGitHubError } from "./errors";
import { createNameMemory } from "./memory";
import { isPublic, toContributors, toRepo, toStarHistory } from "./normalize";
import { optional } from "./optional";
import type { FetchOptions } from "./owner";
import { REPO_CORE } from "./queries";
import {
  decode,
  type RawRepoCore,
  RepoCoreDataSchema,
  RestStarHistorySchema,
  type RestStarWeek,
} from "./raw";
import {
  type AccountList,
  fetchAccountList,
  fetchCommitActivity,
  repoPath,
} from "./rest-data";
import { isValidLogin, isValidRepoName, type Repo } from "./schema";
import { getServerToken } from "./token";

/**
 * Contributors requested per repository. More than the 30 we keep, because
 * release and dependency bots are filtered out of the list afterwards.
 */
const CONTRIBUTORS_PER_PAGE = 40;

/** `owner/name` as requested, for names that were no public repository. */
const knownMissing = createNameMemory();

async function fetchCore(
  owner: string,
  name: string,
  transport: RequestOptions,
): Promise<RawRepoCore | null> {
  const { data } = await graphql(REPO_CORE, { owner, name }, transport);
  return decode(RepoCoreDataSchema, data, "RepoCore").repository;
}

/**
 * Top contributors and their total number. Never requested with `anon=1`:
 * anonymous rows carry e-mail addresses.
 *
 * GitHub refuses the list for the largest repositories ("too large to list
 * contributors", HTTP 403 that is not a rate limit) and answers 204 for an
 * empty one. Both are a normal state of the repository, not a failure.
 */
async function fetchContributors(
  owner: string,
  name: string,
  transport: RequestOptions,
): Promise<AccountList | null> {
  try {
    return await fetchAccountList(
      `${repoPath(owner, name)}/contributors`,
      CONTRIBUTORS_PER_PAGE,
      transport,
    );
  } catch (error) {
    if (isGitHubError(error) && error.code === "forbidden") return null;
    throw error;
  }
}

/** New stars per week for the most recent 30 weeks (the endpoint's page size). */
async function fetchStarWeeks(
  owner: string,
  name: string,
  transport: RequestOptions,
): Promise<RestStarWeek[] | null> {
  const response = await rest(
    `${repoPath(owner, name)}/stargazers/history`,
    transport,
  );
  if (response.data === null) return null;
  return decode(RestStarHistorySchema, response.data, "star history");
}

/**
 * A public repository with everything a repository banner shows.
 *
 * - Renamed or transferred repositories resolve to their current home:
 *   `fullName` and `owner` come from the response, so compare `fullName` with
 *   the requested name to redirect to the canonical URL.
 * - `contributors` is empty and `contributorCount` is `null` when GitHub does
 *   not list them (repositories too large for the endpoint, empty ones).
 * - `activity` is `null` while GitHub is still computing the statistics
 *   (HTTP 202, typically ready seconds later). Nothing waits for it here.
 * - `starHistory` is `null` when the history cannot be fetched.
 *
 * @returns `null` when the repository does not exist, is not public, or the
 *   names cannot be a GitHub repository (no request is sent).
 * @throws GitHubError when the core request fails, and `unavailable` when no
 *   token is configured: unlike owners, repositories have no public fallback.
 */
export async function fetchRepo(
  owner: string,
  name: string,
  opts: FetchOptions = {},
): Promise<Repo | null> {
  if (!isValidLogin(owner) || !isValidRepoName(name)) return null;
  if (!opts.token && !getServerToken()) {
    throw new GitHubError(
      "unavailable",
      "Repository data needs a GitHub token (set GITHUB_TOKEN)",
    );
  }
  const transport: RequestOptions = {
    token: opts.token,
    // One deadline for the whole fetch, including the contributor count that
    // follows the contributor list.
    signal: withDeadline(opts.signal),
  };
  const subject = `${owner}/${name}`;
  // The add-ons are requested under the name as given: GitHub redirects the
  // REST paths of a renamed repository just like GraphQL follows the rename.
  // Each is optional, so the combined promise never rejects and is safe to
  // start before the core has answered.
  const startAddOns = () =>
    Promise.all([
      optional(
        "contributors",
        subject,
        fetchContributors(owner, name, transport),
      ),
      optional(
        "commit activity",
        subject,
        fetchCommitActivity(owner, name, transport),
      ),
      optional("star history", subject, fetchStarWeeks(owner, name, transport)),
    ]);
  const speculative = knownMissing.has(subject) ? null : startAddOns();
  const core = await fetchCore(owner, name, transport);
  const found = core !== null && isPublic(core);
  knownMissing.note(subject, !found);
  if (!found) return null;
  const [contributors, activity, starWeeks] = await (speculative ??
    startAddOns());
  return toRepo(
    core,
    {
      contributors: contributors ? toContributors(contributors.accounts) : [],
      contributorCount: contributors?.total ?? null,
      activity,
      starHistory: starWeeks
        ? toStarHistory(starWeeks, core.stargazerCount)
        : null,
    },
    { now: opts.now ?? new Date() },
  );
}
