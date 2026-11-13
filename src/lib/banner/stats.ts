"use no memo";

import { formatCount, relativeDay } from "@/lib/banner/format";
import { getPreset, presetDefaults } from "@/lib/banner/presets";
import type { BannerOptions, StatId } from "@/lib/banner/types";
import type { Entity } from "@/lib/github/schema";

/** One headline number, ready to draw. */
export interface Tile {
  id: StatId;
  /** Sentence-case label under the number. */
  label: string;
  /** The number as printed: compact count, a tag name, or "–" while it loads. */
  value: string;
  /**
   * How the number got here, oldest value first: drawn as a small trend line
   * beside it where there is room. Only stars have one.
   */
  trend?: readonly number[];
}

/** Shown in place of a number that has not arrived yet (U+2013). */
export const PENDING = "–";

const LABELS: Record<StatId, string> = {
  contributions: "Contributions",
  commits: "Commits",
  pullRequests: "Pull requests",
  issues: "Issues",
  reviews: "Reviews",
  contributedTo: "Contributed to",
  followers: "Followers",
  streak: "Day streak",
  stars: "Stars",
  repositories: "Repositories",
  forks: "Forks",
  members: "Members",
  watchers: "Watchers",
  openIssues: "Open issues",
  openPullRequests: "Open pull requests",
  contributors: "Contributors",
  totalCommits: "Commits",
  release: "Latest release",
};

/**
 * `undefined`: this kind of entity has no such number (the tile is skipped).
 * `null`: it has one, but GitHub did not give it to us (hidden rosters, slow
 * queries still running).
 */
type Reading = number | string | null | undefined;

function read(entity: Entity, id: StatId): Reading {
  switch (entity.kind) {
    case "user":
      switch (id) {
        case "contributions":
          return entity.stats.contributions;
        case "commits":
          return entity.stats.commits;
        case "pullRequests":
          return entity.stats.pullRequests;
        case "issues":
          return entity.stats.issues;
        case "reviews":
          return entity.stats.reviews;
        case "contributedTo":
          return entity.stats.contributedTo;
        case "followers":
          return entity.followers;
        case "streak":
          return entity.streak.current;
        case "stars":
          return entity.stats.stars;
        case "repositories":
          return entity.stats.repositories;
        default:
          return undefined;
      }
    case "org":
      switch (id) {
        case "repositories":
          return entity.stats.repositories;
        case "stars":
          return entity.stats.stars;
        case "forks":
          return entity.stats.forks;
        case "members":
          // Only public members are visible from outside. A roster of none is
          // a hidden roster, not an empty organization: never print "0".
          return entity.stats.members || null;
        case "followers":
          return entity.stats.followers;
        default:
          return undefined;
      }
    case "repo":
      switch (id) {
        case "stars":
          return entity.stars;
        case "forks":
          return entity.forks;
        case "watchers":
          return entity.watchers;
        case "openIssues":
          return entity.openIssues;
        case "openPullRequests":
          return entity.openPullRequests;
        case "contributors":
          return entity.contributorCount;
        case "totalCommits":
          return entity.commits;
        case "release":
          return entity.latestRelease?.tag ?? null;
        default:
          return undefined;
      }
  }
}

/**
 * True when the banner's stat row holds the tile `id`. Other sections use it
 * to leave out what a tile already says (the release tag in a repository's
 * meta line, for one).
 */
export function showsStat(
  entity: Entity,
  options: Pick<BannerOptions, "preset" | "stats" | "sections">,
  id: StatId,
): boolean {
  const sections =
    options.sections ?? getPreset(entity.kind, options.preset).sections;
  return sections.includes("stats") && statIds(entity, options).includes(id);
}

/**
 * The stat ids a banner shows: the caller's list, else the preset's, else the
 * kind's default preset's (a preset without a stat row has an empty list, but
 * `show=stats` on it must still show something).
 */
export function statIds(
  entity: Entity,
  options: Pick<BannerOptions, "preset" | "stats">,
): readonly StatId[] {
  if (options.stats?.length) return options.stats;
  const own = presetDefaults(entity.kind, options.preset)?.stats;
  if (own?.length) return own;
  const fallback = getPreset(entity.kind, null).id;
  return presetDefaults(entity.kind, fallback)?.stats ?? [];
}

/** Fewest points that make a trend: with less there is no line to draw. */
const MIN_TREND_POINTS = 3;

/** Cumulative stars week by week, when GitHub's history for the repository is known. */
function starTrend(entity: Entity): number[] | null {
  if (entity.kind !== "repo" || !Array.isArray(entity.starHistory)) return null;
  const stars = entity.starHistory
    .map((point) => point?.stars)
    .filter((value): value is number => Number.isFinite(value));
  return stars.length >= MIN_TREND_POINTS ? stars : null;
}

/**
 * The label of a tile. A release says when it came out ("Released 3 weeks
 * ago"), which is what people look for next to a version; without a date, or
 * without a clock to compare it with, it is simply the latest one.
 */
function labelOf(entity: Entity, id: StatId, now: Date | undefined): string {
  if (id === "release" && entity.kind === "repo" && now) {
    const when = relativeDay(entity.latestRelease?.publishedAt, now);
    if (when) return `Released ${when}`;
  }
  return LABELS[id];
}

/**
 * Tiles for the given ids, in order. Ids that mean nothing for this kind are
 * skipped. A missing number is drawn as "–" while the entity is still
 * loading (so the layout does not jump when it arrives) and dropped once the
 * data is complete (never "0 members" for a hidden roster).
 *
 * `now` is the injected clock; with it a release tile says how long ago the
 * release was.
 */
export function statTiles(
  entity: Entity,
  ids: readonly StatId[],
  now?: Date,
): Tile[] {
  const loading = entity.kind === "user" && entity.complete === false;
  const tiles: Tile[] = [];
  for (const id of ids) {
    if (tiles.some((tile) => tile.id === id)) continue;
    const reading = read(entity, id);
    if (reading === undefined) continue;
    const label = labelOf(entity, id, now);
    if (reading === null) {
      if (loading) tiles.push({ id, label, value: PENDING });
      continue;
    }
    const value =
      typeof reading === "number" ? formatCount(reading) : reading.trim();
    if (!value) continue;
    const trend = id === "stars" ? starTrend(entity) : null;
    tiles.push(trend ? { id, label, value, trend } : { id, label, value });
  }
  return tiles;
}
