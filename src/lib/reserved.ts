/**
 * First URL path segments that are never interpreted as a GitHub owner.
 *
 * Keep this file dependency-free: `next.config.ts` imports it to build the
 * rewrite rules, and the route code uses it to validate owners.
 *
 * A GitHub account whose login collides with one of these (for example
 * `docs`) is still reachable with the `@` form: `/@docs`, `/@docs.svg`.
 *
 * IMPORTANT: every new top-level folder under `src/app` must be added to
 * `RESERVED_SEGMENTS`, otherwise `<img>` requests below it would be rewritten
 * to the banner route. Internal-only routes go under `src/app/-/` instead:
 * "-" is not a valid login, so nothing there can shadow a GitHub account.
 */

/** The app's own routes: top-level folders under `src/app` and root redirects. */
export const RESERVED_SEGMENTS = [
  "_next",
  "about",
  "api",
  "b",
  "contact",
  "dashboard",
  "developers",
  "docs",
  "embed",
  "gallery",
  "mcp",
  "pricing",
  "privacy",
  "studio",
  "terms",
  "themes",
] as const;

export type ReservedSegment = (typeof RESERVED_SEGMENTS)[number];

/**
 * Names that are neither a route nor an owner, as regular-expression
 * fragments. They answer 404 instead of the banner page of whichever GitHub
 * account happens to own the login:
 *
 * - paths agents and scanners probe for an API or a sign-in surface
 *   (`/v1`, `/ask`, `/agent/identity`, `/auth.md`),
 * - the stems of documents served at the root (`/llms.txt`, `/index.md`,
 *   `/robots.txt`, `/sitemap.xml`, `/openapi.json`, `/icon.svg`), so
 *   `/openapi` can never be mistaken for the document next to it.
 *
 * `o?auth` covers both spellings without this file, and with it every
 * client bundle, containing the longer word: scanners read a mention of it
 * as a claim that the site offers that sign-in protocol to API clients.
 */
export const BLOCKED_SEGMENTS = [
  "v[0-9]+",
  "ask",
  "agents?",
  "o?auth",
  "llms(?:-full)?",
  "index",
  "robots",
  "sitemap",
  "openapi",
  "icon",
  "favicon",
] as const;

const reserved = new Set<string>(RESERVED_SEGMENTS);
const blocked = new RegExp(`^(?:${BLOCKED_SEGMENTS.join("|")})$`);

export function isReservedSegment(segment: string): boolean {
  const name = segment.toLowerCase();
  return reserved.has(name) || blocked.test(name);
}

/**
 * Normalize an owner path segment: strips the optional `@` escape prefix.
 * Returns `null` when the bare segment is one of the app's own routes.
 */
export function ownerFromSegment(segment: string): string | null {
  if (segment.startsWith("@")) return segment.slice(1) || null;
  return isReservedSegment(segment) ? null : segment;
}

/** Path prefix for an owner, using the `@` escape when the login collides with an app route. */
export function ownerPath(login: string): string {
  return isReservedSegment(login) ? `/@${login}` : `/${login}`;
}
