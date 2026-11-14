"use no memo";

import { DEFAULT_FONT_ID } from "@/lib/banner/fonts";
import { getPreset, presetDefaults } from "@/lib/banner/presets";
import { DEFAULT_SIZE_ID, SIZES } from "@/lib/banner/sizes";
import { clipText } from "@/lib/banner/text";
import { DEFAULT_THEME_ID, THEMES } from "@/lib/banner/themes";
import type {
  BannerOptions,
  EntityKind,
  FontId,
  HideId,
  SectionId,
  SizeId,
  StatId,
  ThemeColors,
} from "@/lib/banner/types";

/**
 * Banner options: defaults, the public query-string API and preset resolution.
 *
 * The query keys below are the product's URL API. They are parsed leniently
 * (a typo in an embedded image URL must never break the image) and printed
 * canonically (so one banner has one cache key).
 */

/** What a banner is when the URL says nothing. Presets refine `size`, `width`, `stats`, `count` and `hide`. */
export const DEFAULT_OPTIONS: BannerOptions = {
  preset: "overview",
  sections: null,
  size: DEFAULT_SIZE_ID,
  width: null,
  height: null,
  theme: DEFAULT_THEME_ID,
  colors: {},
  font: DEFAULT_FONT_ID,
  radius: null,
  border: null,
  title: null,
  year: null,
  stats: null,
  count: null,
  hide: [],
  brand: true,
  animate: false,
};

/** Accepted ranges, shared by the parser, the studio controls and the API docs. */
export const OPTION_LIMITS = {
  width: { min: 320, max: 3000 },
  height: { min: 120, max: 3000 },
  radius: { min: 0, max: 64 },
  year: { min: 2008, max: 2100 },
  count: { min: 1, max: 30 },
  /** Longest custom title, in characters. */
  title: 80,
  /** Largest canvas in pixels (width x height) the renderer is asked to draw. */
  pixels: 9_000_000,
} as const;

// Record<Id, true> instead of a plain array: the compiler then rejects a list
// that forgets (or invents) an id of the contract's unions.
const SECTION_FLAGS: Record<SectionId, true> = {
  header: true,
  stats: true,
  heatmap: true,
  streak: true,
  repos: true,
  languages: true,
  orgs: true,
  people: true,
  activity: true,
  contributors: true,
  wrapped: true,
};
const STAT_FLAGS: Record<StatId, true> = {
  contributions: true,
  commits: true,
  pullRequests: true,
  issues: true,
  reviews: true,
  contributedTo: true,
  followers: true,
  streak: true,
  stars: true,
  repositories: true,
  forks: true,
  members: true,
  watchers: true,
  openIssues: true,
  openPullRequests: true,
  contributors: true,
  totalCommits: true,
  release: true,
};
const HIDE_FLAGS: Record<HideId, true> = {
  avatar: true,
  bio: true,
  meta: true,
  title: true,
  legend: true,
  labels: true,
  topics: true,
  description: true,
};

/** Every section id, in the order of the `SectionId` contract. */
export const SECTION_IDS = Object.keys(SECTION_FLAGS) as SectionId[];
/** Every stat tile id, in the order of the `StatId` contract. */
export const STAT_IDS = Object.keys(STAT_FLAGS) as StatId[];
/** Every element that `hide=` can remove. */
export const HIDE_IDS = Object.keys(HIDE_FLAGS) as HideId[];
/** Every canvas size id, README first. */
export const SIZE_IDS = Object.keys(SIZES) as SizeId[];

/** Query keys of the colour overrides, mapped to the `ThemeColors` field they set. */
const COLOR_KEYS = [
  ["bg", "bg"],
  ["surface", "surface"],
  ["border_color", "border"],
  ["text", "text"],
  ["muted", "muted"],
  ["accent", "accent"],
] as const satisfies ReadonlyArray<
  readonly [string, keyof Omit<ThemeColors, "heat">]
>;

/**
 * Query keys in canonical order. Anything else in a query string is ignored.
 * `preset` is not a key: it is part of the path.
 */
export const QUERY_KEYS = [
  "size",
  "width",
  "height",
  "theme",
  "bg",
  "surface",
  "border_color",
  "text",
  "muted",
  "accent",
  "heat",
  "font",
  "radius",
  "border",
  "title",
  "year",
  "stats",
  "show",
  "hide",
  "count",
  "brand",
  "animate",
] as const;

export type QueryKey = (typeof QUERY_KEYS)[number];

/** Shapes a query string arrives in: `URL.searchParams` or a Next.js `searchParams` object. */
export type QueryInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

