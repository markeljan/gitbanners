"use client";

import { EmbedSnippets } from "@/components/banner/embed-snippets";
import { useHomePreview } from "./preview";

/** Embed snippets for whatever banner the hero currently shows. */
export function ReadmeSnippets() {
  const { target, preset, query, banner, options } = useHomePreview();
  return (
    <EmbedSnippets
      target={target}
      preset={preset}
      query={query}
      alt={banner.alt}
      width={options.size === "readme" ? null : banner.width}
    />
  );
}
