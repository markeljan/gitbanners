"use no memo";

import type {
  BannerPreset,
  EntityKind,
  HideId,
  SizeId,
  StatId,
} from "@/lib/banner/types";

/**
 * Banner variants, in the shape of the BannerPreset contract.
 * The id is the URL segment: /{owner}/{id} and /{owner}/{repo}/{id}.
 * The first preset of each kind is the default for the bare URL.
 */
export const PRESETS = [
  // ── users ────────────────────────────────────────────────────────────────
  {
    id: "overview",
    kind: "user",
    name: "Overview",
    description: "Identity, headline numbers and the contribution graph.",
    sections: ["header", "stats", "heatmap"],
  },
  {
    id: "activity",
    kind: "user",
    name: "Activity",
    description: "Only the contribution graph, with the yearly total.",
    sections: ["heatmap"],
  },
  {
    id: "stats",
    kind: "user",
    name: "Stats",
    description: "Eight headline numbers for the last 12 months.",
    sections: ["header", "stats"],
  },
  {
    id: "repos",
    kind: "user",
    name: "Top repositories",
    description:
      "Pinned or most-starred repositories above the contribution graph.",
    sections: ["header", "repos", "heatmap"],
  },
  {
    id: "languages",
    kind: "user",
    name: "Languages",
    description: "Language mix across public repositories.",
    sections: ["header", "languages"],
  },
  {
    id: "streak",
    kind: "user",
    name: "Streak",
    description: "Current and longest streak over the last year of activity.",
    sections: ["streak", "heatmap"],
  },
  {
    id: "wrapped",
    kind: "user",
    name: "Year in review",
    description:
      "A poster of one calendar year: totals, best day, streak and top repositories.",
    sections: ["wrapped"],
  },
  {
    id: "card",
    kind: "user",
    name: "Compact card",
    description: "Small README card with three numbers.",
    sections: ["header", "stats"],
  },
  // ── repositories ─────────────────────────────────────────────────────────
  {
    id: "overview",
    kind: "repo",
    name: "Overview",
    description: "Name, description, headline numbers and the language bar.",
    sections: ["header", "stats", "languages"],
  },
  {
    id: "activity",
    kind: "repo",
    name: "Activity",
    description: "Commits per week over the last year.",
    sections: ["header", "activity", "stats"],
  },
  {
    id: "contributors",
    kind: "repo",
    name: "Contributors",
    description: "The people behind the repository, as an avatar grid.",
    sections: ["header", "stats", "contributors"],
  },
  {
    id: "social",
    kind: "repo",
    name: "Social preview",
    description:
      "Poster sized for the repository social preview and link previews.",
    sections: ["header", "stats", "languages"],
  },
  {
    id: "release",
    kind: "repo",
    name: "Release and health",
    description:
      "Latest release, open issues and pull requests, recent commit activity.",
    sections: ["header", "stats", "activity"],
  },
  // ── organizations ────────────────────────────────────────────────────────
  {
    id: "overview",
    kind: "org",
    name: "Overview",
    description: "Identity, headline numbers and public members.",
    sections: ["header", "stats", "people"],
  },
  {
    id: "repos",
    kind: "org",
    name: "Top repositories",
    description: "The organization's most-starred public repositories.",
    sections: ["header", "repos"],
  },
  {
    id: "activity",
    kind: "org",
    name: "Activity",
    description: "Commits per week across the organization's top repositories.",
    sections: ["header", "stats", "activity"],
  },
] as const satisfies readonly BannerPreset[];

export type PresetKey = `${EntityKind}/${(typeof PRESETS)[number]["id"]}`;

/** What a preset resolves to when the URL carries no options. */
export interface PresetDefaults {
  size: SizeId;
  /** Custom width that replaces the size's width (compact cards). */
  width: number | null;
  /** Stat tiles, in display order. Empty = the preset has no stat row. */
  stats: readonly StatId[];
  /** Repositories / contributors / people to show. null = fit the layout. */
  count: number | null;
  hide: readonly HideId[];
  /**
   * `bars` draws commit activity as the compact weekly bar chart even where
   * the calendar would fit: for presets whose chart supports other content
   * instead of leading. Left out, the size of the canvas decides.
   */
  chart?: "bars";
}

