"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import useSWR from "swr";
import { z } from "zod";
import { OwnerSuggestionSchema, type Suggestion } from "@/lib/github/schema";
import { type ApiFailure, ApiProblem, failureOf, fetchJson } from "./api";
import { knownTargets } from "./targets";
import { useDebouncedValue } from "./use-debounced-value";

/**
 * Typeahead suggestions for the target input, from `GET /api/v1/search`.
 *
 * Keystrokes are debounced by about 80 ms and answers stay in memory. While
 * the answer for the exact text is on its way, the newest answer for a
 * shorter prefix of it is narrowed locally to what still matches: the list
 * never goes blank, never shows a stale mismatch, and a name is usually
 * already on screen (and known to exist) by the time it is fully typed.
 *
 * A request is aborted when the visitor changes direction (deletes, or
 * types something else). Typing forward keeps it: its answer is exactly
 * that prefix list.
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

/**
 * True when an answer for `earlier` is still worth having while `query` is
 * on screen: typing forward within the same kind of search. A login prefix
 * says nothing about `owner/…` repositories, so crossing the slash does not
 * count.
 */
export function extendsQuery(query: string, earlier: string): boolean {
  return (
    query.startsWith(earlier) && query.includes("/") === earlier.includes("/")
  );
}

export interface SearchAnswer {
  query: string;
  suggestions: readonly Suggestion[];
}

/** Answers kept for prefix reuse. Typing produces a handful per name. */
const MAX_ANSWERS = 120;

/**
 * Every answer received in this tab, by query. Separate from SWR's cache
 * because the question asked of it is different: not "the answer for this
 * key" but "the best answer for any prefix of this text".
 */
export function createAnswerStore(limit = MAX_ANSWERS) {
  const answers = new Map<string, SearchAnswer>();
  const listeners = new Set<() => void>();
  let version = 0;
  return {
    add(answer: SearchAnswer): void {
      answers.delete(answer.query);
      answers.set(answer.query, answer);
      if (answers.size > limit) {
        const oldest = answers.keys().next().value;
        if (oldest !== undefined) answers.delete(oldest);
      }
      version += 1;
      for (const listener of listeners) listener();
    },
    /** The exact answer for `query`, else the one for its longest answered prefix. */
    best(query: string): SearchAnswer | null {
      const exact = answers.get(query);
      if (exact) return exact;
      let best: SearchAnswer | null = null;
      for (const answer of answers.values()) {
        if (
          extendsQuery(query, answer.query) &&
          (best === null || answer.query.length > best.query.length)
        ) {
          best = answer;
        }
      }
      return best;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => version,
  };
}

const store = createAnswerStore();

const SearchResultSchema = z.object({
  query: z.string(),
  suggestions: z.array(OwnerSuggestionSchema),
});

const controllers = new Map<string, AbortController>();
/** After a 429 the API is left alone until its `Retry-After` has passed. */
let blocked: { until: number; problem: ApiProblem } | null = null;

async function fetchSuggestions(url: string): Promise<SearchAnswer> {
  if (blocked && Date.now() < blocked.until) throw blocked.problem;
  const controller = new AbortController();
  controllers.set(url, controller);
  try {
    const body = await fetchJson(url, { signal: controller.signal });
    const result = SearchResultSchema.parse(body);
    for (const suggestion of result.suggestions) {
      knownTargets.add(suggestion.slug);
    }
    store.add(result);
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
const serverVersion = () => 0;

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
  // Re-render when any answer arrives: it may be a prefix of this text.
  useSyncExternalStore(store.subscribe, store.version, serverVersion);
  // Clearing the field must not wait for the debounce to notice.
  const fetchUrl = query && settled ? searchUrl(settled) : null;
  const fetched = useSWR(fetchUrl, fetchSuggestions, {
    dedupingInterval: 300_000,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    shouldRetryOnError: false,
  });

  // Abort what can no longer help. Done when the query changes, not in a
  // cleanup: Strict Mode runs cleanups on mount.
  const watched = useRef<string | null>(null);
  useEffect(() => {
    const previous = watched.current;
    watched.current = settled;
    if (previous && previous !== settled) {
      if (!settled || !extendsQuery(settled, previous)) {
        controllers.get(searchUrl(previous))?.abort();
      }
    }
  }, [settled]);

  if (query === null) {
    return { suggestions: NONE, isLoading: false, failure: null };
  }
  const answer = store.best(query);
  const isExact = answer?.query === query;
  const failure =
    !isExact && settled === query && fetched.error !== undefined
      ? failureOf(fetched.error)
      : null;
  return {
    suggestions: !answer
      ? NONE
      : isExact
        ? answer.suggestions
        : answer.suggestions.filter((item) => matchesQuery(item, query)),
    isLoading: !isExact && (failure === null || failure === "aborted"),
    failure: failure === "aborted" ? null : failure,
  };
}
