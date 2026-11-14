import {
  type BannerOptions,
  type BuiltBanner,
  buildBanner,
} from "@/lib/banner";
import type { Entity } from "@/lib/github/schema";
import { browserImage } from "./scale";

/**
 * "Now" for a banner drawn in the browser: the moment its data was fetched.
 *
 * It must not be the wall clock. A banner is rendered on the server and
 * again during hydration, and streak labels depend on the date, so both
 * renders have to agree; the fetch time is the same on both sides and is
 * also the instant the numbers were true.
 */
export function bannerNow(entity: Entity): Date {
  const fetched = new Date(entity.fetchedAt);
  return Number.isNaN(fetched.getTime()) ? new Date(0) : fetched;
}

/**
 * Builds a banner for mounting as DOM: avatars come straight from GitHub's
 * CDN at twice the drawn size.
 *
 * @param host Host printed in the brand mark. Pass `useSiteHost()`: the
 *   canonical host as the server resolved it.
 */
export function buildBrowserBanner(
  entity: Entity,
  options: BannerOptions,
  host: string,
  now: Date = bannerNow(entity),
): BuiltBanner {
  return buildBanner(entity, options, { image: browserImage, now, host });
}
