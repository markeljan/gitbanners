import type { Metadata } from "next";
import { ContentPageView } from "@/components/content/content-page";
import { JsonLd } from "@/components/content/json-ld";
import { DocsEnhancer } from "@/components/docs/docs-enhancer";
import { UrlBuilder } from "@/components/docs/url-builder";
import { docs } from "@/content/docs";
import { pageJsonLd } from "@/lib/agent/jsonld";
import { pageMetadata } from "@/lib/agent/metadata";
import { site } from "@/lib/site";

export const metadata: Metadata = pageMetadata(docs);

/**
 * /docs: static, rendered from the same copy as /docs.md. The URL builder
 * and the reading aids are client islands on top of the server HTML.
 */
export default function DocsPage() {
  return (
    <>
      <JsonLd data={pageJsonLd(docs)} />
      <ContentPageView
        page={docs}
        headingLinks
        slots={{
          "cheat-sheet": <UrlBuilder initialTarget={site.exampleLogin} />,
        }}
      />
      <DocsEnhancer />
    </>
  );
}
