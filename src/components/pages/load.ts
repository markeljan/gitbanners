import "server-only";

import { notFound, permanentRedirect } from "next/navigation";
import { SHOWCASE } from "@/content/showcase";
import { showcasePaths } from "@/lib/agent/site-pages";
import { type BannerPreset, targetOf } from "@/lib/banner";
import { getEntity } from "@/lib/github/cached";
import { getSample, SAMPLES } from "@/lib/github/samples";
import type { Entity } from "@/lib/github/schema";
import {
  decidePage,
  indexedTargets,
  parsePagePath,
  prerenderedParams,
  targetKey,
} from "./resolve";

export interface LoadedPage {
  entity: Entity;
  preset: BannerPreset;
  /** Canonical, site-relative path. */
  path: string;
  /** In the search index (showcase and samples), or `noindex, follow`. */
  indexed: boolean;
}

const INDEXED = indexedTargets(showcasePaths(), SAMPLES.map(targetOf));

/**
 * The data of an owner or repository page, or the end of the request.
 *
 * Runs at the top of the page and of `generateMetadata`, before anything is
 * rendered and outside every Suspense boundary: that is what makes an
 * unknown name a real 404 and a non-canonical spelling a real 308 on the
 * very first request (the routes are `ensureStatic = "navigation"`, so an
 * on-demand render blocks until this has run). Both callers share one
 * cached GitHub request.
 *
 * GitHub errors are not caught: they reach `src/app/[owner]/error.tsx`,
 * and an error is never stored as a page.
 */
export async function loadPage(
  segments: readonly string[],
): Promise<LoadedPage> {
  const parsed = parsePagePath(segments);
  if (!parsed) notFound();
  const entity = await getEntity(parsed.target);
  const decision = decidePage(segments, parsed, entity);
  if (decision.type === "not-found") notFound();
  if (decision.type === "redirect") permanentRedirect(decision.location);
  return {
    entity: decision.entity,
    preset: decision.preset,
    path: decision.path,
    indexed: INDEXED.has(targetKey(targetOf(decision.entity))),
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
