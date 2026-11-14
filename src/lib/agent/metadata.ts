/**
 * One way to fill a page's metadata, so every page has a title, a
 * description, a canonical URL, Open Graph and X card tags, a preview image
 * and a pointer to its Markdown version.
 *
 * Next merges metadata shallowly: a page that sets `openGraph` replaces the
 * layout's whole object. That is why this helper always writes the complete
 * `openGraph` and `twitter` objects instead of a few fields.
 */
import type { Metadata } from "next";
import { site } from "@/lib/site";

/** Link previews are drawn at the Open Graph size. */
const PREVIEW = { width: 1200, height: 630 } as const;

/**
 * PNG of a banner at link-preview size. `bannerPath` is a relative banner
 * URL without extension, such as "/vercel/next.js/contributors".
 */
export function previewImagePath(bannerPath: string): string {
  const [pathname, query] = bannerPath.split("?");
  const params = new URLSearchParams(query ?? "");
  params.set("size", "og");
  return `${pathname}.png?${params}`;
}

/** Path of the Markdown version of a page: "/" is `/index.md`. */
export function markdownPath(path: string): string {
  return path === "/" ? "/index.md" : `${path}.md`;
}

export interface PageMetadataInput {
  /** Canonical, site-relative path of the page. */
  path: string;
  title: string;
  description: string;
  /**
   * The banner shown in link previews, as a relative banner URL without
   * extension. Default: the banner of the site's example profile.
   */
  banner?: { path: string; alt: string };
  /** Set to `false` for a page without a Markdown version. */
  markdown?: boolean;
  /** Keep the page out of search indexes (it stays crawlable). */
  noindex?: boolean;
  keywords?: readonly string[];
}

export function pageMetadata(input: PageMetadataInput): Metadata {
  const banner = input.banner ?? {
    path: `/${site.exampleLogin}`,
    alt: `GitHub banner for ${site.exampleLogin}, made with ${site.name}`,
  };
  const image = previewImagePath(banner.path);
  // The layout appends the site name; a title that already says it stands alone.
  const title = input.title.includes(site.name)
    ? { absolute: input.title }
    : input.title;
  const fullTitle = input.title.includes(site.name)
    ? input.title
    : `${input.title} · ${site.name}`;

  return {
    title,
    description: input.description,
    ...(input.keywords ? { keywords: [...input.keywords] } : {}),
    alternates: {
      canonical: input.path,
      ...(input.markdown === false
        ? {}
        : { types: { "text/markdown": markdownPath(input.path) } }),
    },
    openGraph: {
      type: "website",
      siteName: site.name,
      locale: "en_US",
      url: input.path,
      title: fullTitle,
      description: input.description,
      images: [{ url: image, ...PREVIEW, alt: banner.alt }],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description: input.description,
      images: [{ url: image, alt: banner.alt }],
    },
    robots: input.noindex
      ? { index: false, follow: true }
      : { index: true, follow: true },
  };
}
