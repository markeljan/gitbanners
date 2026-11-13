import type { Metadata } from "next";
import { JsonLd } from "@/components/content/json-ld";
import { GALLERY, Gallery } from "@/components/pages/gallery";
import { collectionJsonLd } from "@/components/pages/jsonld";
import { SHOWCASE } from "@/content/showcase";
import { pageMetadata } from "@/lib/agent/metadata";

export const metadata: Metadata = pageMetadata({
  path: GALLERY.path,
  title: GALLERY.title,
  description: GALLERY.description,
  banner: { path: "/torvalds", alt: "GitHub banner for torvalds" },
  // No Markdown version of this page yet: do not point agents at one.
  markdown: false,
});

/** /gallery: static, rendered at build time. */
export default function GalleryPage() {
  return (
    <>
      <JsonLd
        data={collectionJsonLd({
          path: GALLERY.path,
          title: GALLERY.title,
          description: GALLERY.description,
          heading: GALLERY.heading,
          items: SHOWCASE.map((item) => ({
            name: item.title,
            path: item.path.split("?")[0] ?? item.path,
          })),
        })}
      />
      <Gallery />
    </>
  );
}
