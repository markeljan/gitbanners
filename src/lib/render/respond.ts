import "server-only";

import type { BannerTarget, ImageFormat } from "@/lib/banner";
import {
  CACHE,
  type CachePolicy,
  entityCacheTag,
  publicCacheHeaders,
  SVG_SECURITY_HEADERS,
} from "@/lib/http/cache-headers";
import type { BannerState, RenderedBanner } from "./banner";

/**
 * HTTP side of a rendered banner.
 *
 * Image responses are ALWAYS `200`: GitHub's image proxy (and most other
 * embedders) turn any other status into a broken-image icon, so "not found"
 * and "GitHub is down" are drawn as cards and told apart by their cache
 * lifetime and the `X-Banner-State` header instead.
 */

const POLICY: Record<BannerState, CachePolicy> = {
  ok: CACHE.banner,
  provisional: CACHE.provisional,
  not_found: CACHE.notFound,
  unavailable: CACHE.unavailable,
  error: CACHE.unavailable,
};

/** Cache tags of everything drawn from one banner target. */
export function targetCacheTags(target: BannerTarget): string[] {
  return target.kind === "owner"
    ? [entityCacheTag("owner", target.login)]
    : [
        entityCacheTag("repo", `${target.owner}/${target.name}`),
        entityCacheTag("owner", target.owner),
      ];
}

/** `auto` URLs (no extension): SVG unless the client only takes bitmaps. */
export function negotiateFormat(accept: string | null): ImageFormat {
  if (!accept) return "svg";
  const value = accept.toLowerCase();
  if (
    value.includes("image/svg+xml") ||
    value.includes("image/*") ||
    value.includes("*/*")
  ) {
    return "svg";
  }
  return /image\/(png|webp|avif|jpeg|apng)/.test(value) ? "png" : "svg";
}

/** `?scale=` for PNGs: 1 to 3, anything else is the default. */
export function parseScale(value: string | null): 1 | 2 | 3 | null {
  return value === "1" ? 1 : value === "2" ? 2 : value === "3" ? 3 : null;
}

function fileName(parts: readonly (string | null)[], format: string): string {
  const stem = parts
    .filter((part): part is string => Boolean(part))
    .join("-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .slice(0, 120);
  return `${stem || "banner"}.${format}`;
}

export interface BannerResponseInit {
  format: ImageFormat;
  /** Tags the CDN copy can be purged by. */
  tags: readonly string[];
  /** Words of the download name, e.g. `["vercel", "next.js", "activity"]`. */
  name: readonly (string | null)[];
  /** `?download=1`: ask the browser to save instead of display. */
  download?: boolean;
  /** The URL had no extension and the format came from `Accept`. */
  negotiated?: boolean;
  /** Cache policy for a successfully drawn banner. Default `CACHE.banner`. */
  policy?: CachePolicy;
}

export function bannerResponse(
  rendered: RenderedBanner,
  init: BannerResponseInit,
): Response {
  const policy =
    rendered.state === "ok"
      ? (init.policy ?? POLICY.ok)
      : POLICY[rendered.state];
  const headers = new Headers({
    "Content-Type": rendered.contentType,
    ...publicCacheHeaders(policy, init.tags),
    "Content-Disposition": `${init.download ? "attachment" : "inline"}; filename="${fileName(init.name, init.format)}"`,
    // Banners are meant to be embedded anywhere, canvases included.
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Banner-State": rendered.state,
  });
  if (init.format === "svg") {
    for (const [name, value] of Object.entries(SVG_SECURITY_HEADERS)) {
      headers.set(name, value);
    }
  }
  if (init.negotiated) headers.set("Vary", "Accept");
  const body: BodyInit =
    typeof rendered.body === "string"
      ? rendered.body
      : new Uint8Array(rendered.body);
  return new Response(body, { status: 200, headers });
}
