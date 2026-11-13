"use no memo";

import { defaultPresetId, OWNER_PRESET_IDS } from "@/lib/banner/presets";
import type {
  BannerTarget,
  ImageFormat,
  ParsedBannerPath,
} from "@/lib/banner/types";
import {
  type Entity,
  isValidLogin,
  isValidRepoName,
} from "@/lib/github/schema";
import { ownerFromSegment, ownerPath } from "@/lib/reserved";

/**
 * The URL grammar shared by pages, the image route, the API and the MCP
 * server:
 *
 *   /{owner}                    /{owner}/{preset}
 *   /{owner}/{repo}             /{owner}/{repo}/{preset}
 *
 * with an optional `.svg` / `.png` on the last segment and `@owner` for
 * logins that collide with one of the app's own routes.
 */

const IMAGE_SUFFIX = /\.(svg|png)$/i;
/**
 * Clone URLs end in ".git"; GitHub itself never lets a repository name end
 * that way, so every trailing ".git" goes ("repo.git.git" is "repo" too, and
 * parsing a printed path always gives the same name back).
 */
const GIT_SUFFIX = /(?:\.git)+$/i;
/** Preset ids are short slugs. Anything else in that position is not a banner URL. */
const PRESET_RE = /^[a-z][a-z0-9-]{0,39}$/;

function parseOwner(segment: string): string | null {
  const login = ownerFromSegment(segment);
  return login && isValidLogin(login) ? login : null;
}

function parseRepo(segment: string): string | null {
  const name = segment.replace(GIT_SUFFIX, "");
  return isValidRepoName(name) ? name : null;
}

/** A preset segment as presets are spelled: `Activity` is `activity`. */
function presetOf(segment: string): string {
  // Names reach this from entity data too; anything that is not text is no preset.
  return typeof segment === "string" ? segment.toLowerCase() : "";
}

/**
 * Parses URL-decoded path segments (everything after the origin).
 *
 * One segment is an owner. Two are an owner and a profile preset when the
 * second is one of `OWNER_PRESET_IDS`, otherwise an owner and a repository.
 * Three are owner, repository and preset. An image suffix is honoured on the
 * last segment only, so `next.js`, `socket.io` and `chart.js` keep their dots.
 * The preset is not checked against the entity kind here (the kind is only
 * known after GitHub answers): `resolveOptions` does that.
 *
 * Presets are matched without regard to case, like everything else in the
 * grammar: GitHub does not tell `Stats` from `stats`, so the two spellings
 * must not address different banners, and a capital letter in an embedded
 * image URL must not turn the image into a "not found" card. Logins and
 * repository names are passed on as written; GitHub resolves their case.
 *
 * Returns `null` for anything that cannot be a banner: no or too many
 * segments, a reserved first segment without "@", invalid characters.
 */
export function parseBannerPath(
  segments: readonly string[],
): ParsedBannerPath | null {
  // Route params are only typed: an optional catch-all hands over
  // `undefined` when the path ends early, and that is not a banner either.
  if (!Array.isArray(segments)) return null;
  if (segments.length < 1 || segments.length > 3) return null;
  if (segments.some((segment) => typeof segment !== "string" || !segment)) {
    return null;
  }
  const parts = [...segments];
  const last = parts[parts.length - 1];
  const suffix = IMAGE_SUFFIX.exec(last)?.[1]?.toLowerCase();
  const format = suffix === "svg" || suffix === "png" ? suffix : null;
  if (format) parts[parts.length - 1] = last.replace(IMAGE_SUFFIX, "");

  const [ownerSegment, second, third] = parts;
  const owner = parseOwner(ownerSegment);
  if (!owner) return null;

  if (second === undefined) {
    return { target: { kind: "owner", login: owner }, preset: null, format };
  }
  if (third === undefined && OWNER_PRESET_IDS.has(presetOf(second))) {
    return {
      target: { kind: "owner", login: owner },
      preset: presetOf(second),
      format,
    };
  }
  const name = parseRepo(second);
  if (!name) return null;
  const preset = third === undefined ? null : presetOf(third);
  if (preset !== null && !PRESET_RE.test(preset)) return null;
  return { target: { kind: "repo", owner, name }, preset, format };
}

/**
 * A name ending in ".md": as the last segment of a URL it asks for the
 * Markdown version of the page before it (next.config.ts rewrites it).
 */
const MARKDOWN_SUFFIX = /\.md$/i;

/**
 * True when `/{owner}/{name}` alone would be read as something else: a
 * profile preset (`stats`), or a name whose own ending looks like an image
 * suffix (`logo.svg`) or the Markdown suffix (`README.md`). Such
 * repositories are always written with their preset.
 */
function needsPresetSegment(name: string): boolean {
  return (
    OWNER_PRESET_IDS.has(presetOf(name)) ||
    IMAGE_SUFFIX.test(name) ||
    MARKDOWN_SUFFIX.test(name)
  );
}

/**
 * Canonical relative URL of a banner: lower-case owner, the `@` escape for
 * reserved logins, the default preset left out, then the image suffix and the
 * query. Parsing the result gives the same target, preset and format back.
 * A preset that could not be parsed back in that position (a repository
 * preset on a profile, a malformed id) is dropped rather than written.
 */
export function bannerPath(
  target: BannerTarget,
  opts: {
    preset?: string | null;
    format?: ImageFormat | null;
    query?: string;
  } = {},
): string {
  // Users and organizations share one default preset id, so the kind of an
  // owner does not need to be known to write its URL.
  const fallback = defaultPresetId(target.kind === "repo" ? "repo" : "user");
  const asked = presetOf(opts.preset ?? "");
  let path: string;
  if (target.kind === "repo") {
    const preset = PRESET_RE.test(asked) ? asked : fallback;
    path = `${ownerPath(target.owner.toLowerCase())}/${target.name}`;
    if (preset !== fallback || needsPresetSegment(target.name)) {
      path += `/${preset}`;
    }
  } else {
    const preset = OWNER_PRESET_IDS.has(asked) ? asked : fallback;
    path = ownerPath(target.login.toLowerCase());
    if (preset !== fallback) path += `/${preset}`;
  }
  if (opts.format) path += `.${opts.format}`;
  const query = (opts.query ?? "").replace(/^\?/, "");
  return query ? `${path}?${query}` : path;
}

/** How an entity is addressed in URLs. */
export function targetOf(entity: Entity): BannerTarget {
  return entity.kind === "repo"
    ? { kind: "repo", owner: entity.owner.login, name: entity.name }
    : { kind: "owner", login: entity.login };
}

/** "vercel" or "vercel/next.js": the slug people type and read. */
export function targetLabel(target: BannerTarget): string {
  return target.kind === "repo"
    ? `${target.owner}/${target.name}`
    : target.login;
}
