import type { Metadata } from "next";
import { JsonLd } from "@/components/content/json-ld";
import { Hero } from "@/components/home/hero";
import { HomePreviewProvider } from "@/components/home/preview";
import {
  Agents,
  Faq,
  Migrate,
  Pricing,
  Readme,
  Showcase,
  Sizes,
  Themes,
  UrlPatterns,
} from "@/components/home/sections";
import { FAQ } from "@/content/faq";
import { home } from "@/content/home";
import { homeJsonLd } from "@/lib/agent/jsonld";
import { pageMetadata } from "@/lib/agent/metadata";

export const metadata: Metadata = pageMetadata(home);

/**
 * The homepage. A static shell: the copy, the first banner and the gallery
 * are in the server HTML, and the provider around them holds the one piece
 * of state the interactive parts share (which banner is on screen).
 */
export default function Home() {
  return (
    <HomePreviewProvider>
      <JsonLd data={homeJsonLd(FAQ)} />
      <Hero heading={home.heading} lead={home.lead} />
      <UrlPatterns />
      <Showcase />
      <Sizes />
      <Themes />
      <Readme />
      <Migrate />
      <Pricing />
      <Agents />
      <Faq />
    </HomePreviewProvider>
  );
}
