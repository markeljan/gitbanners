/**
 * The pages a crawler should know about: every content page, and the page
 * of each account and repository the showcase features.
 *
 * Deliberately not "every banner ever requested": the URL space is
 * unbounded, and thousands of near-identical pages are a quality risk.
 * Pages that are personal (the dashboard) or internal are left out.
 */
import { CONTENT_PAGES, CONTENT_UPDATED } from "@/content/pages";
import { SHOWCASE } from "@/content/showcase";
import { bannerPath, parseBannerPath } from "@/lib/banner";

export interface SitePage {
  /** Site-relative path. */
  path: string;
  /** ISO date of the last change. */
  updated: string;
  changeFrequency: "daily" | "weekly" | "monthly";
  priority: number;
  /** A banner page: its preview image is worth listing too. */
  banner: boolean;
}

/** Legal pages change rarely and matter less to a searcher than the product pages. */
const LEGAL = new Set(["/privacy", "/terms"]);

function contentPages(): SitePage[] {
  return CONTENT_PAGES.map((page) => ({
    path: page.path,
    updated: page.updated,
    changeFrequency:
      page.path === "/" ? "daily" : LEGAL.has(page.path) ? "monthly" : "weekly",
    priority: page.path === "/" ? 1 : LEGAL.has(page.path) ? 0.3 : 0.7,
    banner: false,
  }));
}

/** The page of every showcase target, once, whatever presets the showcase shows. */
export function showcasePaths(): string[] {
  const paths = new Set<string>();
  for (const item of SHOWCASE) {
    const [pathname] = item.path.split("?");
    const parsed = parseBannerPath(pathname.split("/").filter(Boolean));
    if (parsed) paths.add(bannerPath(parsed.target));
  }
  return [...paths];
}

export function sitePages(): SitePage[] {
  return [
    ...contentPages(),
    ...showcasePaths().map((path) => ({
      path,
      // Banner pages follow GitHub; the date says when the page itself last changed.
      updated: CONTENT_UPDATED,
      changeFrequency: "daily" as const,
      priority: 0.5,
      banner: true,
    })),
  ];
}
