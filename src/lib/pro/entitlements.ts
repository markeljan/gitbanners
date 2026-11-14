/**
 * What each plan may do. Plain data with no server imports, so pricing pages
 * and the studio can show the same numbers the API enforces.
 */
export interface Entitlements {
  plan: "free" | "pro";
  /** How many banners the account may keep saved. */
  maxSavedBanners: number;
  /** May turn off the small site mark on saved banners. */
  canHideBrand: boolean;
  /** May use animated SVG output. */
  canAnimate: boolean;
  /** May choose the banner served at `/{login}`. */
  canSetDefault: boolean;
  /**
   * How long the CDN may serve a saved banner before it is drawn again
   * (`CACHE.banner.edge` / `CACHE.bannerPro.edge`). The GitHub data it is
   * drawn from has its own lifetime (`cacheLife("github")`), the same on
   * every plan, so copy must not sell this as fresher data.
   */
  refreshSeconds: number;
}

/** Everyone, signed in or not. Frozen: the objects are shared. */
export const FREE: Entitlements = Object.freeze({
  plan: "free",
  maxSavedBanners: 3,
  canHideBrand: false,
  canAnimate: false,
  canSetDefault: false,
  refreshSeconds: 900,
});

/** Signed-in users who starred the repository. */
export const PRO: Entitlements = Object.freeze({
  plan: "pro",
  maxSavedBanners: 50,
  canHideBrand: true,
  canAnimate: true,
  canSetDefault: true,
  refreshSeconds: 300,
});

/** The one place a Pro flag is turned into limits. */
export function entitlementsFor(pro: boolean): Entitlements {
  return pro ? PRO : FREE;
}
