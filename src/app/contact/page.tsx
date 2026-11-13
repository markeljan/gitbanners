import type { Metadata } from "next";
import { ContentPageView } from "@/components/content/content-page";
import { JsonLd } from "@/components/content/json-ld";
import { contact } from "@/content/contact";
import { pageJsonLd } from "@/lib/agent/jsonld";
import { pageMetadata } from "@/lib/agent/metadata";

export const metadata: Metadata = pageMetadata(contact);

/** /contact: static, rendered from the same copy as /contact.md. */
export default function ContactPage() {
  return (
    <>
      <JsonLd data={pageJsonLd(contact)} />
      <ContentPageView page={contact} />
    </>
  );
}
