/**
 * Markdown versions of pages.
 *
 * Public URLs are rewritten here by next.config.ts:
 *
 *   /index.md, or / with Accept: text/markdown       -> /-/md
 *   /docs.md, or /docs with Accept: text/markdown    -> /-/md/docs
 *   /vercel/next.js.md, or the page URL with Accept  -> /-/md/vercel/next.js
 *   any other path with Accept: text/markdown        -> /-/md/{path}
 *
 * A content page answers from the registry in `src/content`. A banner page
 * answers with a digest built from live GitHub data. Everything else is a
 * 404 in Markdown, with links an agent can continue from: a client that
 * asked for Markdown must not get an HTML error page back.
 *
 * Behind a rewrite the handler sees the original request URL; what the
 * rewrite decided arrives as route params.
 */
import type { NextRequest } from "next/server";
import { contentPage } from "@/content/pages";
import { DISCOVERY_LINKS } from "@/lib/agent/links";
import {
  contentDocument,
  entityDocument,
  notFoundDocument,
  presetExists,
  unavailableDocument,
} from "@/lib/agent/markdown";
import { ApiError } from "@/lib/api/errors";
import { describeBanner } from "@/lib/api/service";
import { bannerPath, parseBannerPath, targetLabel } from "@/lib/banner";
import { getEntity } from "@/lib/github/cached";
import { isGitHubError } from "@/lib/github/errors";
import {
  CACHE,
  type CachePolicy,
  publicCacheHeaders,
} from "@/lib/http/cache-headers";
import { methodGuards } from "@/lib/http/problem";
import { targetCacheTags } from "@/lib/render/respond";
import { absoluteUrl } from "@/lib/site";

interface Context {
  params: Promise<{ path?: string[] }>;
}

// Exporting the refusals also keeps this handler out of build-time
// prerendering, where it would lose the `Vary: Accept` it must send.
const { notAllowed, options } = methodGuards(["GET"]);
export {
  notAllowed as DELETE,
  notAllowed as PATCH,
  notAllowed as POST,
  notAllowed as PUT,
  options as OPTIONS,
};

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

interface Answer {
  status?: number;
  /** Absolute URL of the HTML page this document is a version of. */
  canonical?: string;
  /** Further `Link` relations, sent after the canonical one. */
  links?: readonly string[];
  /** How long caches may keep the answer. Left out: not at all. */
  cache?: CachePolicy;
  tags?: readonly string[];
  headers?: Record<string, string>;
}

function markdown(body: string, answer: Answer = {}): Response {
  const status = answer.status ?? 200;
  const links = [
    ...(answer.canonical ? [`<${answer.canonical}>; rel="canonical"`] : []),
    ...(answer.links ?? []),
  ];
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // The same URL answers HTML to a browser.
      Vary: "Accept",
      "X-Content-Type-Options": "nosniff",
      ...(answer.cache
        ? publicCacheHeaders(answer.cache, answer.tags)
        : { "Cache-Control": "no-store" }),
      ...(links.length > 0 ? { Link: links.join(", ") } : {}),
      // An error document is not a page of the site.
      ...(status === 200 ? {} : { "X-Robots-Tag": "noindex" }),
      ...answer.headers,
    },
  });
}

export async function GET(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  const { path = [] } = await context.params;
  const segments = path.map(decode);
  const requested = request.nextUrl.pathname;

  const page = contentPage(`/${segments.join("/")}`);
  if (page) {
    return markdown(contentDocument(page), {
      canonical: absoluteUrl(page.path),
      // The homepage is where agents look for the machine-readable entry points.
      links: page.path === "/" ? DISCOVERY_LINKS : undefined,
      cache: CACHE.document,
    });
  }

  const parsed = parseBannerPath(segments);
  // An image suffix here would be the Markdown of an image: no such page.
  if (!parsed || parsed.format) {
    return markdown(notFoundDocument(requested), { status: 404 });
  }

  try {
    const banner = await describeBanner({
      target: targetLabel(parsed.target),
      preset: parsed.preset,
    });
    // Answered from the same cache entry `describeBanner` just filled.
    const entity = await getEntity(banner.target);
    if (!entity || !presetExists(entity.kind, parsed.preset)) {
      return markdown(notFoundDocument(requested), {
        status: 404,
        cache: CACHE.notFound,
      });
    }
    return markdown(entityDocument(entity, banner), {
      canonical: absoluteUrl(
        bannerPath(banner.target, { preset: banner.preset }),
      ),
      cache: CACHE.document,
      tags: targetCacheTags(banner.target),
    });
  } catch (caught) {
    const error =
      caught instanceof ApiError
        ? caught
        : isGitHubError(caught)
          ? ApiError.fromGitHub(caught)
          : null;
    if (error && error.status < 500) {
      // Unknown login, private repository, malformed name: not a page.
      return markdown(notFoundDocument(requested), {
        status: 404,
        cache: CACHE.notFound,
      });
    }
    if (error) {
      const wait = error.retryAfter ?? 30;
      return markdown(unavailableDocument(requested, wait), {
        status: 503,
        headers: { "Retry-After": String(wait) },
      });
    }
    console.error("[markdown] unexpected error", caught);
    return markdown(unavailableDocument(requested, 30), {
      status: 500,
    });
  }
}
