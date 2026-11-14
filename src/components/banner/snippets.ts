import type { BannerTarget, ImageFormat } from "@/lib/banner";
import {
  type BannerLinks,
  type BannerSnippets,
  bannerLinks,
  bannerSnippets,
} from "@/lib/embed";

/** The four ways a banner is embedded, in tab order. */
export const SNIPPET_KINDS = [
  { id: "markdown", label: "Markdown", copy: "Copy Markdown" },
  { id: "html", label: "HTML", copy: "Copy HTML" },
  { id: "picture", label: "Light and dark", copy: "Copy HTML" },
  { id: "url", label: "URL", copy: "Copy URL" },
] as const satisfies readonly {
  id: keyof BannerSnippets;
  label: string;
  copy: string;
}[];

export type SnippetKind = (typeof SNIPPET_KINDS)[number]["id"];

export interface SnippetInput {
  target: BannerTarget;
  /** Preset id, or `null` for the default of the target's kind. */
  preset?: string | null;
  /** Canonical option query without "?". */
  query?: string;
  /** Alt text of the banner (`buildBanner(…).alt`). */
  alt: string;
  /** Canonical origin to print (`useSiteOrigin()` in the browser). */
  origin: string;
  /** `width` attribute for the HTML snippets, when the banner is not README sized. */
  width?: number | null;
}

/**
 * Embed snippets of a banner in one image format. `bannerSnippets` always
 * prints the SVG URL; for PNG the same snippets are built around the PNG one.
 */
export function snippetsFor(
  input: SnippetInput,
  format: ImageFormat,
): { links: BannerLinks; snippets: BannerSnippets } {
  const links = bannerLinks({
    target: input.target,
    preset: input.preset,
    query: input.query,
    origin: input.origin,
  });
  const image = format === "png" ? links.png : links.svg;
  return {
    links,
    snippets: bannerSnippets({ ...links, svg: image }, input.alt, {
      width: input.width,
    }),
  };
}
