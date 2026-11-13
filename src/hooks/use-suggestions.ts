"use client";

import { useEffect, useRef } from "react";
import useSWR from "swr";
import { z } from "zod";
import { OwnerSuggestionSchema, type Suggestion } from "@/lib/github/schema";
import { type ApiFailure, ApiProblem, failureOf, fetchJson } from "./api";
import { knownTargets } from "./targets";
import { useDebouncedValue } from "./use-debounced-value";

/**
 * Typeahead suggestions for the target input, from `GET /api/v1/search`.
 *
 * Keystrokes are debounced by about 80 ms, a request the visitor typed past
 * is aborted, answers stay in memory for five minutes, and while the next
 * answer is on its way the previous list is narrowed locally to what still
 * matches, so the list never goes blank and never shows a stale mismatch.
 */

/** Shortest text the API searches for (GitHub does no prefix match below it). */
export const MIN_SEARCH_LENGTH = 2;
export const SEARCH_DEBOUNCE_MS = 80;

const LOGIN_PREFIX_RE = /^[a-z\d][a-z\d-]{0,38}$/;
const REPO_PREFIX_RE = /^[\w.-]{0,100}$/;

/**
 * What a visitor typed, reduced to the query the API accepts: lower case,
 * without `@` or a pasted `https://github.com/`, and nothing after the
 * repository name. `null` when there is nothing valid to search for. The
 * rules mirror `parseSearchQuery` in the server's data layer.
 */
export function normalizeSearchText(text: string): string | null {
  const value = text
    .trim()
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//, "")
    .replace(/^@/, "");
  if (value.length < MIN_SEARCH_LENGTH) return null;
  const slash = value.indexOf("/");
  if (slash === -1) return LOGIN_PREFIX_RE.test(value) ? value : null;
  const owner = value.slice(0, slash);
  const [prefix = ""] = value.slice(slash + 1).split("/");
  if (!LOGIN_PREFIX_RE.test(owner) || !REPO_PREFIX_RE.test(prefix)) return null;
  return `${owner}/${prefix}`;
}

export function searchUrl(query: string): string {
  return `/api/v1/search?q=${encodeURIComponent(query)}`;
}

/**
 * True when a suggestion fetched for an earlier query can still be offered
 * for `query` (both normalized): accounts whose login contains the typed
 * text, repositories of the typed owner whose name contains the typed part.
 */
export function matchesQuery(suggestion: Suggestion, query: string): boolean {
  const slug = suggestion.slug.toLowerCase();
  const slash = query.indexOf("/");
  if (slash === -1) {
    return suggestion.kind !== "repo" && slug.includes(query);
  }
  if (suggestion.kind !== "repo") return false;
  const owner = query.slice(0, slash + 1);
  return (
    slug.startsWith(owner) &&
    slug.slice(owner.length).includes(query.slice(slash + 1))
  );
}

const SearchResultSchema = z.object({
  query: z.string(),
  suggestions: z.array(OwnerSuggestionSchema),
});
type SearchResult = z.infer<typeof SearchResultSchema>;

const controllers = new Map<string, AbortController>();
/** After a 429 the API is left alone until its `Retry-After` has passed. */
let blocked: { until: number; problem: ApiProblem } | null = null;

async function fetchSuggestions(url: string): Promise<SearchResult> {
  if (blocked && Date.now() < blocked.until) throw blocked.problem;
  const controller = new AbortController();
  controllers.set(url, controller);
  try {
    const body = await fetchJson(url, { signal: controller.signal });
    const result = SearchResultSchema.parse(body);
    for (const suggestion of result.suggestions) {
      knownTargets.add(suggestion.slug);
    }
    return result;
  } catch (error) {
    if (error instanceof ApiProblem && error.status === 429) {
      const seconds = Math.min(error.retryAfter ?? 10, 60);
      blocked = { until: Date.now() + seconds * 1000, problem: error };
    }
    throw error;
  } finally {
    if (controllers.get(url) === controller) controllers.delete(url);
  }
}

export interface SuggestionsState {
  /** Suggestions to show for the text, best first. Empty when there are none. */
  suggestions: readonly Suggestion[];
  /** The list is not (yet) the API's answer for this exact text. */
  isLoading: boolean;
  /** The search itself failed (rate limited or GitHub unreachable). */
  failure: Exclude<ApiFailure, "aborted"> | null;
}

const NONE: readonly Suggestion[] = [];

/**
 * Suggestions for what is typed in the target input.
 *
 * @param text Raw field text. Less than two valid characters gives no list.
 */
export function useSuggestions(
  text: string,
  options: { debounceMs?: number } = {},
): SuggestionsState {
  const query = normalizeSearchText(text);
  const settled = useDebouncedValue(
    query,
    options.debounceMs ?? SEARCH_DEBOUNCE_MS,
  );
  // An answer that is already in memory skips the debounce entirely.
  const cached = useSWR<SearchResult>(query ? searchUrl(query) : null, null);
  // Clearing the field must not wait for the debounce to notice.
  const fetchUrl = query && settled ? searchUrl(settled) : null;
  const fetched = useSWR(fetchUrl, fetchSuggestions, {
    keepPreviousData: true,
    dedupingInterval: 300_000,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    shouldRetryOnError: false,
  });

  const watched = useRef<string | null>(null);
  useEffect(() => {
    if (watched.current && watched.current !== fetchUrl) {
      controllers.get(watched.current)?.abort();
    }
    watched.current = fetchUrl;
  }, [fetchUrl]);

  if (query === null) {
    return { suggestions: NONE, isLoading: false, failure: null };
  }
  const source = cached.data ?? fetched.data;
  const isExact = source?.query === query;
  const failure =
    !isExact && settled === query && fetched.error !== undefined
      ? failureOf(fetched.error)
      : null;
  return {
    suggestions: !source
      ? NONE
      : isExact
        ? source.suggestions
        : source.suggestions.filter((item) => matchesQuery(item, query)),
    isLoading: !isExact && (failure === null || failure === "aborted"),
    failure: failure === "aborted" ? null : failure,
  };
}
