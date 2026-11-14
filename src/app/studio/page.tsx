import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Studio } from "@/components/studio/studio";
import { StudioFallback } from "@/components/studio/studio-fallback";
import { pageMetadata } from "@/lib/agent/metadata";
import "@/components/studio/studio.css";

export const metadata: Metadata = pageMetadata({
  path: "/studio",
  title: "Banner studio",
  description:
    "Compose a live GitHub banner for a profile, repository or organization: pick a preset, size and theme, tune colours and content, then copy the URL or download the image.",
  markdown: false,
});

/**
 * /studio: a static shell. The editor reads its state from the address
 * (`useSearchParams`), so it renders in the browser inside Suspense and the
 * page stays prerendered for every query string.
 */
export default function StudioPage() {
  return (
    <div className="gb-studio-page">
      <div className="gb-studio-intro">
        <Heading level={1}>Banner studio</Heading>
        <Text type="supporting" color="secondary">
          Every change is in the address bar: share the link to share the
          banner.
        </Text>
      </div>
      <Suspense fallback={<StudioFallback />}>
        <Studio />
      </Suspense>
    </div>
  );
}
