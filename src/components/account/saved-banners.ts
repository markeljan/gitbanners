/**
 * Saved banners as the browser sees them: parsing `/api/banners` bodies, the
 * pure list updates the dashboard applies optimistically, and the few facts
 * the UI prints about a banner. Isomorphic, no React.
 */
import { type BannerTarget, bannerPath, PRESETS } from "@/lib/banner";
import { bannerSnippets } from "@/lib/embed";

/** A saved banner, as `GET /api/banners` returns it. */
export interface SavedBanner {
  /** "b" + 11 base36 characters. */
  id: string;
  name: string;
  target: BannerTarget;
  /** Preset id, or `null` for the default of the target's kind. */
  preset: string | null;
  /** Canonical option query without "?". */
  query: string;
  /** Served at the owner's own `/{login}.svg`. */
  isDefault: boolean;
  /** ISO 8601. */
  createdAt: string;
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTarget(value: unknown): BannerTarget {
  if (isRecord(value)) {
    if (value.kind === "owner" && typeof value.login === "string") {
      return { kind: "owner", login: value.login };
    }
    if (
      value.kind === "repo" &&
      typeof value.owner === "string" &&
      typeof value.name === "string"
    ) {
      return { kind: "repo", owner: value.owner, name: value.name };
    }
  }
  throw new TypeError("Unexpected banner target");
}

/** Validates one saved banner of an API body. Throws when it is not one. */
export function parseSavedBanner(value: unknown): SavedBanner {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !(value.preset === null || typeof value.preset === "string") ||
    typeof value.query !== "string" ||
    typeof value.isDefault !== "boolean" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new TypeError("Unexpected saved banner");
  }
  return {
    id: value.id,
    name: value.name,
    target: parseTarget(value.target),
    preset: value.preset,
    query: value.query,
    isDefault: value.isDefault,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

/** Body of `GET /api/banners`: `{ banners: [...] }`. */
export function parseBannerList(body: unknown): SavedBanner[] {
  if (!isRecord(body) || !Array.isArray(body.banners)) {
    throw new TypeError("Unexpected /api/banners body");
  }
  return body.banners.map(parseSavedBanner);
}

/** Body of a `PATCH /api/banners/{id}` or `POST /api/banners`: `{ banner }`. */
export function parseBannerBody(body: unknown): SavedBanner {
  if (!isRecord(body)) throw new TypeError("Unexpected banner body");
  return parseSavedBanner(body.banner);
}

// ── Optimistic list updates ───────────────────────────────────────────────
// Every function returns a new array and leaves the order alone: a card the
// visitor is looking at never jumps away while they act on it.

export function renameBanner(
  list: readonly SavedBanner[],
  id: string,
  name: string,
): SavedBanner[] {
  return list.map((banner) =>
    banner.id === id ? { ...banner, name } : banner,
  );
}

export function removeBanner(
  list: readonly SavedBanner[],
  id: string,
): SavedBanner[] {
  return list.filter((banner) => banner.id !== id);
}

/**
 * Marks `id` as the profile default and every other banner as not, or clears
 * the default with `null`. There is at most one default per account.
 */
export function markDefault(
  list: readonly SavedBanner[],
  id: string | null,
): SavedBanner[] {
  return list.map((banner) => {
    const isDefault = banner.id === id;
    return banner.isDefault === isDefault ? banner : { ...banner, isDefault };
  });
}

/** Puts the server's copy of a banner in place of the optimistic one. */
export function replaceBanner(
  list: readonly SavedBanner[],
  next: SavedBanner,
): SavedBanner[] {
  return list.map((banner) => (banner.id === next.id ? next : banner));
}

/** Longest name the API accepts (`MAX_NAME_LENGTH` in `src/lib/db/banners`). */
export const MAX_NAME_LENGTH = 60;

/**
 * Why a draft name would be refused, as a sentence, or `null` when the API
 * accepts it: the same rules as the server, checked before the round trip.
 */
export function nameProblem(draft: string): string | null {
  const name = draft.trim();
  if (!name) return "Give the banner a name.";
  if (name.length > MAX_NAME_LENGTH) {
    return `Use at most ${MAX_NAME_LENGTH} characters.`;
  }
  if (/\p{Cc}/u.test(name)) return "Use one line of text.";
  return null;
}

// ── Facts for the UI ──────────────────────────────────────────────────────

/** "vercel" or "vercel/next.js". */
export function targetText(target: BannerTarget): string {
  return target.kind === "repo"
    ? `${target.owner}/${target.name}`
    : target.login;
}

/**
 * Name of the banner's preset. An owner may be a user or an organization,
 * which a saved banner does not record; the presets both kinds share have the
 * same name, so the first match is right either way.
 */
export function presetName(
  banner: Pick<SavedBanner, "target" | "preset">,
): string {
  const kinds =
    banner.target.kind === "repo" ? ["repo"] : (["user", "org"] as const);
  const id = banner.preset ?? "overview";
  const preset = PRESETS.find(
    (item) =>
      item.id === id && (kinds as readonly string[]).includes(item.kind),
  );
  return preset?.name ?? id;
}

/** Alt text for the banner image: what it shows, not what it is called. */
export function savedBannerAlt(
  banner: Pick<SavedBanner, "target" | "preset">,
): string {
  return `${presetName(banner)} banner for ${targetText(banner.target)}`;
}

/**
 * The profile default is honoured only for banners of the signed-in user's
 * own profile: `/{login}.svg` never serves a banner of someone else.
 */
export function isOwnProfile(
  banner: Pick<SavedBanner, "target">,
  login: string,
): boolean {
  return (
    banner.target.kind === "owner" &&
    banner.target.login.toLowerCase() === login.toLowerCase()
  );
}

/** Site-relative addresses of a saved banner. */
export function savedPaths(id: string): {
  page: string;
  svg: string;
  png: string;
} {
  return { page: `/b/${id}`, svg: `/b/${id}.svg`, png: `/b/${id}.png` };
}

/**
 * Embed snippets of a saved banner: its own `/b/{id}` image URL, linked to
 * the target's public page (the page people should land on from a README).
 * The light and dark `<picture>` is left out on purpose: a saved banner's
 * theme is part of the saved record and its URL takes no `theme` parameter.
 */
export function savedSnippets(
  banner: Pick<SavedBanner, "id" | "target" | "preset">,
  origin: string,
  format: "svg" | "png" = "svg",
): { markdown: string; html: string; url: string } {
  const base = origin.replace(/\/+$/, "");
  const paths = savedPaths(banner.id);
  const image = `${base}${format === "png" ? paths.png : paths.svg}`;
  const page = `${base}${bannerPath(banner.target)}`;
  const { markdown, html, url } = bannerSnippets(
    { page, svg: image, png: image, embed: image, studio: page },
    savedBannerAlt(banner),
  );
  return { markdown, html, url };
}

/**
 * Image URL for the dashboard grid. The version parameter changes whenever
 * the banner does, so an edit made in the studio shows up here at once
 * instead of after the browser's cached copy expires. The image route ignores
 * parameters it does not know.
 */
export function savedImageSrc(
  banner: Pick<SavedBanner, "id" | "updatedAt">,
): string {
  const version = Date.parse(banner.updatedAt);
  const path = savedPaths(banner.id).svg;
  return Number.isFinite(version) ? `${path}?v=${version.toString(36)}` : path;
}
