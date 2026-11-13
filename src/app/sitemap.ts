import type { MetadataRoute } from "next";
import { previewImagePath } from "@/lib/agent/metadata";
import { sitePages } from "@/lib/agent/site-pages";
import { absoluteUrl } from "@/lib/site";

/** /sitemap.xml. Every entry carries `lastmod`. */
export default function sitemap(): MetadataRoute.Sitemap {
  return sitePages().map((page) => ({
    url: absoluteUrl(page.path),
    lastModified: page.updated,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
    ...(page.banner
      ? { images: [absoluteUrl(previewImagePath(page.path))] }
      : {}),
  }));
}
