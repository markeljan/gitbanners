/**
 * The studio's state and its URL, as pure functions.
 *
 * A studio state is a target, a preset and the options that differ from
 * that preset's defaults. It lives in the address bar, so every state is a
 * link: `/studio?target=vercel/next.js&preset=contributors&theme=dracula`.
 * The address is always printed in one minimal, canonical spelling: the
 * preset is left out when it is the kind's default, and options are the
 * engine's `diffOptions` printed by `serializeOptions`.
 */
import {
  type BannerOptions,
  type BannerTarget,
  defaultPresetId,
  diffOptions,
  type EntityKind,
  getPreset,
  type HideId,
  parseOptions,
  resolveOptions,
  type SectionId,
  type StatId,
  serializeOptions,
  stripProOptions,
  type ThemeColors,
} from "@/lib/banner";
import { parseTargetSlug, targetSlug } from "@/lib/embed";

export interface StudioState {
  /** What the banner is about. `null` opens the bundled sample profile. */
  target: BannerTarget | null;
  /**
   * The preset asked for. It may belong to another kind while a new target
   * loads; `resolveStudio` falls back to the kind's default then.
   */
  preset: string | null;
  /** Options that differ from the preset's defaults (normalised). */
  overrides: Partial<BannerOptions>;
  /** The saved banner being edited, if any. */
  bannerId: string | null;
}

export const EMPTY_STATE: StudioState = {
  target: null,
  preset: null,
  overrides: {},
  bannerId: null,
};

const PRESET_RE = /^[a-z][a-z0-9-]{0,31}$/;
/** Saved banner ids: "b" and eleven base36 characters. */
export const BANNER_ID_RE = /^b[0-9a-z]{11}$/;

/** Stat tiles each kind of entity can show, in the order offered. */
export const STATS_BY_KIND: Record<EntityKind, readonly StatId[]> = {
  user: [
    "contributions",
    "commits",
    "pullRequests",
    "issues",
    "reviews",
    "contributedTo",
    "followers",
    "streak",
    "stars",
    "repositories",
  ],
  org: ["repositories", "stars", "forks", "members", "followers"],
  repo: [
    "stars",
    "forks",
    "watchers",
    "openIssues",
    "openPullRequests",
    "contributors",
    "totalCommits",
    "release",
  ],
};

