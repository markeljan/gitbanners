import type { Metadata } from "next";
import { JsonLd } from "@/components/content/json-ld";
import { PricingPageView } from "@/components/pricing/pricing-page";
import { pricing } from "@/content/pricing";
import { pageJsonLd } from "@/lib/agent/jsonld";
import { pageMetadata } from "@/lib/agent/metadata";

export const metadata: Metadata = pageMetadata(pricing);

/** /pricing: static, rendered from the same copy as /pricing.md. */
export default function PricingPage() {
  return (
    <>
      <JsonLd data={pageJsonLd(pricing)} />
      <PricingPageView />
    </>
  );
}
