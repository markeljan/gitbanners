import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Providers } from "@/components/providers";
import { AuthNotice } from "@/components/site/auth-notice";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { DEFAULT_MODE, themeInitScript } from "@/components/theme";
import { WebMcp } from "@/lib/agent/webmcp";
import { site } from "@/lib/site";

const figtree = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-figtree",
  display: "swap",
});

const title = `${site.name}: ${site.tagline}`;

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: title,
    template: `%s · ${site.name}`,
  },
  description: site.description,
  applicationName: site.name,
  keywords: [...site.keywords],
  authors: [{ name: site.name, url: site.url }],
  creator: site.name,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: site.name,
    locale: "en_US",
    url: "/",
    title,
    description: site.description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description: site.description,
  },
  robots: { index: true, follow: true },
  // Phone numbers and addresses in GitHub bios are data, not links.
  formatDetection: { telephone: false, address: false, email: false },
  other: { "is-agentic-site-type": "app" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1b1b1b" },
    { media: "(prefers-color-scheme: light)", color: "#f1f1f1" },
  ],
  colorScheme: "dark light",
};

/*
 * The root layout must stay fully static: no cookies(), headers() or uncached
 * data here (not even inside <Suspense>), otherwise the statically generated
 * banner pages below it fail to build. Session UI is a Client Component that
 * asks /api/me.
 *
 * Document outline: <header> and <footer> hold no heading element, so the
 * page's <h1> is always the first heading. Pages render inside <main>.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-astryx-theme="neutral"
      data-theme={DEFAULT_MODE}
      className={figtree.variable}
      suppressHydrationWarning
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static, render-blocking theme bootstrap */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Providers origin={site.url}>
          <a href="#main" className="gb-skip-link">
            Skip to content
          </a>
          <SiteHeader />
          <main id="main" tabIndex={-1}>
            {children}
          </main>
          <SiteFooter />
          <AuthNotice />
        </Providers>
        <WebMcp />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
