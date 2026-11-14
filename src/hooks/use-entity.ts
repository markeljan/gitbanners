"use client";

import { useEffect, useRef, useState } from "react";
import useSWR, { preload, type SWRConfiguration, useSWRConfig } from "swr";
import type { BannerTarget } from "@/lib/banner";
import { getSample } from "@/lib/github/samples";
import { type Entity, EntitySchema } from "@/lib/github/schema";
import { type ApiFailure, ApiProblem, failureOf, fetchJson } from "./api";
import { entityUrl, knownTargets, targetKey } from "./targets";

/**
 * GitHub data for the banner preview, tuned for typing speed.
 *
 * The plan, in the order a visitor feels it:
 * 1. A bundled sample answers in the same frame for its target.
 * 2. Anything fetched in this tab is in SWR's memory cache and answers in the
 *    same frame too; requests for one target are de-duplicated for a minute.
 * 3. An owner is asked for twice: `?view=preview` (one upstream request:
 *    profile and contribution calendar) draws the first banner, the full
 *    entity replaces it when it arrives. Both go out together for a name
 *    known to exist; an unknown name gets the preview first.
 * 4. Whatever was on screen stays on screen until the next answer is ready.
 * 5. A request for a target the visitor has typed past is aborted.
 */

/** How complete the entity on screen is. */
export type EntityStage = "sample" | "preview" | "full";

export type EntityFailure = Exclude<ApiFailure, "aborted">;

/** One request as the resolver sees it. */
export interface EntityRequest {
  data?: Entity;
  error?: unknown;
  /** A request is in flight. */
  isValidating: boolean;
}

export interface ResolvedEntity {
  /** The best answer for the target so far, `null` when there is none. */
  entity: Entity | null;
  stage: EntityStage | null;
  /** Nothing of the target can be shown yet and a request is in flight. */
  isLoading: boolean;
  /** Something of the target is shown and a better answer is on its way. */
  isUpgrading: boolean;
  /** Why the target cannot be shown. Always `null` while `entity` is set. */
  failure: EntityFailure | null;
}

const IDLE: EntityRequest = { isValidating: false };

function failureOrNull(error: unknown): EntityFailure | null {
  if (error === undefined || error === null) return null;
  const failure = failureOf(error);
  // An aborted request says nothing about the target: it is asked again.
  return failure === "aborted" ? null : failure;
}

/**
 * Combines the bundled sample, the fast preview and the full answer into what
 * to draw and what to say. Pure, so every branch is unit tested.
 *
 * Something to show always wins over an error: if the full request fails
 * after the preview arrived, the preview stays without a message. "Not
 * found" from either request is final, even while the other is in flight.
 */
export function resolveEntity(sources: {
  sample: Entity | null;
  preview?: EntityRequest;
  full?: EntityRequest;
}): ResolvedEntity {
  const preview = sources.preview ?? IDLE;
  const full = sources.full ?? IDLE;
  const pending = preview.isValidating || full.isValidating;

  if (full.data) {
    return {
      entity: full.data,
      stage: "full",
      isLoading: false,
      isUpgrading: false,
      failure: null,
    };
  }
  const partial = preview.data ?? sources.sample;
  if (partial) {
    return {
      entity: partial,
      stage: preview.data ? "preview" : "sample",
      isLoading: false,
      isUpgrading: pending,
      failure: null,
    };
  }

  const failures = [failureOrNull(full.error), failureOrNull(preview.error)];
  if (failures.includes("not_found")) {
    return {
      entity: null,
      stage: null,
      isLoading: false,
      isUpgrading: false,
      failure: "not_found",
    };
  }
  if (pending) {
    return {
      entity: null,
      stage: null,
      isLoading: true,
      isUpgrading: false,
      failure: null,
    };
  }
  return {
    entity: null,
    stage: null,
    isLoading: false,
    isUpgrading: false,
    failure: failures.find((failure) => failure !== null) ?? null,
  };
}

