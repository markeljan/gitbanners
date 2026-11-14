/**
 * Structured data (schema.org JSON-LD) for the site and its pages.
 *
 * Everything here states facts that are also visible on the page it is
 * rendered into: the FAQ entries are the ones shown, the offers are the
 * plans on the pricing page, and a contact point or an address appears only
 * when the maintainer configured one.
 */

import { plainInline } from "@/content/inline";
import type { ContentPage, FaqEntry } from "@/content/types";
import { bannerPath, targetOf } from "@/lib/banner";
import type { Entity } from "@/lib/github/schema";
import { proRepoSlug } from "@/lib/pro/repo";
import { absoluteUrl, site } from "@/lib/site";
import { previewImagePath } from "./metadata";

type Node = Record<string, unknown>;

const ORGANIZATION_ID = absoluteUrl("/#organization");
const WEBSITE_ID = absoluteUrl("/#website");
const APPLICATION_ID = absoluteUrl("/#application");

/**
 * Product phrases, as they are written in the homepage copy. A search
 * engine or scanner that looks for "what is this site about" pairs them
 * with the brand, and only counts a phrase that is also visible on the
 * page. `jsonld.test.ts` checks that every one still is.
 */
export const PRODUCT_TERMS: readonly string[] = [
  "GitHub banners",
  "contribution graph",
  "GitHub README",
];

/**
 * Serialized for a `<script type="application/ld+json">`. Escaping "<"
 * keeps user-written text (bios, repository descriptions) from closing the
 * script element.
 */
export function ldJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function graph(nodes: readonly Node[]): Node {
  return { "@context": "https://schema.org", "@graph": nodes };
}

/** The project as a publisher. Contact details only as far as they are public. */
export function organizationNode(): Node {
  const contactPoint: Node = {
    "@type": "ContactPoint",
    contactType: "customer support",
    url: absoluteUrl("/contact"),
    availableLanguage: "English",
    ...(site.contactEmail ? { email: site.contactEmail } : {}),
  };
  return {
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: site.name,
    url: absoluteUrl("/"),
    logo: absoluteUrl("/icon.svg"),
    description: site.description,
    founder: {
      "@type": "Person",
      name: site.maintainer.login,
      url: site.maintainer.url,
    },
    sameAs: [site.repo.url, site.maintainer.url],
    knowsAbout: [...PRODUCT_TERMS],
    contactPoint,
    ...(site.contactEmail ? { email: site.contactEmail } : {}),
    ...(site.address
      ? {
          address: {
            "@type": "PostalAddress",
            addressCountry: site.address.country,
            ...(site.address.region
              ? { addressRegion: site.address.region }
              : {}),
            ...(site.address.locality
              ? { addressLocality: site.address.locality }
              : {}),
          },
        }
      : {}),
  };
}

export function websiteNode(): Node {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: site.name,
    url: absoluteUrl("/"),
    description: site.description,
    inLanguage: "en",
    publisher: { "@id": ORGANIZATION_ID },
  };
}

/** The product, with its two plans as offers. Both cost nothing. */
export function applicationNode(): Node {
  const offer = (name: string, description: string): Node => ({
    "@type": "Offer",
    name,
    description,
    price: "0",
    priceCurrency: "USD",
    availability: "https://schema.org/OnlineOnly",
    url: absoluteUrl("/pricing"),
  });
  return {
    "@type": "SoftwareApplication",
    "@id": APPLICATION_ID,
    name: site.name,
    url: absoluteUrl("/"),
    description: site.description,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Any",
    keywords: PRODUCT_TERMS.join(", "),
    image: absoluteUrl(previewImagePath(`/${site.exampleLogin}`)),
    softwareHelp: absoluteUrl("/docs"),
    isAccessibleForFree: true,
    offers: [
      offer(
        "Free",
        "Every banner, preset, size and theme for public GitHub data. No account needed.",
      ),
      offer(
        "Pro",
        `Unlocked by signing in with GitHub and starring the ${proRepoSlug()} repository.`,
      ),
    ],
    provider: { "@id": ORGANIZATION_ID },
    isPartOf: { "@id": WEBSITE_ID },
    sameAs: [site.repo.url],
  };
}

