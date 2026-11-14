import { about } from "./about";
import { contact } from "./contact";
import { docs } from "./docs";
import { FAQ, FAQ_HEADING } from "./faq";
import { home } from "./home";
import { faqToMarkdown, pageToMarkdown } from "./markdown";
import { migrate } from "./migrate";
import { pricing } from "./pricing";
import { privacy } from "./privacy";
import { terms } from "./terms";
import type { ContentPage } from "./types";

/**
 * Every content page, by its path. The HTML pages, the Markdown handler,
 * the sitemap, llms.txt and llms-full.txt all read this registry, so a page
 * added here shows up in each of them.
 *
 * A page built somewhere else (an interactive tool, say) gets a Markdown
 * version by adding its `ContentPage` here as well.
 */
export const CONTENT_PAGES: readonly ContentPage[] = [
  home,
  docs,
  migrate,
  pricing,
  about,
  contact,
  privacy,
  terms,
];

const byPath = new Map(CONTENT_PAGES.map((page) => [page.path, page]));

export function contentPage(path: string): ContentPage | undefined {
  return byPath.get(path);
}

/**
 * The Markdown body of a content page: h1, lead and sections. The homepage
 * also carries the FAQ, as it does in HTML.
 */
export function contentMarkdown(page: ContentPage): string {
  if (page.path !== home.path) return pageToMarkdown(page);
  return pageToMarkdown(page, {
    append: `## ${FAQ_HEADING}\n\n${faqToMarkdown(FAQ)}`,
  });
}

/** The newest `updated` date among the content pages. */
export const CONTENT_UPDATED = CONTENT_PAGES.reduce(
  (latest, page) => (page.updated > latest ? page.updated : latest),
  home.updated,
);
