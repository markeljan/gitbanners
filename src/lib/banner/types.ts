/**
 * Banner engine contract.
 *
 * The engine (`src/lib/banner`) is pure and isomorphic: given normalized GitHub
 * data and resolved options it returns ONE React element with explicit pixel
 * layout. The same element is rendered to SVG/PNG on the server
 * (`src/lib/render`) and as real DOM in the browser for the studio's instant
 * preview — so nothing in here may depend on Node, the DOM, hooks or time.
 */
import type { ReactElement } from "react";
import type { Entity } from "@/lib/github/schema";

export type EntityKind = Entity["kind"];

/** What a banner is about, as addressed in URLs. */
export type BannerTarget =
  | { kind: "owner"; login: string }
  | { kind: "repo"; owner: string; name: string };

export type ImageFormat = "svg" | "png";

/** Building blocks a banner is composed of. Availability depends on the entity kind. */
export type SectionId =
  /** Avatar, name, handle, bio / description, meta line. All kinds. */
  | "header"
  /** Row of headline numbers. All kinds. */
  | "stats"
  /** Contribution calendar, GitHub style. Users. */
  | "heatmap"
  /** Current and longest contribution streak. Users. */
  | "streak"
  /** Pinned / top repositories as cards. Users and orgs. */
  | "repos"
  /** Language distribution bar with legend. All kinds. */
  | "languages"
  /** Organization avatars a user belongs to. Users. */
  | "orgs"
  /** Public members as an avatar grid. Orgs. */
  | "people"
  /** 52-week commit activity chart. Repos. */
  | "activity"
  /** Contributor avatar grid. Repos. */
  | "contributors"
  /** Year-in-review poster. Users. Used on its own. */
  | "wrapped";

export type SizeId = "readme" | "x" | "linkedin" | "og" | "social" | "square";

export interface BannerSize {
  id: SizeId;
  /** Sentence-case label, e.g. "X header". */
  name: string;
  description: string;
  width: number;
  /** `null` = height follows the content (README cards). */
  height: number | null;
  /**
   * Region other UI covers on the target surface (e.g. the profile photo on X),
   * in canvas pixels. The studio draws it as a guide; layouts keep key content out.
   */
  safeZone: {
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
  } | null;
}

export interface ThemeColors {
  /** Canvas background. */
  bg: string;
  /** Raised surface inside the banner (cards, tiles). */
  surface: string;
  /** Hairlines and outlines. */
  border: string;
  /** Primary text. */
  text: string;
  /** Secondary text, labels, icons. */
  muted: string;
  /** Links, highlights, charts without a heat ramp. */
  accent: string;
  /** Contribution ramp, from "no contributions" to "most". */
  heat: readonly [string, string, string, string, string];
}

export interface BannerTheme {
  id: string;
  name: string;
  mode: "dark" | "light";
  colors: ThemeColors;
}

/** `mona` = Mona Sans (GitHub's typeface), `mono` = Mona Sans Mono. */
export type FontId = "mona" | "mono";

export interface BannerFont {
  id: FontId;
  name: string;
  /** CSS font-family registered with both the browser (@font-face) and the image renderer. */
  family: string;
}

export interface BannerPreset {
  id: string;
  kind: EntityKind;
  /** Sentence-case label, e.g. "Top repositories". */
  name: string;
  description: string;
  sections: readonly SectionId[];
}

/** Stat tiles that can be shown in the `stats` section, per kind. */
export type StatId =
  // users
  | "contributions"
  | "commits"
  | "pullRequests"
  | "issues"
  | "reviews"
  | "contributedTo"
  | "followers"
  | "streak"
  // shared
  | "stars"
  | "repositories"
  | "forks"
  // orgs
  | "members"
  // repos
  | "watchers"
  | "openIssues"
  | "openPullRequests"
  | "contributors"
  | "totalCommits"
  | "release";

/** Fine-grained elements that can be hidden with `hide=`. */
export type HideId =
  | "avatar"
  | "bio"
  | "meta"
  | "title"
  | "legend"
  | "labels"
  | "topics"
  | "description";

/**
 * Fully resolved banner options. Every field has a value; `null` means
 * "decide automatically from the size / preset".
 */
export interface BannerOptions {
  /** Preset id valid for the entity kind. */
  preset: string;
  /** Explicit section list (render order). `null` = the preset's sections. */
  sections: SectionId[] | null;
  size: SizeId;
  /** Custom canvas width in px (overrides `size`). */
  width: number | null;
  /** Custom canvas height in px. With a custom width and no height the height is automatic. */
  height: number | null;
  /** Theme id. */
  theme: string;
  /** Per-colour overrides on top of the theme (hex, with leading #). */
  colors: Partial<Omit<ThemeColors, "heat">> & { heat?: ThemeColors["heat"] };
  font: FontId;
  /** Outer corner radius in px. */
  radius: number | null;
  /** Outer 1px border. */
  border: boolean | null;
  /** Custom headline replacing the default title of the main section. */
  title: string | null;
  /** Calendar year for user banners. `null` = the last 12 months. */
  year: number | null;
  /** Which stat tiles to show, in order. `null` = the preset's choice. */
  stats: StatId[] | null;
  /** How many repositories / contributors / people to show. `null` = fit the layout. */
  count: number | null;
  hide: HideId[];
  /** Show the small site mark. Only saved Pro banners may turn it off. */
  brand: boolean;
  /** Animate the SVG (Pro, SVG only). */
  animate: boolean;
}

/** Environment injected by the caller so the engine stays pure. */
export interface RenderEnv {
  /**
   * Turn a remote image URL into something drawable at `px` CSS pixels.
   * Server: a data URI (pre-fetched). Browser: the URL with a size hint.
   */
  image(url: string, px: number): string;
  /** "Now", injected for determinism (streaks, relative labels). */
  now: Date;
  /** Host shown in the brand mark, e.g. "gitbanners.com". */
  host: string;
}

export interface BuiltBanner {
  width: number;
  height: number;
  /** Root element. Its style sets exactly `width` x `height`. */
  element: ReactElement;
  /** Plain-text description for `alt` / `aria-label`. */
  alt: string;
  font: BannerFont;
  /** Resolved theme after overrides. */
  theme: BannerTheme;
  /**
   * Geometry of the contribution heatmap, when the banner has one. The server
   * uses it to animate the SVG after rendering (`animate` option); `cells` is
   * the number of day cells drawn and guards against format drift.
   */
  heatmap: HeatmapGeometry | null;
}

export interface HeatmapGeometry {
  /** Cell edge in px. */
  cell: number;
  /** Cell corner radius in px. */
  radius: number;
  /** Gap between cells in px. */
  gap: number;
  /** Heat palette exactly as written into the cells (lower-case hex). */
  colors: readonly string[];
  /** Number of day cells drawn. */
  cells: number;
}

/** Result of parsing a banner URL path such as `/vercel/next.js/contributors.png`. */
export interface ParsedBannerPath {
  target: BannerTarget;
  /** Preset from the path, if any. Not validated against the entity kind yet. */
  preset: string | null;
  /** Image format from a trailing `.svg` / `.png`, if any. */
  format: ImageFormat | null;
}
