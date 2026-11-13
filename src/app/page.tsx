import type { Metadata } from "next";
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
import { home } from "@/content/home";

export const metadata: Metadata = {
  title: { absolute: home.title },
  description: home.description,
  alternates: {
    canonical: "/",
    types: { "text/markdown": "/index.md" },
  },
};

/**
 * The homepage. A static shell: the copy, the first banner and the gallery
 * are in the server HTML, and the provider around them holds the one piece
 * of state the interactive parts share (which banner is on screen).
 */
export default function Home() {
  return (
    <HomePreviewProvider>
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
