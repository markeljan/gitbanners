import type { Metadata } from "next";
import { ContentPageView } from "@/components/content/content-page";
import { JsonLd } from "@/components/content/json-ld";
import { FAQ } from "@/content/faq";
import { home } from "@/content/home";
import { homeJsonLd } from "@/lib/agent/jsonld";
import { pageMetadata } from "@/lib/agent/metadata";

export const metadata: Metadata = pageMetadata(home);

/**
 * The homepage as plain content: the copy and the FAQ, rendered from the
 * same objects as /index.md. The interactive version replaces this file.
 */
export default function Home() {
  return (
    <>
      <JsonLd data={homeJsonLd(FAQ)} />
      <ContentPageView page={home} faq={FAQ} toc={false} />
    </>
  );
}
