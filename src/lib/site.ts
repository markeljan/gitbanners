/**
 * Site-wide constants. Everything that names the product, its canonical URL
 * or its repository lives here so pages, metadata, API docs and agent files
 * never drift apart.
 */

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Canonical origin of the deployed site, without a trailing slash.
 *
 * Order: explicit `NEXT_PUBLIC_SITE_URL` → Vercel production domain →
 * localhost. Preview deployments intentionally resolve to the production
 * domain so canonical URLs, sitemaps and embed snippets stay stable.
 */
export function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return trimSlash(explicit);
  const vercelProd =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProd) return `https://${trimSlash(vercelProd)}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

const repoSlug =
  process.env.NEXT_PUBLIC_GITBANNERS_REPO ?? "markeljan/gitbanners";
const [repoOwner = "markeljan", repoName = "gitbanners"] = repoSlug.split("/");

/**
 * Where the project is based, for structured data and the contact page.
 * Nothing is published unless the maintainer sets it: a country
 * (`NEXT_PUBLIC_CONTACT_COUNTRY`, ISO 3166-1 alpha-2 such as "DE") and
 * optionally `NEXT_PUBLIC_CONTACT_LOCALITY` and `NEXT_PUBLIC_CONTACT_REGION`.
 */
function resolveAddress(): {
  locality: string | null;
  region: string | null;
  country: string;
} | null {
  const country = process.env.NEXT_PUBLIC_CONTACT_COUNTRY?.trim();
  if (!country) return null;
  return {
    locality: process.env.NEXT_PUBLIC_CONTACT_LOCALITY?.trim() || null,
    region: process.env.NEXT_PUBLIC_CONTACT_REGION?.trim() || null,
    country,
  };
}

export const site = {
  name: "GitBanners",
  /** Short product phrase. Also used as the JSON-LD/OG headline. */
  tagline: "Live GitHub banners for profiles, repos and orgs",
  description:
    "GitBanners turns any GitHub profile, repository or organization into a live banner image. One URL, always up to date: contribution graphs, stats, top repositories and contributors as SVG or PNG for READMEs, X, LinkedIn and Open Graph.",
  url: resolveSiteUrl(),
  /** The repository people star to unlock Pro. */
  repo: {
    owner: repoOwner,
    name: repoName,
    slug: `${repoOwner}/${repoName}`,
    url: `https://github.com/${repoOwner}/${repoName}`,
  },
  /** Optional public contact address. Leave unset to route contact through GitHub. */
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || null,
  /** Who runs the project: one person on GitHub, not a company. */
  maintainer: {
    login: "markeljan",
    url: "https://github.com/markeljan",
  },
  /** Optional public location of the maintainer. `null` unless configured. */
  address: resolveAddress(),
  /** Login used for first-paint demos and documentation examples. */
  exampleLogin: "markeljan",
  api: {
    version: "v1",
    basePath: "/api/v1",
  },
  keywords: [
    "GitHub banner generator",
    "GitHub profile banner",
    "GitHub contribution graph image",
    "GitHub README stats card",
    "GitHub repository social preview",
    "GitHub stats API",
  ],
} as const;

export type Site = typeof site;

/** Absolute URL on the canonical origin. `path` must start with "/". */
export function absoluteUrl(path = "/"): string {
  return `${site.url}${path.startsWith("/") ? path : `/${path}`}`;
}