type Heat = ThemeColors["heat"];

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const INT_RE = /^\d{1,6}$/;
/**
 * Most entries of a list option that are looked at. No valid list is longer
 * than the number of stat ids (18); the cap keeps the work done for a query
 * string bounded however long someone makes it.
 */
const MAX_LIST_ITEMS = 64;

function lookup<T extends string>(ids: readonly T[]): Map<string, T> {
  return new Map(ids.map((id) => [id.toLowerCase(), id]));
}

const SIZE_LOOKUP = lookup(SIZE_IDS);
const THEME_LOOKUP = lookup(THEMES.map((theme) => theme.id as string));
const FONT_LOOKUP = lookup<FontId>(["mona", "mono"]);
const SECTION_LOOKUP = lookup(SECTION_IDS);
const STAT_LOOKUP = lookup(STAT_IDS);
const HIDE_LOOKUP = lookup(HIDE_IDS);

/** `#rrggbb` in lower case, or `null` when the value is not a 3 or 6 digit hex colour. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = HEX_RE.exec(value.trim())?.[1]?.toLowerCase();
  if (!digits) return null;
  if (digits.length === 6) return `#${digits}`;
  return `#${[...digits].map((digit) => digit + digit).join("")}`;
}

function pickEnum<T extends string>(
  value: unknown,
  ids: Map<string, T>,
): T | undefined {
  return typeof value === "string"
    ? ids.get(value.trim().toLowerCase())
    : undefined;
}

function pickInt(
  value: unknown,
  range: { min: number; max: number },
): number | undefined {
  const n =
    typeof value === "string" && INT_RE.test(value.trim())
      ? Number(value.trim())
      : value;
  if (typeof n !== "number" || !Number.isInteger(n)) return undefined;
  return n >= range.min && n <= range.max ? n : undefined;
}

function pickBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const flag = value.trim().toLowerCase();
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return undefined;
}

/**
 * Valid ids of a list, first occurrence wins. `undefined` when the input is
 * not a list or holds nothing valid; an empty list stays an empty list.
 */
function pickList<T extends string>(
  value: unknown,
  ids: Map<string, T>,
): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const picked: T[] = [];
  for (const item of value.slice(0, MAX_LIST_ITEMS)) {
    const id = pickEnum(item, ids);
    if (id && !picked.includes(id)) picked.push(id);
  }
  return value.length > 0 && picked.length === 0 ? undefined : picked;
}

/** Title as it may be drawn: control characters out, whitespace collapsed, at most 80 characters. */
function pickTitle(value: unknown): string | undefined {
  return clipText(value, OPTION_LIMITS.title) || undefined;
}

/**
 * One colour means "build the ramp from it" and is stored as five equal
 * entries, so the ramp can be rebuilt against whatever theme and background
 * the banner ends up with. Five colours are taken as they are.
 */
function pickHeat(value: unknown): Heat | undefined {
  // One colour or five: a longer list is not a ramp, however it starts.
  if (!Array.isArray(value) || value.length > 5) return undefined;
  const colors = value.map(normalizeHex);
  if (colors.some((color) => color === null)) return undefined;
  const [a, b, c, d, e] = colors as string[];
  if (colors.length === 1 && a) return [a, a, a, a, a];
  if (colors.length === 5 && a && b && c && d && e) return [a, b, c, d, e];
  return undefined;
}

function isUniform(heat: Heat): boolean {
  return heat.every((color) => color === heat[0]);
}

/**
 * Validates a hand-built or decoded partial and returns its canonical form:
 * invalid values and unknown keys are dropped, ids and colours are
 * normalised, and values that cannot change any banner (the default theme and
 * font, `brand: true`, `animate: false`, `null`) are left out.
 *
 * `size`, `width`, `height`, `stats`, `sections`, `hide` and `count` are kept
 * even when they equal `DEFAULT_OPTIONS`, because presets change those
 * defaults: `/torvalds/wrapped?size=readme` must stay a README card.
 */
