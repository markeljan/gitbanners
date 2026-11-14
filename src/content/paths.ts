/**
 * Paths of the content pages, the homepage aside. Dependency-free on
 * purpose: `next.config.ts` imports this list to build the Markdown
 * negotiation rules, and the registry in `pages.ts` is tested against it.
 */
export const CONTENT_PATHS = [
  "/docs",
  "/docs/migrate",
  "/pricing",
  "/about",
  "/contact",
  "/privacy",
  "/terms",
] as const;

export type ContentPath = (typeof CONTENT_PATHS)[number];
