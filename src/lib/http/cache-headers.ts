/**
 * Cache headers for PUBLIC, cookie-less GET responses (banner images, public JSON).
 *
 * - `Cache-Control`            → browsers and downstream shared caches (GitHub's camo
 *                                 image proxy forwards it). Sent verbatim because a
 *                                 targeted header is also present.
 * - `Vercel-CDN-Cache-Control` → Vercel CDN only; consumed there, never sent to clients.
 * - `Vercel-Cache-Tag`         → purge handle (≤128 tags, ≤256 bytes each, no commas).
 *
 * With only `Cache-Control: s-maxage=…` Vercel would strip the directive and hand
 * clients `max-age=0`, i.e. one request to us per README view.
 */
export type CachePolicy = {
  /** Seconds a browser / camo may reuse the response without asking us. */
  downstream: number;
  /** Seconds the Vercel CDN treats the response as fresh. */
  edge: number;
  /** Seconds the Vercel CDN may serve stale while it re-renders in the background. */
  swr: number;
  /** Seconds the Vercel CDN may serve stale if the function errors. */
  sie: number;
};

export const CACHE = {
  /** Banner images: at most ~25 minutes behind GitHub at the edge plus 10 in camo. */
  banner: { downstream: 600, edge: 900, swr: 86_400, sie: 604_800 },
  /** Saved Pro banners are redrawn sooner at the edge (from the same data). */
  bannerPro: { downstream: 120, edge: 300, swr: 3_600, sie: 604_800 },
  /** Markdown and other negotiated documents. */
  document: { downstream: 0, edge: 900, swr: 86_400, sie: 604_800 },
  /** Unknown owner / repo: cacheable so typos do not hit GitHub repeatedly. */
  notFound: { downstream: 60, edge: 300, swr: 0, sie: 0 },
  /** Rendered error cards for transient upstream failures. */
  unavailable: { downstream: 0, edge: 30, swr: 0, sie: 0 },
  /** Drawn while GitHub was still computing part of the data: look again soon. */
  provisional: { downstream: 60, edge: 60, swr: 600, sie: 604_800 },
  /** Public JSON from the data API. */
  api: { downstream: 60, edge: 300, swr: 3_600, sie: 86_400 },
  /** Typeahead suggestions. */
  search: { downstream: 300, edge: 900, swr: 86_400, sie: 86_400 },
} as const satisfies Record<string, CachePolicy>;

const TAG_MAX_BYTES = 256;

/** Cache tag for everything derived from one GitHub owner or repository. */
export function entityCacheTag(
  kind: "owner" | "repo" | "saved",
  id: string,
): string {
  const tag = `gb:${kind}:${id.toLowerCase().replace(/[,\s]/g, "")}`;
  if (new TextEncoder().encode(tag).length > TAG_MAX_BYTES) {
    throw new Error(`cache tag too long: ${tag}`);
  }
  return tag;
}

export function publicCacheHeaders(
  policy: CachePolicy,
  tags: readonly string[] = [],
): Record<string, string> {
  const downstream = ["public", `max-age=${policy.downstream}`];
  if (policy.downstream > 0) downstream.push(`s-maxage=${policy.downstream}`);

  const edge = [`max-age=${policy.edge}`];
  if (policy.swr > 0) edge.push(`stale-while-revalidate=${policy.swr}`);
  if (policy.sie > 0) edge.push(`stale-if-error=${policy.sie}`);

  const headers: Record<string, string> = {
    "Cache-Control": downstream.join(", "),
    "Vercel-CDN-Cache-Control": edge.join(", "),
  };
  if (tags.length > 0)
    headers["Vercel-Cache-Tag"] = tags.slice(0, 128).join(",");
  return headers;
}

/** Anything personalised, cookie-dependent or rate-limited per client. */
export const PRIVATE_NO_STORE = {
  "Cache-Control": "private, no-store",
} as const;

/**
 * Hardening for SVG served from our own origin: no scripts, no external
 * resources. (camo adds its own equivalent policy on github.com.)
 */
export const SVG_SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
  "X-Content-Type-Options": "nosniff",
} as const;
