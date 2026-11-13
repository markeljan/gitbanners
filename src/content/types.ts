/**
 * Page copy as data.
 *
 * Every content page (home, docs, pricing, legal…) is described once in this
 * shape and rendered twice: as HTML by the page components and as Markdown
 * by the agent surface (`/index.md`, `Accept: text/markdown`, llms-full.txt).
 * One source means the two can never disagree.
 *
 * Inline text is written in a small Markdown subset: `code`, **bold** and
 * [links](https://example.com or /relative). Nothing else is interpreted.
 */
export type Inline = string;

export type Block =
  /** A paragraph. */
  | { type: "p"; text: Inline }
  /** Bulleted or numbered list. */
  | { type: "list"; ordered?: boolean; items: readonly Inline[] }
  /** A code sample. `lang` is a highlight hint such as "md", "html", "bash". */
  | { type: "code"; lang: string; code: string; caption?: string }
  /** A table. Cells are inline text. */
  | {
      type: "table";
      head: readonly string[];
      rows: readonly (readonly Inline[])[];
    }
  /** A highlighted aside. */
  | { type: "note"; text: Inline }
  /**
   * A live banner image. `path` is a relative banner URL without extension
   * or origin, e.g. "/vercel/next.js/contributors" or "/torvalds?size=x".
   */
  | { type: "banner"; path: string; alt: string; caption?: string };

export interface Section {
  /** Anchor id, unique within the page, kebab-case. */
  id: string;
  title: string;
  /** Heading level. Default 2. A level-3 section belongs to the level-2 one before it. */
  level?: 2 | 3;
  blocks: readonly Block[];
}

export interface ContentPage {
  /** Site-relative path, e.g. "/pricing". */
  path: string;
  /** `<title>` and Markdown front-matter title. */
  title: string;
  /** Meta description, 120 to 160 characters. */
  description: string;
  /** ISO date of the last meaningful edit. */
  updated: string;
  /** The page's single h1. */
  heading: string;
  /** Opening paragraph under the h1. */
  lead: Inline;
  sections: readonly Section[];
}

export interface FaqEntry {
  id: string;
  question: string;
  answer: Inline;
}
