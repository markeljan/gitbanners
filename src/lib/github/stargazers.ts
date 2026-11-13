/**
 * "Has this user starred our repository?", the Pro check.
 *
 * Since July 2026 only tokens that administer (or collaborate on) a
 * repository can list its stargazers; everyone else gets an empty list while
 * `stargazerCount` stays non-zero. The check therefore runs server-side with
 * OUR token against OUR repository, which also works while the repository is
 * private, and never needs the visitor's token.
 *
 * The answer has three states on purpose. "Could not look" must never be read
 * as "has not starred": that would take Pro away from people who earned it
 * whenever GitHub hiccups or the token loses access.
 */
import { graphql, rest } from "./client";
import { isGitHubError } from "./errors";
import { STARGAZERS } from "./queries";
import { decode, StargazersDataSchema } from "./raw";
import { isValidLogin, isValidRepoName } from "./schema";
import { getServerToken } from "./token";

/**
 * - `starred`: the user is in the stargazer list.
 * - `not_starred`: the whole list was read and the user is not in it.
 * - `unknown`: the list could not be read, or not to its end.
 */
export type StargazerVerdict = "starred" | "not_starred" | "unknown";

/** Options of {@link findStargazer}. */
export interface FindStargazerOptions {
  /** Token that administers the repository. Defaults to the server token. */
  token?: string;
  /** Pages of 100 stargazers to read before giving up. Default 10. */
  maxPages?: number;
  signal?: AbortSignal;
}

const DEFAULT_MAX_PAGES = 10;

/** What one page of the stargazer list says about the user. */
type PageVerdict =
  | { verdict: StargazerVerdict }
  | { verdict: null; next: string; seen: number };

/**
 * Reads one page. `seenBefore` is the number of stargazers on earlier pages.
 */
async function readPage(
  repo: { owner: string; name: string },
  userId: number,
  after: string | null,
  seenBefore: number,
  transport: { token: string; signal?: AbortSignal },
): Promise<PageVerdict> {
  const { data } = await graphql(
    STARGAZERS,
    { owner: repo.owner, name: repo.name, after },
    transport,
  );
  const repository = decode(
    StargazersDataSchema,
    data,
    "Stargazers",
  ).repository;
  if (!repository) return { verdict: "unknown" };
  const { stargazers, stargazerCount } = repository;
  let seen = seenBefore;
  for (const edge of stargazers.edges ?? []) {
    if (!edge) continue;
    if (edge.node.databaseId === userId) return { verdict: "starred" };
    seen += 1;
  }
  const { hasNextPage, endCursor } = stargazers.pageInfo;
  if (hasNextPage && endCursor) return { verdict: null, next: endCursor, seen };
  // The end of the list proves absence only if the list was complete: a
  // token without access sees no entries although the repository has stars.
  const complete =
    stargazers.totalCount >= stargazerCount && seen >= stargazerCount;
  return { verdict: complete ? "not_starred" : "unknown" };
}

/**
 * Looks for a user among a repository's stargazers, newest first, matching
 * on the numeric user id (logins can be renamed and reused).
 *
 * Someone who starred a moment ago is on the first page, so the usual
 * "I just starred, verify me" check costs one request.
 *
 * `unknown` is returned whenever a negative answer would not be proven:
 * - no token, or the repository does not resolve for it,
 * - the token cannot see the list (no entries although the repository has
 *   stars, or fewer entries than its star count),
 * - the list is longer than `maxPages` pages and the user was not in them,
 * - GitHub failed or throttled the request.
 *
 * Never throws.
 */
export async function findStargazer(
  repo: { owner: string; name: string },
  userId: number,
  opts: FindStargazerOptions = {},
): Promise<StargazerVerdict> {
  const token = opts.token || getServerToken();
  if (
    !token ||
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    !isValidLogin(repo.owner) ||
    !isValidRepoName(repo.name)
  ) {
    return "unknown";
  }
  const maxPages = Math.max(1, Math.floor(opts.maxPages ?? DEFAULT_MAX_PAGES));
  const transport = { token, signal: opts.signal };
  try {
    try {
      let after: string | null = null;
      let seen = 0;
      for (let page = 0; page < maxPages; page += 1) {
        const result = await readPage(repo, userId, after, seen, transport);
        if (result.verdict !== null) return result.verdict;
        after = result.next;
        seen = result.seen;
      }
      return "unknown";
    } catch (error) {
      // A fine-grained token with "Metadata: read" on a private repository
      // may list its stargazers over REST while GraphQL refuses the same
      // question ("Resource not accessible by personal access token").
      if (isGitHubError(error) && error.code === "forbidden") {
        return await findStargazerRest(repo, userId, maxPages, transport);
      }
      throw error;
    }
  } catch (error) {
    const subject = `${repo.owner}/${repo.name}`;
    if (isGitHubError(error)) {
      console.warn(
        `[github] stargazer check unavailable for ${subject}: ${error.code} (${error.message})`,
      );
    } else {
      console.error(`[github] stargazer check failed for ${subject}`, error);
    }
    return "unknown";
  }
}

/** The REST list of stargazers, 100 per page, matched on the numeric id. */
async function findStargazerRest(
  repo: { owner: string; name: string },
  userId: number,
  maxPages: number,
  transport: { token: string; signal?: AbortSignal },
): Promise<StargazerVerdict> {
  const base = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/stargazers?per_page=100`;
  for (let page = 1; page <= maxPages; page += 1) {
    const { status, data, link } = await rest<unknown>(
      `${base}&page=${page}`,
      transport,
    );
    if (status !== 200 || !Array.isArray(data)) return "unknown";
    for (const entry of data) {
      if ((entry as { id?: unknown } | null)?.id === userId) return "starred";
    }
    if (!/rel="next"/.test(link ?? "")) return "not_starred";
  }
  return "unknown";
}
