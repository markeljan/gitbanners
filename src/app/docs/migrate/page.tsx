import type { Metadata } from "next";
import { ContentPageView } from "@/components/content/content-page";
import { JsonLd } from "@/components/content/json-ld";
import { ReadmeDoctor } from "@/components/migrate/readme-doctor";
import { migrate } from "@/content/migrate";
import { pageJsonLd } from "@/lib/agent/jsonld";
import { pageMetadata } from "@/lib/agent/metadata";

export const metadata: Metadata = pageMetadata(migrate);

/**
 * /docs/migrate: the README doctor. A static shell with the tool as a client
 * island; the copy under it is the page's Markdown version too.
 */
export default function MigratePage() {
  return (
    <>
      <JsonLd data={pageJsonLd(migrate)} />
      <ContentPageView page={migrate} wide headingLinks toc={false}>
        <ReadmeDoctor />
      </ContentPageView>
    </>
  );
}
