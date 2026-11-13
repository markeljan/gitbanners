/**
 * The REST requests shared by owner and repository fetchers: account lists
 * with their total size, and weekly commit statistics. REST draws on its own
 * rate-limit bucket, so these never eat into GraphQL points.
 */
import { lastPage, type RequestOptions, rest } from "./client";
import { toCommitActivity } from "./normalize";
import {
  decode,
  type RestAccount,
  RestAccountsSchema,
  RestCommitActivitySchema,
} from "./raw";
import type { CommitActivity } from "./schema";

/** `/repos/{owner}/{name}`, URL-encoded. */
export function repoPath(owner: string, name: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

/** The first page of a REST account list and the size of the whole list. */
export interface AccountList {
  accounts: (RestAccount | null)[];
  /** Number of accounts in the full list, `null` when GitHub did not say. */
  total: number | null;
}

/**
 * Fetches the first `perPage` accounts of a list endpoint (contributors,
 * public members) together with the list's total size.
 *
 * The total needs a second request only when the list has more pages: with
 * `per_page=1` the `Link` header's last page number is the item count. Most
 * lists fit on the first page, so most calls cost one request.
 *
 * @param path Path without a query string.
 * @returns `null` when the endpoint has nothing to list (404, or 204 for an
 *   empty repository).
 */
export async function fetchAccountList(
  path: string,
  perPage: number,
  transport: RequestOptions,
): Promise<AccountList | null> {
  const first = await rest(`${path}?per_page=${perPage}`, transport);
  if (first.data === null) return null;
  const accounts = decode(RestAccountsSchema, first.data, "account list");
  if (!first.link?.includes('rel="next"')) {
    return { accounts, total: accounts.length };
  }
  const total = await rest(`${path}?per_page=1`, transport).then(
    (counted) => lastPage(counted.link),
    // The list itself is fine; only its size stays unknown.
    () => null,
  );
  return { accounts, total };
}

/**
 * Weekly commit activity of a repository (52 weeks, with per-weekday counts).
 *
 * GitHub computes these statistics in the background. A cold repository
 * answers 202 with an empty body, and the result is ready seconds later.
 * We do not wait or retry here: the caller renders without the chart and the
 * next refresh picks the data up.
 *
 * @returns `null` while GitHub is still computing (202) or when the
 *   repository does not exist (404); an empty activity for an empty repository.
 */
export async function fetchCommitActivity(
  owner: string,
  name: string,
  transport: RequestOptions,
): Promise<CommitActivity | null> {
  const response = await rest(
    `${repoPath(owner, name)}/stats/commit_activity`,
    transport,
  );
  if (response.status === 204) return { total: 0, weeks: [] };
  if (response.data === null) return null;
  return toCommitActivity(
    decode(RestCommitActivitySchema, response.data, "commit activity"),
  );
}
