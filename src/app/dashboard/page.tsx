import type { Metadata } from "next";
import { Dashboard } from "@/components/dashboard/dashboard";
import { Container } from "@/components/site/page";
import { pageMetadata } from "@/lib/agent/metadata";
import { githubSignInAvailable } from "@/lib/auth/env";
import { FREE, PRO } from "@/lib/pro/entitlements";
import { site } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  path: "/dashboard",
  title: "Dashboard",
  description: `Sign in with GitHub to keep your ${site.name} banners: ${FREE.maxSavedBanners} saved banners with stable links on the free plan, ${PRO.maxSavedBanners} with Pro, which costs one star.`,
  markdown: false,
});

/**
 * /dashboard: a static shell. Everything about the visitor (session, saved
 * banners, plan) is fetched by the client after hydration; the server HTML
 * is the signed-out explanation.
 *
 * Whether sign-in can work at all is a property of the deployment, read from
 * its configuration at build time, not from the request.
 */
export default function DashboardPage() {
  return (
    <Container className="gb-dash-page">
      <Dashboard signInAvailable={githubSignInAvailable()} />
    </Container>
  );
}
