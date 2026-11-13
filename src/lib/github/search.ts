/**
 * Typeahead for the "enter a GitHub URL" box: accounts while a login is being
 * typed, repositories once the text contains `owner/`.
 *
 * GraphQL search is used because it is billed to the GraphQL bucket (1 point)
 * instead of the 30-per-minute REST search limit. Prefix matching starts at
 * two characters; a single character only ever matches the exact login.
 *
 * The typed text ends up inside a GitHub search string, so it is reduced to
 * the characters a login or repository name can contain before it gets there:
 * with no space, colon or quote left, it cannot add search qualifiers.
 */
import { graphql } from "./client";
import { LIMITS, toOwnerSuggestion, toRepoSuggestion } from "./normalize";
import { isPresent } from "./present";
import { SEARCH_OWNERS, SEARCH_REPOS } from "./queries";
import { decode, SearchOwnersDataSchema, SearchReposDataSchema } from "./raw";
import type { Suggestion } from "./schema";
import { getServerToken } from "./token";

/** Shortest text that is searched: GitHub does no prefix matching below it. */
export const MIN_SEARCH_LENGTH = 2;
/** Longest login. */
const MAX_LOGIN_LENGTH = 39;
/** Longest `owner/name`: 39 + 1 + 100. */
const MAX_REPO_QUERY_LENGTH = 140;

const LOGIN_PREFIX_RE = /^[a-z\d][a-z\d-]*$/;
const REPO_PREFIX_RE = /^[\w.-]*$/;

/** A typeahead query reduced to what can safely be searched. */
export type SearchQuery =
  | { kind: "owners"; prefix: string }
  | { kind: "repos"; owner: string; prefix: string };

/** Options of {@link searchGitHub}. */
export interface SearchOptions {
  /** A signed-in user's token instead of the server token. */
  token?: string;
  signal?: AbortSignal;
}

/**
 * Parses what a visitor typed: `verc`, `@verc`, `vercel/ne`, or a pasted
 * `https://github.com/vercel/next.js`. Lower-cased, since GitHub matches
 * logins and repository names case-insensitively.
 *
 * @returns `null` when there is nothing valid to search for.
 */
export function parseSearchQuery(input: string): SearchQuery | null {
  const text = input
    .trim()
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//, "")
    .replace(/^@/, "");
  if (text.length < MIN_SEARCH_LENGTH) return null;
  const slash = text.indexOf("/");
  if (slash === -1) {
    if (text.length > MAX_LOGIN_LENGTH || !LOGIN_PREFIX_RE.test(text)) {
      return null;
    }
    return { kind: "owners", prefix: text };
  }
  if (text.length > MAX_REPO_QUERY_LENGTH) return null;
  const owner = text.slice(0, slash);
  // Anything after a second slash (`/tree/main`) is not part of the name.
  const [prefix = ""] = text.slice(slash + 1).split("/");
  if (
    owner.length > MAX_LOGIN_LENGTH ||
    !LOGIN_PREFIX_RE.test(owner) ||
    !REPO_PREFIX_RE.test(prefix)
  ) {
    return null;
  }
  return { kind: "repos", owner, prefix };
}

/**
 * Canonical text of a query, identical for every spelling that searches the
 * same thing (`Verc`, ` @verc`): use it as the cache key.
 */
export function searchQueryKey(query: SearchQuery): string {
  return query.kind === "owners"
    ? query.prefix
    : `${query.owner}/${query.prefix}`;
}

async function searchOwners(
  prefix: string,
  opts: SearchOptions,
): Promise<Suggestion[]> {
  const { data } = await graphql(
    SEARCH_OWNERS,
    // `sort:followers` puts the account people most likely mean first.
    { query: `${prefix} in:login sort:followers` },
    opts,
  );
  return (
    decode(SearchOwnersDataSchema, data, "SearchOwners").search.nodes ?? []
  )
    .filter(isPresent)
    .map(toOwnerSuggestion);
}

async function searchRepos(
  owner: string,
  prefix: string,
  opts: SearchOptions,
): Promise<Suggestion[]> {
  // `is:public` keeps a token's private repositories out; `fork:true`
  // includes forks, which a plain search hides. An empty prefix lists the
  // owner's most-starred repositories.
  const terms = [
    `user:${owner}`,
    prefix,
    "in:name is:public fork:true sort:stars",
  ];
  const { data } = await graphql(
    SEARCH_REPOS,
    { query: terms.filter(Boolean).join(" ") },
    opts,
  );
  return (decode(SearchReposDataSchema, data, "SearchRepos").search.nodes ?? [])
    .filter(isPresent)
    .map(toRepoSuggestion)
    .filter(isPresent);
}

/**
 * Suggestions for the typeahead: users and organizations for a login prefix,
 * repositories of `owner` for `owner/prefix`. At most 6, best match first.
 *
 * @returns `[]` without a network call for text that cannot be searched (too
 *   short, too long, characters no login or repository name contains) and
 *   when no token is available (search has no anonymous fallback).
 * @throws GitHubError when the search request fails.
 */
export async function searchGitHub(
  query: string,
  opts: SearchOptions = {},
): Promise<Suggestion[]> {
  const parsed = parseSearchQuery(query);
  if (!parsed) return [];
  if (!opts.token && !getServerToken()) return [];
  const transport: SearchOptions = { token: opts.token, signal: opts.signal };
  const suggestions =
    parsed.kind === "owners"
      ? await searchOwners(parsed.prefix, transport)
      : await searchRepos(parsed.owner, parsed.prefix, transport);
  return suggestions.slice(0, LIMITS.suggestions);
}
