import { breadcrumbNode } from "@/lib/agent/jsonld";
import { absoluteUrl } from "@/lib/site";

export interface CollectionInput {
  /** Site-relative path of the page. */
  path: string;
  /** Title, as in `<title>` without the site name. */
  title: string;
  description: string;
  /** The page's `<h1>`, also the last breadcrumb. */
  heading: string;
  /** What the page lists, in page order. */
  items: readonly { name: string; path: string }[];
}

/**
 * A page that lists things (the gallery, the themes): a `CollectionPage`
 * whose main entity is the list as shown, and its breadcrumb. The ids of
 * the website node match `src/lib/agent/jsonld.ts`.
 */
export function collectionJsonLd(input: CollectionInput) {
  const url = absoluteUrl(input.path);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": url,
        url,
        name: input.title,
        headline: input.heading,
        description: input.description,
        inLanguage: "en",
        isPartOf: { "@id": absoluteUrl("/#website") },
        publisher: { "@id": absoluteUrl("/#organization") },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: input.items.length,
          itemListElement: input.items.map((item, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: item.name,
            url: absoluteUrl(item.path),
          })),
        },
      },
      breadcrumbNode([
        { name: "Home", path: "/" },
        { name: input.heading, path: input.path },
      ]),
    ],
  };
}
