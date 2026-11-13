import type { MetadataRoute } from "next";
import { previewImagePath } from "@/lib/agent/metadata";
import { type SitePage, sitePages } from "@/lib/agent/site-pages";
import { parseBannerPath } from "@/lib/banner";
import { hasPageData } from "@/lib/github/cached";
import { absoluteUrl } from "@/lib/site";

/** A banner page whose data this deployment can get (see `hasPageData`). */
function buildable(page: SitePage): boolean {
  if (!page.banner) return true;
  const parsed = parseBannerPath(page.path.split("/").filter(Boolean));
  return parsed === null || hasPageData(parsed.target);
}

/**
 * /sitemap.xml. Every entry carries `lastmod`. Repository pages are listed
 * only when this deployment can build them: without a GitHub token they
 * could only say that GitHub is not answering.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return sitePages()
    .filter(buildable)
    .map((page) => ({
      url: absoluteUrl(page.path),
      lastModified: page.updated,
      changeFrequency: page.changeFrequency,
      priority: page.priority,
      ...(page.banner
        ? { images: [absoluteUrl(previewImagePath(page.path))] }
        : {}),
    }));
}
