import "server-only";

import {
  type BannerOptions,
  buildBanner,
  DEFAULT_FONT_ID,
  DEFAULT_SIZE_ID,
  DEFAULT_THEME_ID,
  defaultPresetId,
  diffOptions,
  FONTS,
  HIDE_IDS,
  OPTION_LIMITS,
  PRESETS,
  presetsFor,
  resolveOptions,
  SECTION_IDS,
  SIZES,
  STAT_IDS,
  serializeOptions,
  stripProOptions,
  THEMES,
  targetOf,
} from "@/lib/banner";
import {
  bannerLinks,
  bannerSnippets,
  parseTargetSlug,
  targetSlug,
} from "@/lib/embed";
import {
  getEntity,
  getOwner,
  getOwnerPreview,
  getRepo,
  getSuggestions,
} from "@/lib/github/cached";
import { isValidYear, MIN_YEAR } from "@/lib/github/calendar";
import {
  type Entity,
  isValidLogin,
  isValidRepoName,
  type Owner,
  type Repo,
} from "@/lib/github/schema";
import { MIN_SEARCH_LENGTH, parseSearchQuery } from "@/lib/github/search";
import { site } from "@/lib/site";
import { ApiError } from "./errors";
import { PARAMETER_DOCS } from "./parameters";
import type { BannerDescription, OptionsCatalog, SearchResult } from "./schema";

/**
 * The public data operations, independent of the transport. The JSON API
 * routes and the MCP tools are thin wrappers around these functions, so both
 * answer the same thing for the same input. Failures are `ApiError`s (or a
 * `GitHubError` from the data layer, which both transports map by code).
 */

const LOGIN_HINT =
  "Pass a GitHub login such as vercel: 1 to 39 letters, digits or hyphens.";

function checkLogin(login: string): string {
  const value = login.trim().replace(/^@/, "");
  if (!isValidLogin(value)) {
    throw ApiError.invalid(
      "The login is not a valid GitHub username.",
      LOGIN_HINT,
    );
  }
  return value;
}

/** `?year=` as a number, `null` when absent. Throws for anything else. */
export function parseYear(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  const year = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(year) || !isValidYear(year, new Date())) {
    throw ApiError.invalid(
      "The year is out of range.",
      `Pass a calendar year between ${MIN_YEAR} and the current year, or omit it for the last 12 months.`,
    );
  }
  return year;
}

/**
 * A user or organization. `view: "preview"` answers from one upstream
 * request (profile and contribution calendar, `complete: false` for users).
 */
export async function getOwnerData(
  login: string,
  options: { year?: number | null; view?: "full" | "preview" } = {},
): Promise<Owner> {
  const key = checkLogin(login);
  const owner =
    options.view === "preview" && options.year == null
      ? await getOwnerPreview(key)
      : await getOwner(key, options.year ?? null);
  if (!owner) {
    throw ApiError.notFound(
      `No public GitHub user or organization is named ${key}.`,
    );
  }
  return owner;
}

/** A public repository. */
export async function getRepoData(owner: string, name: string): Promise<Repo> {
  const ownerKey = checkLogin(owner);
  const nameKey = name.trim().replace(/\.git$/i, "");
  if (!isValidRepoName(nameKey)) {
    throw ApiError.invalid(
      "The repository name is not valid.",
      "Pass the name as it appears on github.com, such as next.js.",
    );
  }
  const repo = await getRepo(ownerKey, nameKey);
  if (!repo) {
    throw ApiError.notFound(
      `No public repository is named ${ownerKey}/${nameKey}.`,
      "Check the owner and the name on github.com. Private repositories are not available.",
    );
  }
  return repo;
}

/** Typeahead: accounts for a login prefix, repositories for `owner/prefix`. */
export async function searchData(query: string): Promise<SearchResult> {
  const text = query.trim();
  if (text.length < MIN_SEARCH_LENGTH || text.length > 140) {
    throw ApiError.invalid(
      `The query must be ${MIN_SEARCH_LENGTH} to 140 characters long.`,
      "Pass the start of a login such as verc, or owner/prefix such as vercel/ne for repositories.",
    );
  }
  if (!parseSearchQuery(text)) return { query: text, suggestions: [] };
  return { query: text, suggestions: await getSuggestions(text) };
}