export const STAT_LABELS: Record<StatId, string> = {
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

/** Sections each kind can draw, in the order offered. */
export const SECTIONS_BY_KIND: Record<EntityKind, readonly SectionId[]> = {
  user: [
    "header",
    "stats",
    "heatmap",
    "streak",
    "repos",
    "languages",
    "orgs",
    "wrapped",
  ],
  org: ["header", "stats", "repos", "languages", "people", "activity"],
  repo: ["header", "stats", "activity", "languages", "contributors"],
};

export const SECTION_LABELS: Record<SectionId, string> = {
  header: "Header",
  stats: "Stats",
  heatmap: "Contribution graph",
  streak: "Streak",
  repos: "Repositories",
  languages: "Languages",
  orgs: "Organizations",
  people: "People",
  activity: "Commit activity",
  contributors: "Contributors",
  wrapped: "Year in review",
};

/** Elements that can be hidden, per kind, with what they are called there. */
export const HIDE_BY_KIND: Record<
  EntityKind,
  readonly { id: HideId; label: string }[]
> = {
  user: [
    { id: "avatar", label: "Avatar" },
    { id: "title", label: "Name" },
    { id: "bio", label: "Bio" },
    { id: "meta", label: "Location and company" },
    { id: "legend", label: "Graph legend" },
    { id: "labels", label: "Graph labels" },
  ],
  org: [
    { id: "avatar", label: "Avatar" },
    { id: "title", label: "Name" },
    { id: "bio", label: "Description" },
    { id: "meta", label: "Location and website" },
  ],
  repo: [
    { id: "avatar", label: "Owner avatar" },
    { id: "title", label: "Name" },
    { id: "description", label: "Description" },
    { id: "topics", label: "Topics" },
    { id: "meta", label: "Language, license and release" },
    { id: "legend", label: "Graph legend" },
  ],
};

/** The colour overrides, in the order the controls list them. */
export const COLOR_FIELDS = [
  { id: "bg", label: "Background" },
  { id: "surface", label: "Surface" },
  { id: "border", label: "Border" },
  { id: "text", label: "Text" },
  { id: "muted", label: "Muted text" },
  { id: "accent", label: "Accent" },
] as const satisfies readonly {
  id: keyof Omit<ThemeColors, "heat">;
  label: string;
}[];

export type ColorField = (typeof COLOR_FIELDS)[number]["id"] | "heat";

/** Options a preset choice brings with it; they are dropped when the preset changes. */
const PRESET_CONTENT = ["stats", "sections", "count", "hide"] as const;

function pickPreset(value: string | null): string | null {
  const preset = value?.trim().toLowerCase() ?? "";
  return PRESET_RE.test(preset) ? preset : null;
}

/** Reads a studio address (`location.search`, with or without "?"). */
export function parseStudioSearch(
  search: string | URLSearchParams,
): StudioState {
  const params =
    typeof search === "string"
      ? new URLSearchParams(search.replace(/^\?/, ""))
      : search;
  const banner = params.get("banner")?.trim() ?? "";
  return {
    target: parseTargetSlug(params.get("target") ?? ""),
    preset: pickPreset(params.get("preset")),
    overrides: parseOptions(params),
    bannerId: BANNER_ID_RE.test(banner) ? banner : null,
  };
}

/**
 * The overrides a kind can use: stat tiles and sections it has, and a year
 * only for users. Everything else carries over between kinds.
 */
export function adaptOverrides(
  overrides: Partial<BannerOptions>,
  kind: EntityKind,
): Partial<BannerOptions> {
  const out: Partial<BannerOptions> = { ...overrides };
  if (out.stats) {
    const stats = out.stats.filter((id) => STATS_BY_KIND[kind].includes(id));
    if (stats.length > 0) out.stats = stats;
    else delete out.stats;
  }
  if (out.sections) {
    const sections = out.sections.filter((id) =>
      SECTIONS_BY_KIND[kind].includes(id),
    );
    if (sections.length > 0) out.sections = sections;
    else delete out.sections;
  }
  if (kind !== "user") delete out.year;
  return out;
}

/** The preset id on screen for a kind: the one asked for, or the kind's default. */
export function presetFor(kind: EntityKind, state: StudioState): string {
  return getPreset(kind, state.preset).id;
}

/** Every option of the banner, for the entity kind on screen. */
export function resolveStudio(
  kind: EntityKind,
  state: StudioState,
): BannerOptions {
  return resolveOptions(
    kind,
    presetFor(kind, state),
    adaptOverrides(state.overrides, kind),
  );
}

/**
 * The canonical banner query of a state: only what differs from the
 * preset, in the engine's key order, without "?".
 */
export function bannerQuery(kind: EntityKind, state: StudioState): string {
  return serializeOptions(diffOptions(kind, resolveStudio(kind, state)));
}

/**
 * The query of the public, unsaved image URL. Pro options only work on
 * saved banners, so they are left out of every copied link.
 */
export function publicQuery(kind: EntityKind, state: StudioState): string {
  return serializeOptions(
    stripProOptions(diffOptions(kind, resolveStudio(kind, state))),
  );
}

/**
 * The studio address of a state, without "?": `banner`, `target` and
 * `preset` first, then the banner options. The sample profile and the
 * kind's default preset are not written.
 */
export function studioSearch(kind: EntityKind, state: StudioState): string {
  const head: string[] = [];
  if (state.bannerId) head.push(`banner=${state.bannerId}`);
  if (state.target) {
    head.push(`target=${encodeURIComponent(targetSlug(state.target))}`);
  }
  const preset = presetFor(kind, state);
  if (preset !== defaultPresetId(kind)) head.push(`preset=${preset}`);
  const query = bannerQuery(kind, state);
  return [...head, ...(query ? [query] : [])]
    .join("&")
    .replace(/%2F/gi, "/");
}

/** Two addresses that mean the same studio state. */
export function sameSearch(a: string, b: string): boolean {
  const order = (search: string) => {
    const params = new URLSearchParams(search.replace(/^\?/, ""));
    params.sort();
    return params.toString();
  };
  return order(a) === order(b);
}

/**
 * The state after some options changed. The overrides are recomputed
 * against the preset, so setting a value back to the preset's default
 * removes it from the address.
 */
export function withOptions(
  kind: EntityKind,
  state: StudioState,
  patch: Partial<BannerOptions>,
): StudioState {
  const next = { ...resolveStudio(kind, state), ...patch };
  // A year only means something to users; keep it for when one is back.
  const kept =
    kind !== "user" && state.overrides.year != null
      ? { year: state.overrides.year }
      : {};
  return { ...state, overrides: { ...diffOptions(kind, next), ...kept } };
}

/** The state with one colour overridden, or reset to the theme's (`null`). */
export function withColor(
  kind: EntityKind,
  state: StudioState,
  field: ColorField,
  hex: string | null,
): StudioState {
  const colors: BannerOptions["colors"] = {
    ...resolveStudio(kind, state).colors,
  };
  if (field === "heat") {
    if (hex) colors.heat = [hex, hex, hex, hex, hex];
    else delete colors.heat;
  } else if (hex) {
    colors[field] = hex;
  } else {
    delete colors[field];
  }
  return withOptions(kind, state, { colors });
}

/**
 * Another preset. Theme, colours, size and type stay; the content a preset
 * chooses (stat tiles, sections, count, hidden elements) is the new
 * preset's own.
 */
export function withPreset(
  kind: EntityKind,
  state: StudioState,
  preset: string,
): StudioState {
  const id = getPreset(kind, preset).id;
  const overrides = { ...state.overrides };
  for (const key of PRESET_CONTENT) delete overrides[key];
  return { ...state, preset: id, overrides };
}

/** Another target. Every option that applies to its kind is kept. */
export function withTarget(
  state: StudioState,
  target: BannerTarget,
): StudioState {
  return { ...state, target };
}

/** Back to the preset's defaults, keeping target, preset and the saved banner. */
export function resetOptions(state: StudioState): StudioState {
  return { ...state, overrides: {} };
}

/** True when the state has options beyond the preset's defaults. */
export function hasOverrides(kind: EntityKind, state: StudioState): boolean {
  return bannerQuery(kind, state) !== "";
}

/** The colour of a field as drawn: the override, else the theme's. */
export function colorOf(
  theme: ThemeColors,
  options: BannerOptions,
  field: ColorField,
): { value: string; isOverridden: boolean } {
  if (field === "heat") {
    const heat = options.colors.heat;
    return heat
      ? { value: heat[4], isOverridden: true }
      : { value: theme.heat[4], isOverridden: false };
  }
  const own = options.colors[field];
  return own
    ? { value: own, isOverridden: true }
    : { value: theme[field], isOverridden: false };
}

/** Name suggested when a banner is saved: "vercel/next.js: Contributors". */
export function defaultBannerName(
  target: BannerTarget,
  kind: EntityKind,
  preset: string,
): string {
  const name = `${targetSlug(target)}: ${getPreset(kind, preset).name}`;
  return name.length > 60 ? `${name.slice(0, 59)}…` : name;
}

/**
 * Years a user banner can show, newest first: from the year the account
 * was created (never before `min`) to `now`'s year.
 */
export function yearChoices(
  createdAt: string | null | undefined,
  now: Date,
  min: number,
): number[] {
  const current = now.getUTCFullYear();
  const joined = createdAt ? new Date(createdAt).getUTCFullYear() : min;
  const first = Number.isFinite(joined) ? Math.max(min, joined) : min;
  const years: number[] = [];
  for (let year = current; year >= first; year--) years.push(year);
  return years;
}

/** Moves one entry of a list up (-1) or down (+1). Out of range is a no-op. */
export function moveItem<T>(list: readonly T[], index: number, by: -1 | 1) {
  const to = index + by;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) {
    return [...list];
  }
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}
