import type { Metadata } from "next";
import { ContentPageView } from "@/components/content/content-page";
import { JsonLd } from "@/components/content/json-ld";
import { privacy } from "@/content/privacy";
import { pageJsonLd } from "@/lib/agent/jsonld";
import { pageMetadata } from "@/lib/agent/metadata";

export const metadata: Metadata = pageMetadata(privacy);

/** /privacy: static, rendered from the same copy as /privacy.md. */
export default function PrivacyPage() {
  return (
    <>
      <JsonLd data={pageJsonLd(privacy)} />
      <ContentPageView page={privacy} />
    </>
  );
}
