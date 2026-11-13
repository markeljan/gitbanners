/**
 * From a recognised card URL to the closest GitBanners banner: which target,
 * which preset, which options carry over and which are dropped.
 */
import {
  type BannerOptions,
  type BannerTarget,
  bannerPath,
  type HideId,
  OPTION_LIMITS,
  type StatId,
  serializeOptions,
  THEMES,
} from "@/lib/banner";
import { LOGIN_RE, REPO_NAME_RE } from "@/lib/github/schema";
import type { CardKind, CardMatch } from "./services";

/** A light or dark preference read from around the URL. */
export type ModeHint = "light" | "dark";

export interface ConvertContext {
  /** Login to use when the card URL names none. */
  login?: string;
  /** From `<source media="(prefers-color-scheme: …)">`. */
  mode?: ModeHint;
  /** Origin of the new URLs, without a trailing slash. */
  origin: string;
}

export type Conversion =
  | {
      ok: true;
      /** The new image URL, not yet escaped for its context. */
      url: string;
      /** "theme=dracula", "hide_border → border=0": what was kept. */
      carried: string[];
      /** Parameters that have no equivalent and were left out. */
      dropped: string[];
      /** Facts worth telling about this replacement. */
      notes: string[];
    }
  | { ok: false; reason: string };

/** Card kinds GitBanners has nothing for. */
const NO_EQUIVALENT: Partial<Record<CardKind, string>> = {
  wakatime:
    "GitBanners draws GitHub data only, so there is no WakaTime card to switch to. Remove the card, or point it at a server you run yourself.",
  gist: "GitBanners has no card for a gist. Link to the gist instead, or remove the card.",
  "productive-time":
    "GitBanners has no card for the hours you commit at, so this one is left alone.",
};

/** Preset for each card kind that has an equivalent. */
const PRESET: Partial<Record<CardKind, string>> = {
  stats: "stats",
  "top-langs": "languages",
  pin: "overview",
  streak: "streak",
  trophy: "card",
  "activity-graph": "activity",
  "repo-card": "overview",
  "profile-details": "overview",
  "summary-stats": "stats",
  "summary-languages": "languages",
};

/** Parameters that only name the target: never reported as dropped. */
const IDENTITY = new Set(["username", "user", "repo", "type"]);

const THEME_IDS = new Set<string>(THEMES.map((theme) => theme.id));

/** Names other services use for a theme GitBanners has under another spelling. */
const THEME_ALIASES: Record<string, string> = {
  tokyonight: "tokyo-night",
  onedark: "one-dark",
  gruvbox: "gruvbox-dark",
  dark: "github-dark",
  light: "github-light",
  "dark-dimmed": "github-dark-dimmed",
  gitdimmed: "github-dark-dimmed",
};

/** Themes of the old services that are light: the closest GitBanners theme is GitHub light. */
const LIGHT_THEMES = new Set([
  "default",
  "default-repocard",
  "graywhite",
  "buefy",
  "vue",
  "swift",
  "flag-india",
  "github",
  "minimal",
  "flat",
  "solarized",
]);

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

function hex(value: string | undefined): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(
    (value ?? "").trim(),
  );
  return match?.[1] ? `#${match[1].toLowerCase()}` : null;
}

function isTrue(value: string | undefined): boolean {
  return value !== undefined && /^(?:true|1|yes|)$/i.test(value.trim());
}

function int(value: string | undefined): number | null {
  if (value === undefined || !/^\s*\d+(?:\.\d+)?\s*$/.test(value)) return null;
  return Math.round(Number(value));
}

