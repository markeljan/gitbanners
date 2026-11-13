import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Providers } from "@/components/providers";
import { DEFAULT_MODE, themeInitScript } from "@/components/theme";
import { WebMcp } from "@/lib/agent/webmcp";
import { site } from "@/lib/site";

const figtree = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-figtree",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name}: ${site.tagline}`,
    template: `%s · ${site.name}`,
  },
  description: site.description,
  applicationName: site.name,
  keywords: [...site.keywords],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: site.name,
    url: "/",
    title: `${site.name}: ${site.tagline}`,
    description: site.description,
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
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
        <Providers>
          {/* Placeholder frame with the four landmarks agents look for. */}
          <header className="border-border border-b">
            <nav
              aria-label="Main"
              className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3"
            >
              <Link href="/" className="font-semibold">
                {site.name}
              </Link>
              <Link href="/docs">Docs</Link>
              <Link href="/pricing">Pricing</Link>
            </nav>
          </header>
          <main id="main">{children}</main>
          <footer className="border-border border-t">
            <nav
              aria-label="Footer"
              className="mx-auto flex max-w-6xl flex-wrap gap-4 px-4 py-6 text-secondary"
            >
              <Link href="/about">About</Link>
              <Link href="/contact">Contact</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <Link href="/docs">API docs</Link>
              <a href="/llms.txt">llms.txt</a>
              <a href="/openapi.json">OpenAPI</a>
            </nav>
            <p className="mx-auto max-w-6xl px-4 pb-6 text-secondary">
              {site.name} is an independent project, not affiliated with or
              endorsed by GitHub.
            </p>
          </footer>
        </Providers>
        <WebMcp />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
