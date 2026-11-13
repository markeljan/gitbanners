import { site } from "@/lib/site";

export interface SiteLink {
  label: string;
  href: string;
  /**
   * `page`: an app page, linked with next/link.
   * `file`: a machine-readable endpoint (plain `<a>`: there is nothing to
   * prefetch and no page to transition to).
   * `external`: another site, opened in a new tab.
   */
  kind: "page" | "file" | "external";
}

/** Header navigation, in order. */
export const PRIMARY_NAV: readonly SiteLink[] = [
  { label: "Studio", href: "/studio", kind: "page" },
  { label: "Gallery", href: "/gallery", kind: "page" },
  { label: "Themes", href: "/themes", kind: "page" },
  { label: "Docs", href: "/docs", kind: "page" },
  { label: "Pricing", href: "/pricing", kind: "page" },
];

export interface SiteLinkGroup {
  id: string;
  title: string;
  links: readonly SiteLink[];
}

/** Footer columns. */
export const FOOTER_NAV: readonly SiteLinkGroup[] = [
  {
    id: "product",
    title: "Product",
    links: [
      { label: "Studio", href: "/studio", kind: "page" },
      { label: "Gallery", href: "/gallery", kind: "page" },
      { label: "Themes", href: "/themes", kind: "page" },
      { label: "Pricing", href: "/pricing", kind: "page" },
      { label: "Dashboard", href: "/dashboard", kind: "page" },
    ],
  },
  {
    id: "resources",
    title: "Resources",
    links: [
      { label: "Docs", href: "/docs", kind: "page" },
      { label: "README doctor", href: "/docs/migrate", kind: "page" },
      { label: "OpenAPI", href: "/openapi.json", kind: "file" },
      { label: "MCP server", href: "/mcp", kind: "file" },
      { label: "llms.txt", href: "/llms.txt", kind: "file" },
    ],
  },
  {
    id: "project",
    title: "Project",
    links: [
      { label: "About", href: "/about", kind: "page" },
      { label: "Contact", href: "/contact", kind: "page" },
      { label: "Privacy", href: "/privacy", kind: "page" },
      { label: "Terms", href: "/terms", kind: "page" },
      { label: "GitHub", href: site.repo.url, kind: "external" },
    ],
  },
];

/**
 * True when `pathname` is `href` or a page below it, so "Docs" stays marked
 * on `/docs/migrate`. The home page only matches itself.
 */
export function isCurrentPath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Where "Sign in with GitHub" starts, returning to `returnTo` afterwards. */
export function signInHref(returnTo = "/"): string {
  return `/api/auth/github?returnTo=${encodeURIComponent(returnTo)}`;
}

/**
 * `returnTo` marked as a Pro check: the sign-in callback replaces
 * `pro_check` with what it found, and the page tells the user.
 */
export function withProCheck(returnTo: string): string {
  const [path, hash = ""] = returnTo.split("#");
  const url = new URL(path, "http://internal.invalid");
  url.searchParams.set("pro_check", "1");
  return `${url.pathname}${url.search}${hash ? `#${hash}` : ""}`;
}

/**
 * True for a site-relative link to a page. Files and machine endpoints
 * (`/openapi.json`, `/llms.txt`, `/mcp`, `/api/…`) are not pages: they get a
 * plain anchor, because there is nothing for the router to prefetch or render.
 */
export function isPageHref(href: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  const [path] = href.split(/[?#]/);
  if (/^\/(?:api|mcp|embed)(?:\/|$)/.test(path)) return false;
  return !/\.[a-z0-9]+$/i.test(path);
}