export const PRESET_DEFAULTS: Partial<Record<PresetKey, PresetDefaults>> = {
  "user/overview": {
    size: "readme",
    width: null,
    stats: ["contributions", "stars", "followers", "repositories"],
    count: null,
    hide: [],
  },
  "user/activity": {
    size: "readme",
    width: null,
    stats: [],
    count: null,
    hide: ["avatar", "bio", "meta"],
  },
  "user/stats": {
    size: "readme",
    width: null,
    stats: [
      "contributions",
      "commits",
      "pullRequests",
      "reviews",
      "issues",
      "contributedTo",
      "stars",
      "followers",
    ],
    count: null,
    hide: [],
  },
  "user/repos": {
    size: "readme",
    width: null,
    stats: [],
    count: 3,
    hide: ["bio"],
  },
  "user/languages": {
    size: "readme",
    width: null,
    stats: ["repositories"],
    count: 6,
    hide: ["bio"],
  },
  "user/streak": {
    size: "readme",
    width: null,
    stats: ["streak", "contributions"],
    count: null,
    hide: [],
  },
  "user/wrapped": {
    size: "og",
    width: null,
    stats: ["contributions", "commits", "pullRequests", "reviews"],
    count: 3,
    hide: [],
  },
  "user/card": {
    size: "readme",
    width: 495,
    stats: ["contributions", "stars", "followers"],
    count: null,
    hide: ["bio", "meta"],
  },
  "repo/overview": {
    size: "readme",
    width: null,
    stats: ["stars", "forks", "openIssues", "openPullRequests"],
    count: 6,
    hide: [],
  },
  "repo/activity": {
    size: "readme",
    width: null,
    stats: ["totalCommits", "contributors", "release"],
    count: null,
    hide: ["topics"],
  },
  "repo/contributors": {
    size: "readme",
    width: null,
    stats: ["contributors"],
    count: null,
    hide: ["topics"],
  },
  "repo/social": {
    size: "social",
    width: null,
    stats: ["stars", "forks", "contributors", "openIssues"],
    count: 6,
    hide: ["topics"],
  },
  "repo/release": {
    size: "readme",
    width: null,
    stats: ["release", "openIssues", "openPullRequests", "watchers"],
    count: null,
    hide: ["topics"],
    chart: "bars",
  },
  "org/overview": {
    size: "readme",
    width: null,
    stats: ["repositories", "stars", "members", "followers"],
    count: null,
    hide: [],
  },
  "org/repos": {
    size: "readme",
    width: null,
    stats: [],
    count: 6,
    hide: ["bio"],
  },
  "org/activity": {
    size: "readme",
    width: null,
    stats: ["repositories", "stars", "members"],
    count: null,
    hide: ["bio"],
  },
};

/** Preset ids per kind, in picker order. The first one is the default. */
export function presetsFor(kind: EntityKind): readonly BannerPreset[] {
  return PRESETS.filter((p) => p.kind === kind);
}

/**
 * The preset `id` names for this kind, or the kind's default when the id is
 * unknown or belongs to another kind. Never an error: a mistyped preset in an
 * embedded image URL must still draw a banner.
 */
export function getPreset(
  kind: EntityKind,
  id: string | null | undefined,
): BannerPreset {
  const presets = presetsFor(kind);
  return presets.find((preset) => preset.id === id) ?? presets[0];
}

/** The preset behind the bare URL of a kind (`/{owner}`, `/{owner}/{repo}`). */
export function defaultPresetId(kind: EntityKind): string {
  return getPreset(kind, null).id;
}

/**
 * What the preset resolves to when the URL carries no options, or `null` for
 * a preset without an entry (it then inherits `DEFAULT_OPTIONS`).
 */
export function presetDefaults(
  kind: EntityKind,
  id: string,
): PresetDefaults | null {
  return PRESET_DEFAULTS[`${kind}/${id}` as PresetKey] ?? null;
}

/**
 * Second path segments that mean "a user or org preset", so /{owner}/{segment}
 * is a profile banner and not the repository of that name. A repository with
 * one of these names stays reachable as /{owner}/{repo}/overview.
 */
export const OWNER_PRESET_IDS: ReadonlySet<string> = new Set(
  PRESETS.filter((p) => p.kind !== "repo").map((p) => p.id),
);