function luminance(color: string): number {
  const digits = color.slice(1);
  const full =
    digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits;
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** readme-stats' stat ids, in the order its stats card draws them. */
const README_STATS: Record<string, StatId> = {
  stars: "stars",
  commits: "commits",
  prs: "pullRequests",
  issues: "issues",
  contribs: "contributedTo",
  reviews: "reviews",
};
const README_DEFAULT_STATS = ["stars", "commits", "prs", "issues", "contribs"];

function listParam(value: string | undefined): string[] {
  return (value ?? "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

interface Builder {
  options: Partial<BannerOptions>;
  colors: NonNullable<BannerOptions["colors"]>;
  carried: string[];
  used: Set<string>;
  notes: string[];
}

function color(
  b: Builder,
  params: ReadonlyMap<string, string>,
  key: string,
  field: "bg" | "surface" | "border" | "text" | "muted" | "accent",
): void {
  const raw = params.get(key);
  if (raw === undefined || b.colors[field]) return;
  // readme-stats takes "angle,color,color" for a gradient background.
  const parts = raw.split(",");
  const value = hex(parts.length >= 3 ? parts[1] : raw);
  if (!value) return;
  b.colors[field] = value;
  b.used.add(key);
  const name = field === "border" ? "border_color" : field;
  b.carried.push(
    parts.length >= 3
      ? `${key} (gradient) → ${name}=${value.slice(1)}, its first colour`
      : `${key} → ${name}=${value.slice(1)}`,
  );
}

function flag(
  b: Builder,
  params: ReadonlyMap<string, string>,
  key: string,
  apply: () => string,
): void {
  if (!params.has(key)) return;
  b.used.add(key);
  if (isTrue(params.get(key))) b.carried.push(`${key} → ${apply()}`);
}

function hide(b: Builder, id: HideId): string {
  const list = b.options.hide ?? [];
  if (!list.includes(id)) b.options.hide = [...list, id];
  return `hide=${id}`;
}

function theme(
  b: Builder,
  params: ReadonlyMap<string, string>,
  mode?: ModeHint,
) {
  const raw = params.get("theme");
  if (raw !== undefined) {
    const name = normalizeName(raw);
    const id = THEME_IDS.has(name) ? name : THEME_ALIASES[name];
    if (id) b.used.add("theme");
    if (id) {
      b.options.theme = id;
      b.carried.push(`theme=${raw} → theme=${id}`);
      return;
    }
    if (LIGHT_THEMES.has(name)) {
      b.used.add("theme");
      b.options.theme = "github-light";
      b.carried.push(
        `theme=${raw} → theme=github-light, the closest light theme`,
      );
      return;
    }
    b.notes.push(
      `There is no theme named "${raw}" here, so the default GitHub dark theme is used.`,
    );
  }
  if (mode === "light") {
    b.options.theme = "github-light";
    b.carried.push("light mode source → theme=github-light");
    return;
  }
  if (mode === "dark") return;
  // A custom light background on the default dark theme would leave light
  // text on it: switch to the light theme so text stays readable.
  if (b.colors.bg && luminance(b.colors.bg) > 0.5) {
    b.options.theme = "github-light";
    b.notes.push("The background is light, so the light theme draws the text.");
  }
}

function common(b: Builder, params: ReadonlyMap<string, string>): void {
  flag(b, params, "hide_border", () => {
    b.options.border = false;
    return "border=0";
  });
  const radius = int(params.get("border_radius"));
  if (radius !== null) {
    b.used.add("border_radius");
    b.options.radius = Math.min(radius, OPTION_LIMITS.radius.max);
    b.carried.push(`border_radius → radius=${b.options.radius}`);
  }
  const width = int(params.get("card_width"));
  if (width !== null) {
    if (width >= OPTION_LIMITS.width.min && width <= OPTION_LIMITS.width.max) {
      b.used.add("card_width");
      b.options.width = width;
      b.carried.push(`card_width → width=${width}`);
    } else {
      b.notes.push(
        `card_width=${width} is outside ${OPTION_LIMITS.width.min} to ${OPTION_LIMITS.width.max} pixels, so the banner keeps its own width.`,
      );
    }
  }
  const title = params.get("custom_title");
  if (title?.trim()) {
    b.used.add("custom_title");
    b.options.title = title.trim().slice(0, OPTION_LIMITS.title);
    b.carried.push("custom_title → title");
  }
  flag(b, params, "hide_title", () => hide(b, "title"));
}

function readmeStatsColors(b: Builder, params: ReadonlyMap<string, string>) {
  color(b, params, "bg_color", "bg");
  color(b, params, "text_color", "text");
  color(b, params, "title_color", "accent");
  color(b, params, "ring_color", "accent");
  color(b, params, "icon_color", "muted");
  color(b, params, "border_color", "border");
}

function statsList(b: Builder, params: ReadonlyMap<string, string>): void {
  if (!params.has("hide") && !params.has("show")) return;
  const hidden = new Set(listParam(params.get("hide")));
  const shown = listParam(params.get("show"));
  const ids = [...README_DEFAULT_STATS, ...shown]
    .filter((id) => !hidden.has(id))
    .map((id) => README_STATS[id])
    .filter((id): id is StatId => id !== undefined);
  if (ids.length === 0) return;
  b.options.stats = [...new Set(ids)];
  for (const key of ["hide", "show"]) if (params.has(key)) b.used.add(key);
  b.carried.push(`hide and show → stats=${b.options.stats.join(",")}`);
}

function login(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/^@/, "");
  return trimmed && LOGIN_RE.test(trimmed) ? trimmed : null;
}

/**
 * The GitBanners URL for a card, or why there is none. Pure: the same match
 * and context always give the same answer.
 */
export function convertCard(
  match: CardMatch,
  context: ConvertContext,
): Conversion {
  const unsupported = NO_EQUIVALENT[match.kind];
  if (unsupported) return { ok: false, reason: unsupported };
  const preset = PRESET[match.kind];
  if (!preset) return { ok: false, reason: "This card has no equivalent." };
  const { params } = match;

  const b: Builder = {
    options: {},
    colors: {},
    carried: [],
    used: new Set(),
    notes: [],
  };

  let target: BannerTarget;
  if (match.kind === "repo-card" || match.kind === "pin") {
    const owner = login(match.repo?.owner ?? params.get("username"));
    const name = (match.repo?.name ?? params.get("repo") ?? "").trim();
    if (!owner || !REPO_NAME_RE.test(name)) {
      return {
        ok: false,
        reason:
          "The URL does not name a repository as owner and name, so there is nothing to point a banner at.",
      };
    }
    target = { kind: "repo", owner, name };
  } else {
    const named = params.get(
      match.service === "streak-stats" ? "user" : "username",
    );
    const own = login(named);
    if (named?.trim() && !own) {
      return {
        ok: false,
        reason: `"${named.trim()}" is not a GitHub username, so the card is left as it is.`,
      };
    }
    const fallback = own ? null : login(context.login);
    if (!own && !fallback) {
      return {
        ok: false,
        reason:
          "The URL names no GitHub user. Enter your username above and the doctor fills it in.",
      };
    }
    if (fallback)
      b.notes.push(`The URL names no user, so ${fallback} is used.`);
    target = { kind: "owner", login: own ?? fallback ?? "" };
  }

  switch (match.service) {
    case "readme-stats":
    case "readme-stats-copy": {
      readmeStatsColors(b, params);
      common(b, params);
      if (match.kind === "stats") statsList(b, params);
      if (match.kind === "top-langs") {
        const count = int(params.get("langs_count"));
        if (count !== null && count >= 1) {
          b.used.add("langs_count");
          b.options.count = Math.min(count, OPTION_LIMITS.count.max);
          b.carried.push(`langs_count → count=${b.options.count}`);
        }
      }
      break;
    }
    case "streak-stats": {
      color(b, params, "background", "bg");
      color(b, params, "border", "border");
      color(b, params, "ring", "accent");
      color(b, params, "fire", "accent");
      color(b, params, "currstreaknum", "text");
      color(b, params, "sidenums", "text");
      color(b, params, "sidelabels", "muted");
      color(b, params, "dates", "muted");
      common(b, params);
      break;
    }
    case "trophy": {
      flag(b, params, "no-frame", () => {
        b.options.border = false;
        return "border=0";
      });
      break;
    }
    case "activity-graph": {
      color(b, params, "bg_color", "bg");
      color(b, params, "color", "text");
      color(b, params, "title_color", "accent");
      color(b, params, "line", "accent");
      common(b, params);
      const radius = int(params.get("radius"));
      if (radius !== null && b.options.radius === undefined) {
        b.used.add("radius");
        b.options.radius = Math.min(radius, OPTION_LIMITS.radius.max);
        b.carried.push(`radius → radius=${b.options.radius}`);
      }
      break;
    }
    case "summary-cards":
    case "gh-card":
      break;
  }

  // Light hints from a fragment GitHub honours: `#gh-light-mode-only`.
  const fragment = /^#gh-(light|dark)-mode-only$/i.exec(match.hash)?.[1];
  const mode =
    context.mode ?? (fragment?.toLowerCase() as ModeHint | undefined);
  theme(b, params, mode);
  if (Object.keys(b.colors).length > 0) b.options.colors = b.colors;

  const query = serializeOptions(b.options);
  const path = bannerPath(target, { preset, format: match.format, query });
  const dropped = [...params.keys()]
    .filter((key) => !IDENTITY.has(key) && !b.used.has(key))
    .map((key) => match.keys.get(key) ?? key);
  return {
    ok: true,
    url: `${context.origin}${path}${match.hash}`,
    carried: b.carried,
    dropped,
    notes: b.notes,
  };
}