export function normalizeOptions(
  input: Partial<BannerOptions> | null | undefined,
): Partial<BannerOptions> {
  const raw: Partial<Record<keyof BannerOptions, unknown>> = input ?? {};
  const out: Partial<BannerOptions> = {};

  const size = pickEnum(raw.size, SIZE_LOOKUP);
  if (size) out.size = size;
  const width = pickInt(raw.width, OPTION_LIMITS.width);
  if (width !== undefined) out.width = width;
  const height = pickInt(raw.height, OPTION_LIMITS.height);
  const canvasWidth = width ?? SIZES[size ?? DEFAULT_SIZE_ID].width;
  if (height !== undefined && canvasWidth * height <= OPTION_LIMITS.pixels) {
    out.height = height;
  }

  const theme = pickEnum(raw.theme, THEME_LOOKUP);
  if (theme && theme !== DEFAULT_OPTIONS.theme) out.theme = theme;

  const given =
    typeof raw.colors === "object" && raw.colors !== null
      ? (raw.colors as Record<string, unknown>)
      : {};
  const colors: BannerOptions["colors"] = {};
  for (const [, field] of COLOR_KEYS) {
    const color = normalizeHex(given[field]);
    if (color) colors[field] = color;
  }
  const heat = pickHeat(given.heat);
  if (heat) colors.heat = heat;
  if (Object.keys(colors).length > 0) out.colors = colors;

  const font = pickEnum(raw.font, FONT_LOOKUP);
  if (font && font !== DEFAULT_OPTIONS.font) out.font = font;
  const radius = pickInt(raw.radius, OPTION_LIMITS.radius);
  if (radius !== undefined) out.radius = radius;
  const border = pickBool(raw.border);
  if (border !== undefined) out.border = border;
  const title = pickTitle(raw.title);
  if (title) out.title = title;
  const year = pickInt(raw.year, OPTION_LIMITS.year);
  if (year !== undefined) out.year = year;

  const stats = pickList(raw.stats, STAT_LOOKUP);
  if (stats?.length) out.stats = stats;
  const sections = pickList(raw.sections, SECTION_LOOKUP);
  if (sections?.length) out.sections = sections;
  // An empty list is meaningful here: it un-hides what a preset hides.
  const hide = pickList(raw.hide, HIDE_LOOKUP);
  if (hide) out.hide = hide;
  const count = pickInt(raw.count, OPTION_LIMITS.count);
  if (count !== undefined) out.count = count;

  if (pickBool(raw.brand) === false) out.brand = false;
  if (pickBool(raw.animate) === true) out.animate = true;
  return out;
}

function reader(input: QueryInput) {
  const all = (key: QueryKey): string[] => {
    if (input instanceof URLSearchParams) return input.getAll(key);
    const value = Object.hasOwn(input, key) ? input[key] : undefined;
    if (typeof value === "string") return [value];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  };
  return {
    has: (key: QueryKey) => all(key).length > 0,
    /** The last occurrence wins, like most query-string parsers. */
    one: (key: QueryKey): string | undefined => all(key).at(-1),
    /**
     * Repeated parameters and comma-separated values, flattened. Only the
     * first entries are read (`String.split` stops at its limit), so a
     * megabyte of commas costs no more than a short list.
     */
    list: (key: QueryKey): string[] =>
      all(key)
        .slice(0, MAX_LIST_ITEMS)
        .flatMap((value) => value.split(",", MAX_LIST_ITEMS))
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, MAX_LIST_ITEMS),
  };
}

/**
 * Reads banner options from a query string. Lenient and total: unknown keys
 * are ignored, invalid values are dropped, nothing throws. The result holds
 * only what the URL really changes (see `normalizeOptions`), so it can be
 * handed to `resolveOptions` or printed back with `serializeOptions`.
 */
export function parseOptions(input: QueryInput): Partial<BannerOptions> {
  const query = reader(input ?? {});
  const colors: Record<string, unknown> = {};
  for (const [key, field] of COLOR_KEYS) colors[field] = query.one(key);
  if (query.has("heat")) colors.heat = query.list("heat");

  const candidate: Partial<Record<keyof BannerOptions, unknown>> = {
    size: query.one("size"),
    width: query.one("width"),
    height: query.one("height"),
    theme: query.one("theme"),
    colors,
    font: query.one("font"),
    radius: query.one("radius"),
    border: query.one("border"),
    title: query.one("title"),
    year: query.one("year"),
    stats: query.has("stats") ? query.list("stats") : undefined,
    sections: query.has("show") ? query.list("show") : undefined,
    hide: query.has("hide") ? query.list("hide") : undefined,
    count: query.one("count"),
    brand: query.one("brand"),
    animate: query.one("animate"),
  };
  return normalizeOptions(candidate as Partial<BannerOptions>);
}

/** `encodeURIComponent`, but commas stay readable: they separate list items. */
function encode(value: string): string {
  return encodeURIComponent(value).replace(/%2C/gi, ",");
}