export function faqNode(entries: readonly FaqEntry[], pagePath = "/"): Node {
  return {
    "@type": "FAQPage",
    "@id": absoluteUrl(`${pagePath}#faq`),
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: plainInline(entry.answer) },
    })),
  };
}

/** A breadcrumb trail. `path` is site-relative; the first item is the homepage. */
export function breadcrumbNode(
  trail: readonly { name: string; path: string }[],
): Node {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

const HOME_CRUMB = { name: "Home", path: "/" } as const;

/** The homepage: who publishes the site, what the product is, and the FAQ it shows. */
export function homeJsonLd(faq: readonly FaqEntry[]): Node {
  return graph([
    organizationNode(),
    websiteNode(),
    applicationNode(),
    faqNode(faq),
    breadcrumbNode([HOME_CRUMB]),
  ]);
}

const PAGE_TYPES: Record<string, string> = {
  "/about": "AboutPage",
  "/contact": "ContactPage",
};

/** A content page: the page itself and its place below the homepage. */
export function pageJsonLd(page: ContentPage): Node {
  const url = absoluteUrl(page.path);
  return graph([
    {
      "@type": PAGE_TYPES[page.path] ?? "WebPage",
      "@id": url,
      url,
      name: page.title,
      headline: page.heading,
      description: page.description,
      dateModified: page.updated,
      inLanguage: "en",
      isPartOf: { "@id": WEBSITE_ID },
      publisher: { "@id": ORGANIZATION_ID },
    },
    breadcrumbNode([HOME_CRUMB, { name: page.heading, path: page.path }]),
  ]);
}

function aboutNode(entity: Entity): Node {
  if (entity.kind === "repo") {
    return {
      "@type": "SoftwareSourceCode",
      name: entity.fullName,
      codeRepository: `https://github.com/${entity.fullName}`,
      ...(entity.description ? { description: entity.description } : {}),
      ...(entity.language ? { programmingLanguage: entity.language.name } : {}),
      ...(entity.license ? { license: entity.license } : {}),
      author: {
        "@type": entity.owner.kind === "org" ? "Organization" : "Person",
        name: entity.owner.login,
        url: `https://github.com/${entity.owner.login}`,
      },
    };
  }
  const profile = `https://github.com/${entity.login}`;
  const description = entity.kind === "org" ? entity.description : entity.bio;
  return {
    "@type": entity.kind === "org" ? "Organization" : "Person",
    name: entity.name?.trim() || entity.login,
    alternateName: entity.login,
    url: profile,
    sameAs: [profile],
    image: entity.avatarUrl,
    ...(description ? { description } : {}),
  };
}

export interface EntityJsonLdInput {
  /** Title of the page, as in its `<title>`. */
  title: string;
  description: string;
  /** Preset of the page, when it is not the default one. */
  preset?: string | null;
}

/**
 * The page of a GitHub user, organization or repository: a `WebPage` about
 * that person, organization or source code, its preview image, and the
 * breadcrumb trail. Names, bios and descriptions are user-written, so the
 * result must be serialized with {@link ldJson}.
 */
export function entityJsonLd(entity: Entity, input: EntityJsonLdInput): Node {
  const target = targetOf(entity);
  const path = bannerPath(target, { preset: input.preset });
  const url = absoluteUrl(path);
  const trail =
    target.kind === "repo"
      ? [
          HOME_CRUMB,
          {
            name: target.owner,
            path: bannerPath({ kind: "owner", login: target.owner }),
          },
          { name: target.name, path: bannerPath(target) },
        ]
      : [HOME_CRUMB, { name: target.login, path: bannerPath(target) }];
  return graph([
    {
      "@type": "WebPage",
      "@id": url,
      url,
      name: input.title,
      description: input.description,
      inLanguage: "en",
      dateModified: entity.fetchedAt,
      isPartOf: { "@id": WEBSITE_ID },
      primaryImageOfPage: {
        "@type": "ImageObject",
        url: absoluteUrl(previewImagePath(path)),
        width: 1200,
        height: 630,
      },
      about: aboutNode(entity),
    },
    breadcrumbNode(trail),
  ]);
}
