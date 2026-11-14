import "server-only";

import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { permanentRedirect } from "next/navigation";
import { notFoundMetadata } from "@/components/site/not-found-view";
import { SHOWCASE } from "@/content/showcase";
import { showcasePaths } from "@/lib/agent/site-pages";
import { type BannerPreset, targetOf } from "@/lib/banner";
import { getEntity } from "@/lib/github/cached";
import { asGitHubError, type GitHubError } from "@/lib/github/errors";
import { getSample, SAMPLES } from "@/lib/github/samples";
import type { Entity } from "@/lib/github/schema";
import { entityMetadata } from "./metadata";
import {
  decidePage,
  decodeSegments,
  indexedTargets,
  parsePagePath,
  prerenderedParams,
  targetKey,
} from "./resolve";
import { unavailableCopy } from "./unavailable";

export interface LoadedPage {
  entity: Entity;
  preset: BannerPreset;
  /** Canonical, site-relative path. */
  path: string;
  /** In the search index (showcase and samples), or `noindex, follow`. */
  indexed: boolean;
}

/** What an owner or repository address turns into. */
export type PageResult =
  | { type: "page"; page: LoadedPage }
  /** Not a banner page, or no such account, repository or preset. */
  | { type: "not-found" }
  /**
   * GitHub throttles or cannot be reached, and no snapshot exists.
   * `retryPath` is the address as it was asked for.
   */
  | { type: "unavailable"; error: GitHubError; retryPath: string };

const INDEXED = indexedTargets(showcasePaths(), SAMPLES.map(targetOf));

/**
 * Caps the lifetime of the page being rendered at the `minutes` profile
 * (revalidate 60 s, the shortest a static route accepts; see `cached.ts`).
 *
 * A guard, not the mechanism: today a GitHub failure comes out of a
 * `'use cache'` function, and Next records every error thrown in one as an
 * error of the render, even when the page catches it. The render then
 * answers 500 with `Cache-Control: no-store` and is never stored. Should
 * that change, the unavailable view would otherwise be stored like a
 * healthy page.
 */
async function keepBriefly(): Promise<void> {
  "use cache";
  cacheLife("minutes");
}

/**
 * The data of an owner or repository page, or what to show instead.
 *
 * Runs at the top of the page and of `generateMetadata`, before anything is
 * rendered and outside every Suspense boundary: that is what makes a
 * non-canonical spelling a real 308 on the very first request (the routes
 * are `ensureStatic = "navigation"`, so an on-demand render blocks until
 * this has run). Both callers share one cached GitHub request.
 *
 * Nothing but the redirect is thrown. Thrown from here, `notFound()` and
 * GitHub errors replace the whole document with Next's empty error shell
 * (no title, no `lang`, nothing without JavaScript) and a GitHub outage
 * becomes an HTTP 500. Instead:
 *
 * - `not-found`: the page renders `NotFoundResponse`, a 404 with real HTML.
 * - `unavailable`: the page renders `UnavailableView` as ordinary content
 *   inside the layout, kept out of the search index by `loadMetadata`.
 *   The data layer already served any snapshot it had, so there is no
 *   better copy to show. A page cannot choose its status: Next answers
 *   HTTP 500 with `no-store` because the failure came out of a cache
 *   function (see `keepBriefly`), so it is never stored as the page and the
 *   next request asks GitHub again. A 503 with `Retry-After` would need a
 *   route handler in front of the page.
 */
export async function loadPage(params: readonly string[]): Promise<PageResult> {
  const segments = decodeSegments(params);
  const parsed = parsePagePath(segments);
  if (!parsed) return { type: "not-found" };
  let entity: Entity | null;
  try {
    entity = await getEntity(parsed.target);
  } catch (error) {
    const github = asGitHubError(error);
    if (!github) throw error;
    await keepBriefly();
    return {
      type: "unavailable",
      error: github,
      retryPath: `/${params.join("/")}`,
    };
  }
  const decision = decidePage(segments, parsed, entity);
  if (decision.type === "not-found") return { type: "not-found" };
  if (decision.type === "redirect") permanentRedirect(decision.location);
  return {
    type: "page",
    page: {
      entity: decision.entity,
      preset: decision.preset,
      path: decision.path,
      indexed: INDEXED.has(targetKey(targetOf(decision.entity))),
    },
  };
}

// Every showcase page whose data is bundled, and the bare page of every
// sample: enough for a build without a GitHub token. Other pages are
// rendered on their first request.
const PARAMS = prerenderedParams(
  [
    ...SHOWCASE.map((item) => item.path),
    ...SAMPLES.map((entity) =>
      entity.kind === "repo" ? `/${entity.fullName}` : `/${entity.login}`,
    ),
  ],
  (target) => getSample(target) !== null,
);

/** `generateStaticParams` of `/[owner]`. */
export function ownerParams(): { owner: string }[] {
  return PARAMS.owners;
}

/** `generateStaticParams` of `/[owner]/[...rest]`. */
export function restParams(): { owner: string; rest: string[] }[] {
  return PARAMS.rests;
}

/**
 * Metadata of an owner or repository page. Never throws `notFound()` or a
 * GitHub error, for the reason given at {@link loadPage}; only the redirect
 * ends the request.
 */
export async function loadMetadata(
  params: readonly string[],
): Promise<Metadata> {
  const result = await loadPage(params);
  switch (result.type) {
    case "page":
      return entityMetadata(result.page);
    case "not-found":
      return notFoundMetadata;
    case "unavailable":
      return {
        title: unavailableCopy(result.error).title,
        robots: { index: false, follow: false },
      };
  }
}
