/**
 * Saved banners: `/b/{id}.svg` and `/b/{id}.png` (rewritten here by
 * next.config.ts). The banner's target, preset and options come from the
 * saved record; Pro options are honoured while its owner is on Pro.
 *
 * Like every image route it always answers `200` with an image.
 */
import type { NextRequest } from "next/server";
import { type ImageFormat, parseOptions } from "@/lib/banner";
import { BANNER_ID_RE, getBanner, type SavedBanner } from "@/lib/db/banners";
import { CACHE, entityCacheTag } from "@/lib/http/cache-headers";
import { methodNotAllowed, notFound } from "@/lib/http/problem";
import { getEntitlements } from "@/lib/pro";
import { FREE } from "@/lib/pro/entitlements";
import { renderBanner, renderMessage } from "@/lib/render/banner";
import {
  bannerResponse,
  parseScale,
  targetCacheTags,
} from "@/lib/render/respond";

interface Context {
  params: Promise<{ format: string; id: string }>;
}

type Lookup =
  | { state: "found"; banner: SavedBanner }
  | { state: "missing" }
  | { state: "unavailable" };

async function lookup(id: string): Promise<Lookup> {
  if (!BANNER_ID_RE.test(id)) return { state: "missing" };
  try {
    const banner = await getBanner(id);
    return banner ? { state: "found", banner } : { state: "missing" };
  } catch {
    return { state: "unavailable" };
  }
}

export async function GET(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  const params = await context.params;
  if (params.format !== "svg" && params.format !== "png") {
    return notFound("Unknown image format.", {
      instance: request.nextUrl.pathname,
    });
  }
  const format: ImageFormat = params.format;
  const query = request.nextUrl.searchParams;
  const scale = parseScale(query.get("scale")) ?? undefined;
  const download = query.get("download") === "1";
  const found = await lookup(params.id);

  if (found.state !== "found") {
    const missing = found.state === "missing";
    const rendered = await renderMessage({
      message: missing
        ? {
            title: "This saved banner no longer exists",
            detail: "Its owner deleted it, or the link is incomplete.",
          }
        : {
            title: "This banner is taking a short break",
            detail: "It refreshes on its own in a moment.",
          },
      state: missing ? "not_found" : "unavailable",
      format,
      scale,
    });
    return bannerResponse(rendered, {
      format,
      tags: missing ? [entityCacheTag("saved", params.id.slice(0, 64))] : [],
      name: ["banner"],
      download,
    });
  }

  const { banner } = found;
  const entitlements = await getEntitlements(banner.userId).catch(() => FREE);
  const overrides = parseOptions(new URLSearchParams(banner.query));
  if (!entitlements.canHideBrand) overrides.brand = true;
  if (!entitlements.canAnimate) overrides.animate = false;

  const rendered = await renderBanner({
    target: banner.target,
    preset: banner.preset,
    overrides,
    format,
    pro: true,
    scale,
    signal: request.signal,
  });
  const { target } = banner;
  return bannerResponse(rendered, {
    format,
    tags: [entityCacheTag("saved", banner.id), ...targetCacheTags(target)],
    name:
      target.kind === "owner"
        ? [target.login, rendered.options?.preset ?? banner.preset]
        : [
            target.owner,
            target.name,
            rendered.options?.preset ?? banner.preset,
          ],
    download,
    policy: entitlements.plan === "pro" ? CACHE.bannerPro : CACHE.banner,
  });
}

const ALLOW = ["GET", "HEAD", "OPTIONS"] as const;

function notAllowed(request: Request): Response {
  return methodNotAllowed(ALLOW, { instance: new URL(request.url).pathname });
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: ALLOW.join(", "),
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": ALLOW.join(", "),
    },
  });
}

export {
  notAllowed as DELETE,
  notAllowed as PATCH,
  notAllowed as POST,
  notAllowed as PUT,
};
