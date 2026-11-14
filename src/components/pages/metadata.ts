import type { Metadata } from "next";
import { pageMetadata } from "@/lib/agent/metadata";
import { altText, resolveOptions } from "@/lib/banner";
import { pageDescription, pageTitle } from "./copy";
import type { LoadedPage } from "./load";

/**
 * Title, description, canonical URL, Markdown alternate, Open Graph and X
 * card of an owner or repository page. The preview image is the page's own
 * banner as a 1200 by 630 PNG; its alt text says what the banner shows.
 * Pages outside the showcase are `noindex, follow`.
 */
export function entityMetadata(page: LoadedPage): Metadata {
  const { entity, preset, path, indexed } = page;
  const options = resolveOptions(entity.kind, preset.id, { size: "og" });
  // Same words as the image's own alt text, without building the banner.
  const alt = altText(entity, options);
  return pageMetadata({
    path,
    title: pageTitle(entity, preset),
    description: pageDescription(entity, preset),
    banner: { path, alt },
    noindex: !indexed,
  });
}