/** Delay before retry number `retryCount` (1-based), or `null` to give up. */
export function retryDelay(error: unknown, retryCount: number): number | null {
  const failure = failureOf(error);
  // These are answers, not hiccups: asking again changes nothing.
  if (failure === "not_found" || failure === "invalid") return null;
  if (failure === "aborted" || retryCount > 2) return null;
  const asked = error instanceof ApiProblem ? error.retryAfter : null;
  // A long server-side wait is the visitor's call, not a background loop's.
  if (asked !== null) return asked <= 15 ? Math.max(1, asked) * 1000 : null;
  return 1500 * 2 ** (retryCount - 1);
}

/** How long an answer counts as fresh: no second request within it. */
const FRESH_MS = 60_000;

const controllers = new Map<string, AbortController>();
/** When each URL last answered (or failed), for `prefetchEntity`. */
const answeredAt = new Map<string, number>();

async function fetchEntity(url: string): Promise<Entity> {
  const controller = new AbortController();
  controllers.set(url, controller);
  try {
    const body = await fetchJson(url, { signal: controller.signal });
    const parsed = EntitySchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiProblem(
        502,
        "unreadable",
        "The API answered with an unexpected shape.",
      );
    }
    answeredAt.set(url, Date.now());
    return parsed.data;
  } catch (error) {
    // A failure is an answer too: nothing fetches ahead into an outage or
    // asks twice about a name that does not exist. (The hook's own retry and
    // the visitor's "Try again" do not go through `prefetchEntity`.)
    if (failureOf(error) !== "aborted") answeredAt.set(url, Date.now());
    throw error;
  } finally {
    if (controllers.get(url) === controller) controllers.delete(url);
  }
}

/**
 * True when asking for `url` now would repeat a request that is in flight
 * or was answered a moment ago. SWR de-duplicates its own revalidations but
 * not a `preload()` made after the hook already took the answer.
 */
export function isFresh(
  url: string,
  now: number,
  state: {
    inFlight: { has(url: string): boolean };
    answeredAt: { get(url: string): number | undefined };
  },
): boolean {
  if (state.inFlight.has(url)) return true;
  const at = state.answeredAt.get(url);
  return at !== undefined && now - at < FRESH_MS;
}

const SWR_OPTIONS: SWRConfiguration<Entity, unknown> = {
  // Typing back and forth between two names must not ask twice.
  dedupingInterval: FRESH_MS,
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  onErrorRetry(error, _key, _config, revalidate, { retryCount }) {
    const delay = retryDelay(error, retryCount);
    if (delay !== null) setTimeout(() => revalidate({ retryCount }), delay);
  },
};

/**
 * Warms the cache for a target the visitor is likely to want next (the
 * highlighted suggestion, the name just typed). Owners get the one-request
 * preview, which is enough for a first banner the moment they are chosen.
 * Nothing is shown and nothing is reported: `useEntity` picks the answer up
 * if the target is asked for.
 */
export function prefetchEntity(target: BannerTarget): void {
  const url = entityUrl(target, target.kind === "owner" ? "preview" : "full");
  const state = { inFlight: controllers, answeredAt };
  if (isFresh(url, Date.now(), state)) return;
  // A full entity that just arrived makes the preview pointless.
  if (isFresh(entityUrl(target, "full"), Date.now(), state)) return;
  // The promise is consumed by the hook later; until then a failure here is
  // nobody's business.
  preload(url, fetchEntity).catch(() => {});
}

export interface UseEntityOptions {
  /**
   * `false` answers from the bundled sample only and makes no request. The
   * homepage uses it for its first paint, which must cost nothing.
   * @default true
   */
  live?: boolean;
}

