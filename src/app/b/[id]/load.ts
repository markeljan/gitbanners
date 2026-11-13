import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { BANNER_ID_RE, getBanner, type SavedBanner } from "@/lib/db/banners";
import { entityCacheTag } from "@/lib/http/cache-headers";

/** What the public page of a saved banner may show: never the owner's id. */
export type PublicBanner = Pick<
  SavedBanner,
  "id" | "name" | "target" | "preset" | "query" | "updatedAt"
>;

async function load(id: string): Promise<PublicBanner | null> {
  "use cache: remote";
  // The tag the account API purges on every rename, edit and delete, so the
  // page follows the record as closely as the image does.
  cacheTag(entityCacheTag("saved", id));
  const banner = await getBanner(id);
  if (!banner) {
    // Short, but never shorter than `minutes`: that would make this
    // `ensureStatic` page answer 500 (see src/lib/github/cached.ts).
    cacheLife("minutes");
    return null;
  }
  cacheLife("github");
  return {
    id: banner.id,
    name: banner.name,
    target: banner.target,
    preset: banner.preset,
    query: banner.query,
    updatedAt: banner.updatedAt,
  };
}

/**
 * The saved banner behind `/b/{id}`, or `null`. Ids that cannot exist are
 * refused before the cache, so junk URLs leave no entries behind.
 */
export function loadSavedBanner(id: string): Promise<PublicBanner | null> {
  return BANNER_ID_RE.test(id) ? load(id) : Promise.resolve(null);
}
