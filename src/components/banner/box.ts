import {
  type BannerTarget,
  bannerPath,
  buildBanner,
  canonicalQuery,
  demoEntity,
  type EntityKind,
  type ImageFormat,
  parseBannerPath,
  parseOptions,
  resolveOptions,
} from "@/lib/banner";
import { getSample } from "@/lib/github/samples";
import { bannerNow } from "./build";

/**
 * Turns a relative banner path, as written in content and showcase data
 * (`/vercel/next.js/activity`, `/torvalds?size=x`), into everything an
 * `<img>` needs: canonical URLs and a box to reserve.
 */
export interface BannerRef {
  target: BannerTarget;
  /** Preset from the path, `null` for the default one. */
  preset: string | null;
  /** Canonical option query without "?". */
  query: string;
  /** Page of the target: `/vercel/next.js`. */
  page: string;
  /** Canonical image URL for a format, relative to the site root. */
  image(format: ImageFormat): string;
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Parses a relative banner path. `null` when it is not a banner URL. */
export function parseBannerRef(path: string): BannerRef | null {
  const [pathname = "", search = ""] = path.split("?");
  const segments = pathname.split("/").filter(Boolean).map(decode);
  const parsed = parseBannerPath(segments);
  if (!parsed) return null;
  const { target, preset } = parsed;
  const query = canonicalQuery(search);
  return {
    target,
    preset,
    query,
    page: bannerPath(target),
    image: (format) => bannerPath(target, { preset, format, query }),
  };
}

/**
 * Stand-in for the site host while measuring. Some layouts give the brand
 * mark a line of its own, so an empty host would measure a shorter banner
 * than the one the image route draws; the text itself does not matter.
 */
const LAYOUT_HOST = "gitbanners.example";

/**
 * The size a banner will have, without asking GitHub.
 *
 * Fixed canvases (X header, link preview, …) are exact. README cards grow
 * with their content, so the height is taken from the bundled sample of the
 * target when there is one and from the demo entity of the same kind
 * otherwise: close enough to reserve the space, and the image is fitted into
 * that box, so a few pixels of difference never move the page.
 *
 * @param kind What the owner is, when the caller knows: an owner path alone
 *   does not say whether it is a user or an organization. Ignored for
 *   repositories and for targets with a bundled sample.
 */
export function estimateBannerBox(
  ref: Pick<BannerRef, "target" | "preset" | "query">,
  kind?: EntityKind,
): { width: number; height: number } {
  const sample = getSample(ref.target);
  const fallbackKind: EntityKind =
    ref.target.kind === "repo" ? "repo" : kind === "org" ? "org" : "user";
  const entity = sample ?? demoEntity(fallbackKind);
  const options = resolveOptions(
    entity.kind,
    ref.preset,
    parseOptions(new URLSearchParams(ref.query)),
  );
  const built = buildBanner(entity, options, {
    image: () => "",
    now: bannerNow(entity),
    host: LAYOUT_HOST,
  });
  return { width: built.width, height: built.height };
}