/**
 * Canonical query string without the leading "?" ("" when nothing is set):
 * fixed key order, booleans as 0 / 1, colours as lower-case hex without "#".
 * The input is normalised first, so junk never reaches a URL, and
 * `parseOptions(serializeOptions(x))` deep-equals `normalizeOptions(x)`.
 */
export function serializeOptions(options: Partial<BannerOptions>): string {
  const clean = normalizeOptions(options);
  const colors = clean.colors ?? {};
  const hex = (color: string | undefined) => color?.slice(1);
  const heat = colors.heat
    ? (isUniform(colors.heat) ? [colors.heat[0]] : colors.heat)
        .map((color) => color.slice(1))
        .join(",")
    : undefined;
  const flag = (value: boolean | null | undefined) =>
    value === undefined || value === null ? undefined : value ? "1" : "0";

  const values: Record<QueryKey, string | undefined> = {
    size: clean.size,
    width: clean.width?.toString(),
    height: clean.height?.toString(),
    theme: clean.theme,
    bg: hex(colors.bg),
    surface: hex(colors.surface),
    border_color: hex(colors.border),
    text: hex(colors.text),
    muted: hex(colors.muted),
    accent: hex(colors.accent),
    heat,
    font: clean.font,
    radius: clean.radius?.toString(),
    border: flag(clean.border),
    title: clean.title ?? undefined,
    year: clean.year?.toString(),
    stats: clean.stats?.join(","),
    show: clean.sections?.join(","),
    hide: clean.hide?.join(","),
    count: clean.count?.toString(),
    brand: flag(clean.brand),
    animate: flag(clean.animate),
  };
  const pairs: string[] = [];
  for (const key of QUERY_KEYS) {
    const value = values[key];
    if (value !== undefined) pairs.push(`${key}=${encode(value)}`);
  }
  return pairs.join("&");
}

/**
 * The one spelling of a banner query, used as cache key and in canonical
 * URLs: `serializeOptions(parseOptions(input))`. Accepts a raw query string
 * with or without the leading "?".
 */
export function canonicalQuery(input: QueryInput | string): string {
  const query =
    typeof input === "string"
      ? new URLSearchParams(input.replace(/^\?/, ""))
      : input;
  return serializeOptions(parseOptions(query));
}

/**
 * Full options for one banner: the kind's preset (its default one when the
 * id is unknown or belongs to another kind: never an error), then that
 * preset's defaults, then the caller's overrides.
 */
export function resolveOptions(
  kind: EntityKind,
  preset: string | null | undefined,
  partial: Partial<BannerOptions> = {},
): BannerOptions {
  const chosen = getPreset(kind, preset);
  const defaults = presetDefaults(kind, chosen.id);
  const overrides = normalizeOptions(partial);
  return {
    ...DEFAULT_OPTIONS,
    preset: chosen.id,
    size: defaults?.size ?? DEFAULT_OPTIONS.size,
    // A preset's own width belongs to its own size: `card?size=x` is a full
    // X header, not a 495 px wide one.
    width:
      overrides.size === undefined || overrides.size === defaults?.size
        ? (defaults?.width ?? null)
        : null,
    // An empty preset list means "this preset has no stat row", not "no tiles ever".
    stats: defaults?.stats.length ? [...defaults.stats] : null,
    count: defaults?.count ?? null,
    hide: defaults ? [...defaults.hide] : [],
    ...overrides,
    colors: { ...overrides.colors },
  };
}

/**
 * Ad-hoc URLs are never Pro: the brand mark stays and nothing animates,
 * whatever the query asked for. Saved Pro banners skip this.
 */
export function stripProOptions<T extends Partial<BannerOptions>>(
  options: T,
): T {
  return { ...options, brand: true, animate: false };
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The smallest partial that turns the preset's defaults into `options`:
 * what a canonical URL for these options has to say. `null` fields ("decide
 * automatically") cannot be written in a query and are left out, except a
 * cleared preset width, which is spelled as the size's own width.
 */
export function diffOptions(
  kind: EntityKind,
  options: BannerOptions,
): Partial<BannerOptions> {
  const base = resolveOptions(kind, options.preset);
  const candidate: Partial<Record<keyof BannerOptions, unknown>> = {};
  for (const key of Object.keys(DEFAULT_OPTIONS) as (keyof BannerOptions)[]) {
    if (key === "preset" || sameValue(options[key], base[key])) continue;
    candidate[key] = options[key];
  }
  if (
    options.width === null &&
    base.width !== null &&
    options.size === base.size
  ) {
    candidate.width = SIZES[options.size]?.width;
  }
  return normalizeOptions(candidate as Partial<BannerOptions>);
}
