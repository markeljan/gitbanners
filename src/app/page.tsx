import type { Metadata } from "next";
import { Hero } from "@/components/home/hero";
import { HomePreviewProvider } from "@/components/home/preview";
import { home } from "@/content/home";

export const metadata: Metadata = {
  title: { absolute: home.title },
  description: home.description,
  alternates: {
    canonical: "/",
    types: { "text/markdown": "/index.md" },
  },
};

export default function Home() {
  return (
    <HomePreviewProvider>
      <Hero heading={home.heading} lead={home.lead} />
    </HomePreviewProvider>
  );
}
