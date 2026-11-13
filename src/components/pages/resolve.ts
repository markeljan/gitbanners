/**
 * Which page a banner URL is, decided from the path and the GitHub data.
 *
 * Pure and isomorphic: the route files under `src/app/[owner]` add the data
 * access and turn the decision into `notFound()` or `permanentRedirect()`.
 * Everything that decides a status code lives here, so it is unit tested.
 *
 * The grammar is the image grammar (`parseBannerPath`):
 *
 *   /{owner}                    /{owner}/{preset}
 *   /{owner}/{repo}             /{owner}/{repo}/{preset}
 *
 * with `@owner` for logins that collide with one of the app's routes.
 */
import {
  type BannerPreset,
  type BannerTarget,
  bannerPath,
  defaultPresetId,
  getPreset,
  type ParsedBannerPath,
  parseBannerPath,
  presetsFor,
  targetOf,
} from "@/lib/banner";
import type { Entity } from "@/lib/github/schema";

/**
 * Reads the path segments of a page request. `null` for anything that can
 * never be a banner page: a malformed login or repository name, a reserved
 * first segment without "@", too many segments, or an image suffix (images
 * are answered by the image route; a suffix that reaches a page is junk such
 * as `/vercel.SVG`).
 */
export function parsePagePath(
  segments: readonly string[],
): ParsedBannerPath | null {
  const parsed = parseBannerPath(segments);
  if (!parsed || parsed.format !== null) return null;
  return parsed;
}

export type PageDecision =
  /** No such account or repository, or no such preset for its kind. */
  | { type: "not-found" }
  /**
   * The canonical URL differs from the one asked for: a capitalised owner,
   * a repository in other capitalisation or renamed, the default preset
   * written out, a needless "@". One permanent redirect, never a chain:
   * `location` is a fixed point of this function.
   */
  | { type: "redirect"; location: string }
  | {
      type: "page";
      entity: Entity;
      /** The preset shown: the one in the path, or the kind's default. */
      preset: BannerPreset;
      /** Canonical, site-relative path of the page. */
      path: string;
    };

/** The path as it was asked for, from the (URL-decoded) route params. */
export function requestedPath(segments: readonly string[]): string {
  return `/${segments.join("/")}`;
}

/** Whether a preset id names one of the kind's presets. `null` is the default. */
export function presetExistsFor(
  kind: Entity["kind"],
  preset: string | null,
): boolean {
  return preset === null || presetsFor(kind).some((p) => p.id === preset);
}

/** Canonical path of the page of an entity and preset (`null`: the default). */
export function canonicalPagePath(
  entity: Entity,
  preset: string | null,
): string {
  return bannerPath(targetOf(entity), {
    preset: preset ?? defaultPresetId(entity.kind),
  });
}

/**
 * Decides what a request answers.
 *
 * @param segments The route params as Next hands them over (URL-decoded).
 * @param parsed `parsePagePath(segments)`, already checked to be non-null.
 * @param entity What GitHub answered for `parsed.target`; `null` = unknown.
 */
export function decidePage(
  segments: readonly string[],
  parsed: ParsedBannerPath,
  entity: Entity | null,
): PageDecision {
  if (!entity) return { type: "not-found" };
  // An owner path yields an owner, a repository path a repository; anything
  // else is a data layer surprise, and a surprise is not a page.
  const isRepo = entity.kind === "repo";
  if (isRepo !== (parsed.target.kind === "repo")) return { type: "not-found" };
  // `/vercel/streak`: organizations have no streak. Not a page, and not a
  // redirect either: the address names a banner that does not exist.
  if (!presetExistsFor(entity.kind, parsed.preset)) {
    return { type: "not-found" };
  }
  const preset = getPreset(entity.kind, parsed.preset);
  const path = canonicalPagePath(entity, preset.id);
  if (requestedPath(segments) !== path) {
    return { type: "redirect", location: path };
  }
  return { type: "page", entity, preset, path };
}

/** "vercel" or "vercel/next.js", lower-case: how targets are compared. */
export function targetKey(target: BannerTarget): string {
  return (
    target.kind === "repo" ? `${target.owner}/${target.name}` : target.login
  ).toLowerCase();
}

/**
 * Targets whose pages belong in a search index: the showcase and the
 * bundled samples. Every other page is rendered on demand for whoever asks,
 * and is `noindex, follow`: thousands of near-identical generated pages are
 * a quality risk, see the SEO notes in the agent-readiness research.
 */
export function indexedTargets(
  paths: readonly string[],
  extra: readonly BannerTarget[] = [],
): ReadonlySet<string> {
  const keys = new Set<string>(extra.map(targetKey));
  for (const path of paths) {
    const [pathname = ""] = path.split("?");
    const parsed = parseBannerPath(pathname.split("/").filter(Boolean));
    if (parsed) keys.add(targetKey(parsed.target));
  }
  return keys;
}

/**
 * Route params of the pages prerendered at build time: the showcase pages
 * whose data is bundled (`hasSample`), so a build without a GitHub token
 * still renders every one of them. Split by route file: one segment for
 * `/[owner]`, more for `/[owner]/[...rest]`.
 */
export function prerenderedParams(
  paths: readonly string[],
  hasSample: (target: BannerTarget) => boolean,
): { owners: { owner: string }[]; rests: { owner: string; rest: string[] }[] } {
  const seen = new Set<string>();
  const owners: { owner: string }[] = [];
  const rests: { owner: string; rest: string[] }[] = [];
  for (const path of paths) {
    const [pathname = ""] = path.split("?");
    const parsed = parseBannerPath(pathname.split("/").filter(Boolean));
    if (!parsed || !hasSample(parsed.target)) continue;
    const canonical = bannerPath(parsed.target, { preset: parsed.preset });
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const [owner = "", ...rest] = canonical.split("/").filter(Boolean);
    if (rest.length === 0) owners.push({ owner });
    else rests.push({ owner, rest });
  }
  return { owners, rests };
}