export interface EntityState {
  /**
   * The entity to draw. While another target loads (or failed) this is
   * still the last one that loaded, so the banner never disappears. `null`
   * only until the very first answer.
   */
  entity: Entity | null;
  /** True when `entity` belongs to the requested target. */
  isCurrent: boolean;
  /** Completeness of the requested target's data, `null` when none is shown. */
  stage: EntityStage | null;
  /** The requested target has nothing to show yet and a request is in flight. */
  isLoading: boolean;
  /** The requested target is on screen and a fuller answer is on its way. */
  isUpgrading: boolean;
  /**
   * Why the requested target is not on screen: `not_found` (say so),
   * `rate_limited` / `unavailable` (GitHub is slow, the last banner stays) or
   * `invalid`.
   */
  failure: EntityFailure | null;
  /** Ask again after a failure. */
  retry: () => void;
}

/**
 * A keyed request with neither data nor a real error is about to start: SWR
 * only reports `isValidating` from its effect, one render after the key
 * changed, and that render must not look like "nothing is happening".
 */
function request(
  url: string | null,
  swr: { data?: Entity; error?: unknown; isValidating: boolean },
): EntityRequest {
  const unanswered =
    url !== null && swr.data === undefined && failureOrNull(swr.error) === null;
  return {
    data: swr.data,
    error: swr.error,
    isValidating: swr.isValidating || unanswered,
  };
}

/**
 * The entity behind a banner target, as fast as it can be had.
 *
 * @param target What to show, or `null` to keep whatever is on screen.
 */
export function useEntity(
  target: BannerTarget | null,
  options: UseEntityOptions = {},
): EntityState {
  const live = options.live ?? true;
  const key = target ? targetKey(target) : null;
  const sample = target ? getSample(target) : null;

  // Owners are asked for twice: the one-request preview draws the first
  // banner and the full entity replaces it. A name that is not known to
  // exist gets the preview alone first, so a typo costs GitHub one request,
  // not two; a full entity already in memory needs no preview at all.
  const { cache } = useSWRConfig();
  const fullCandidate = target && live ? entityUrl(target, "full") : null;
  const isFullCached =
    fullCandidate !== null && cache.get(fullCandidate)?.data !== undefined;
  const previewUrl =
    target && live && target.kind === "owner" && !isFullCached
      ? entityUrl(target, "preview")
      : null;
  const preview = useSWR(previewUrl, fetchEntity, SWR_OPTIONS);
  const isWorthAsking =
    target?.kind === "repo" ||
    isFullCached ||
    preview.data !== undefined ||
    (key !== null && knownTargets.has(key));
  const fullUrl = isWorthAsking ? fullCandidate : null;
  const full = useSWR(fullUrl, fetchEntity, SWR_OPTIONS);

  // Abort what the visitor typed past. Done when the URLs change, not in a
  // cleanup: Strict Mode runs cleanups on mount and would cancel live requests.
  const watched = useRef<string[]>([]);
  useEffect(() => {
    const current = [previewUrl, fullUrl].filter((url) => url !== null);
    for (const url of watched.current) {
      if (!current.includes(url)) controllers.get(url)?.abort();
    }
    watched.current = current;
  }, [previewUrl, fullUrl]);

  const resolved = resolveEntity({
    sample,
    preview: request(previewUrl, preview),
    full: request(fullUrl, full),
  });

  // The last entity that could be drawn, kept across target changes. Updated
  // during render (not in an effect) so a cached answer shows in this frame.
  const [shown, setShown] = useState<{ entity: Entity; key: string } | null>(
    resolved.entity && key ? { entity: resolved.entity, key } : null,
  );
  if (resolved.entity && key && shown?.entity !== resolved.entity) {
    setShown({ entity: resolved.entity, key });
    // Shown on purpose once, known for good: typing this name again brings
    // it back without waiting for the search. (A lookup made ahead of time
    // does not count: it must not put a half-typed name on screen.)
    knownTargets.add(key);
  }
  const visible =
    resolved.entity && key ? { entity: resolved.entity, key } : shown;

  return {
    entity: visible?.entity ?? null,
    isCurrent: visible !== null && visible.key === key,
    stage: resolved.stage,
    isLoading: resolved.isLoading,
    isUpgrading: resolved.isUpgrading,
    failure: resolved.failure,
    retry: () => {
      void full.mutate();
      void preview.mutate();
    },
  };
}
