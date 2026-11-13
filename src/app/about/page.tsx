import type { Metadata } from "next";
import { ContentPageView } from "@/components/content/content-page";
import { JsonLd } from "@/components/content/json-ld";
import { about } from "@/content/about";
import { pageJsonLd } from "@/lib/agent/jsonld";
import { pageMetadata } from "@/lib/agent/metadata";

export const metadata: Metadata = pageMetadata(about);

/** /about: static, rendered from the same copy as /about.md. */
export default function AboutPage() {
  return (
    <>
      <JsonLd data={pageJsonLd(about)} />
      <ContentPageView page={about} />
    </>
  );
}
