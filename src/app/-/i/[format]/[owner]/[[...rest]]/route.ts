/**
 * Banner images.
 *
 * Public URLs are rewritten here by next.config.ts:
 *
 *   /{owner}.svg                     -> /-/i/svg/{owner}
 *   /{owner}/{preset}.png            -> /-/i/png/{owner}/{preset}
 *   /{owner}/{repo}/{preset}.svg     -> /-/i/svg/{owner}/{repo}/{preset}
 *   /embed/{owner}[/...]             -> /-/i/auto/{owner}[/...]
 *   /{owner}[/...] requested by <img> -> /-/i/auto/{owner}[/...]
 *
 * The answer is always an image and always `200`: unknown targets and
 * upstream failures are drawn as cards (see `@/lib/render/respond`).
 */
import type { NextRequest } from "next/server";
import {
  type BannerOptions,
  type ImageFormat,
  parseBannerPath,
  parseOptions,
  QUERY_KEYS,
} from "@/lib/banner";
import { getDefaultBanner } from "@/lib/db/banners";
import { CACHE, entityCacheTag } from "@/lib/http/cache-headers";
import { methodNotAllowed, notFound } from "@/lib/http/problem";
import { getEntitlements } from "@/lib/pro";
import { renderBanner } from "@/lib/render/banner";
import {
  bannerResponse,
  negotiateFormat,
  parseScale,
  targetCacheTags,
} from "@/lib/render/respond";
import { storeIsDurable } from "@/lib/store";

interface Context {
  params: Promise<{ format: string; owner: string; rest?: string[] }>;
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

interface Chosen {
  preset: string | null;
  overrides: Partial<BannerOptions>;
  pro: boolean;
  tags: string[];
}

/**
 * The banner a Pro user chose for their bare vanity URL (`/{login}.svg`).
 * `null` for everyone else, and whenever the store cannot be asked: the
 * default banner must never depend on it.
 */
async function vanityDefault(login: string): Promise<Chosen | null> {
  try {
    if (!storeIsDurable()) return null;
    const found = await getDefaultBanner(login);
    const banner = found?.banner;
    if (!found || !banner) return null;
    if (
      banner.target.kind !== "owner" ||
      banner.target.login.toLowerCase() !== login.toLowerCase()
    ) {
      return null;
    }
    const entitlements = await getEntitlements(found.userId);
    if (!entitlements.canSetDefault) return null;
    const overrides = parseOptions(new URLSearchParams(banner.query));
    if (!entitlements.canHideBrand) overrides.brand = true;
    if (!entitlements.canAnimate) overrides.animate = false;
    return {
      preset: banner.preset,
      overrides,
      pro: true,
      tags: [entityCacheTag("saved", banner.id)],
    };
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  const params = await context.params;
  const negotiated = params.format === "auto";
  if (!negotiated && params.format !== "svg" && params.format !== "png") {
    return notFound("Unknown image format.", {
      instance: request.nextUrl.pathname,
    });
  }
  const parsed = parseBannerPath(
    [params.owner, ...(params.rest ?? [])].map(decode),
  );
  if (!parsed) {
    return notFound("This is not a banner URL.", {
      instance: request.nextUrl.pathname,
      resolution:
        "Use /{owner}.svg, /{owner}/{preset}.svg or /{owner}/{repo}.svg.",
    });
  }
  const format: ImageFormat = negotiated
    ? negotiateFormat(request.headers.get("accept"))
    : (params.format as ImageFormat);

  const query = request.nextUrl.searchParams;
  let chosen: Chosen = {
    preset: parsed.preset,
    overrides: parseOptions(query),
    pro: false,
    tags: [],
  };
  // Only the bare vanity URL: any banner option in the query, even one that
  // spells out a default (`?theme=github-dark`), asks for exactly that.
  if (
    parsed.target.kind === "owner" &&
    parsed.preset === null &&
    !QUERY_KEYS.some((key) => query.has(key))
  ) {
    chosen = (await vanityDefault(parsed.target.login)) ?? chosen;
  }

  const rendered = await renderBanner({
    target: parsed.target,
    preset: chosen.preset,
    overrides: chosen.overrides,
    format,
    pro: chosen.pro,
    scale: parseScale(query.get("scale")) ?? undefined,
    signal: request.signal,
  });
  const { target } = parsed;
  return bannerResponse(rendered, {
    format,
    tags: [...targetCacheTags(target), ...chosen.tags],
    name:
      target.kind === "owner"
        ? [target.login, rendered.options?.preset ?? chosen.preset]
        : [
            target.owner,
            target.name,
            rendered.options?.preset ?? chosen.preset,
          ],
    download: query.get("download") === "1",
    negotiated,
    policy: chosen.pro ? CACHE.bannerPro : CACHE.banner,
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
