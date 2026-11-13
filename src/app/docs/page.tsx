import type { Metadata } from "next";
import { ContentPageView } from "@/components/content/content-page";
import { JsonLd } from "@/components/content/json-ld";
import { docs } from "@/content/docs";
import { pageJsonLd } from "@/lib/agent/jsonld";
import { pageMetadata } from "@/lib/agent/metadata";

export const metadata: Metadata = pageMetadata(docs);

/** /docs: static, rendered from the same copy as /docs.md. */
export default function DocsPage() {
  return (
    <>
      <JsonLd data={pageJsonLd(docs)} />
      <ContentPageView page={docs} />
    </>
  );
}
