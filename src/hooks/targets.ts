/**
 * Small, pure helpers around banner targets shared by the data hooks and the
 * target input. No React in here.
 */
import type { BannerTarget } from "@/lib/banner";
import { targetSlug } from "@/lib/embed";
import { SAMPLES } from "@/lib/github/samples";

/** Cache identity of a target: its slug in lower case, like GitHub compares. */
export function targetKey(target: BannerTarget): string {
  return targetSlug(target).toLowerCase();
}

export function sameTarget(
  a: BannerTarget | null,
  b: BannerTarget | null,
): boolean {
  if (a === null || b === null) return a === b;
  return targetKey(a) === targetKey(b);
}

/**
 * JSON endpoint of a target. `preview` asks for the one-request version of an
 * owner (profile and contribution calendar); repositories have no preview.
 */
export function entityUrl(
  target: BannerTarget,
  view: "preview" | "full" = "full",
): string {
  if (target.kind === "repo") {
    const owner = encodeURIComponent(target.owner.toLowerCase());
    const name = encodeURIComponent(target.name.toLowerCase());
    return `/api/v1/repos/${owner}/${name}`;
  }
  const login = encodeURIComponent(target.login.toLowerCase());
  return `/api/v1/owners/${login}${view === "preview" ? "?view=preview" : ""}`;
}

/**
 * Slugs known to exist on GitHub: the bundled samples, everything a search
 * returned and every entity that loaded. The target input uses it to show a
 * banner the instant the typed text matches one, instead of waiting for the
 * visitor to stop typing.
 */
export interface KnownTargets {
  add(slug: string): void;
  has(slug: string): boolean;
}

export function createKnownTargets(seed: Iterable<string> = []): KnownTargets {
  const slugs = new Set<string>();
  const known: KnownTargets = {
    add(slug) {
      if (slug) slugs.add(slug.toLowerCase());
    },
    has(slug) {
      return slugs.has(slug.toLowerCase());
    },
  };
  for (const slug of seed) known.add(slug);
  return known;
}

/** The page-wide registry. Lives for the lifetime of the tab. */
export const knownTargets = createKnownTargets(
  SAMPLES.map((entity) =>
    entity.kind === "repo" ? entity.fullName : entity.login,
  ),
);