export interface DescribeBannerInput {
  /** `login` or `owner/name` (a github.com URL works too). */
  target: string;
  preset?: string | null;
  /** Options as parsed from a query string. */
  options?: Partial<BannerOptions>;
}

function titleOf(entity: Entity): string {
  if (entity.kind === "repo") return entity.fullName;
  return entity.name?.trim() || entity.login;
}

/**
 * URLs, embed snippets, dimensions and alt text of one banner, after
 * checking with GitHub that the target exists. Options that need Pro are
 * dropped: ad-hoc banner URLs never carry them.
 */
export async function describeBanner(
  input: DescribeBannerInput,
): Promise<BannerDescription> {
  const asked = parseTargetSlug(input.target);
  if (!asked) {
    throw ApiError.invalid(
      "The target is not a GitHub login or owner/name.",
      "Pass a login such as vercel, or a repository such as vercel/next.js.",
    );
  }
  const overrides = stripProOptions({ ...input.options });
  if (overrides.year != null) parseYear(overrides.year);
  if (asked.kind !== "owner") overrides.year = undefined;

  const entity = await getEntity(asked, overrides.year ?? null);
  if (!entity) {
    throw ApiError.notFound(
      asked.kind === "owner"
        ? `No public GitHub user or organization is named ${asked.login}.`
        : `No public repository is named ${targetSlug(asked)}.`,
    );
  }

  // GitHub's own capitalisation, and the new home of a renamed repository.
  const target = targetOf(entity);
  const options = resolveOptions(entity.kind, input.preset, overrides);
  const query = serializeOptions(diffOptions(entity.kind, options));
  const built = buildBanner(entity, options, {
    image: () => "",
    now: new Date(),
    host: new URL(site.url).host,
  });
  const links = bannerLinks({ target, preset: options.preset, query });
  return {
    target,
    slug: targetSlug(target),
    kind: entity.kind,
    title: titleOf(entity),
    preset: options.preset,
    query,
    width: built.width,
    height: built.height,
    alt: built.alt,
    links,
    snippets: bannerSnippets(links, built.alt, {
      width: options.size === DEFAULT_SIZE_ID ? null : built.width,
    }),
    presets: presetsFor(entity.kind).map((preset) => ({
      id: preset.id,
      name: preset.name,
      description: preset.description,
      svg: bannerLinks({ target, preset: preset.id }).svg,
    })),
  };
}

function presetPath(kind: Entity["kind"], id: string): string {
  const base = kind === "repo" ? "/{owner}/{repo}" : "/{owner}";
  return id === defaultPresetId(kind) ? base : `${base}/${id}`;
}

let catalog: OptionsCatalog | undefined;

/** Everything a banner URL can say. Static, so built once. */
export function optionsCatalog(): OptionsCatalog {
  catalog ??= {
    presets: PRESETS.map((preset) => ({
      id: preset.id,
      kind: preset.kind,
      name: preset.name,
      description: preset.description,
      sections: [...preset.sections],
      default: preset.id === defaultPresetId(preset.kind),
      path: presetPath(preset.kind, preset.id),
    })),
    themes: THEMES.map((theme) => ({
      id: theme.id,
      name: theme.name,
      mode: theme.mode,
      default: theme.id === DEFAULT_THEME_ID,
      colors: { ...theme.colors, heat: [...theme.colors.heat] },
    })),
    sizes: Object.values(SIZES).map((size) => ({
      id: size.id,
      name: size.name,
      description: size.description,
      width: size.width,
      height: size.height,
      default: size.id === DEFAULT_SIZE_ID,
    })),
    fonts: Object.values(FONTS).map((font) => ({
      id: font.id,
      name: font.name,
      default: font.id === DEFAULT_FONT_ID,
    })),
    sections: [...SECTION_IDS],
    stats: [...STAT_IDS],
    hide: [...HIDE_IDS],
    parameters: PARAMETER_DOCS.map((doc) => ({ ...doc })),
    limits: { ...OPTION_LIMITS },
  };
  return catalog;
}
