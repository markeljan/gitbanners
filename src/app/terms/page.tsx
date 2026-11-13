import type { Metadata } from "next";
import { ContentPageView } from "@/components/content/content-page";
import { JsonLd } from "@/components/content/json-ld";
import { terms } from "@/content/terms";
import { pageJsonLd } from "@/lib/agent/jsonld";
import { pageMetadata } from "@/lib/agent/metadata";

export const metadata: Metadata = pageMetadata(terms);

/** /terms: static, rendered from the same copy as /terms.md. */
export default function TermsPage() {
  return (
    <>
      <JsonLd data={pageJsonLd(terms)} />
      <ContentPageView page={terms} />
    </>
  );
}
