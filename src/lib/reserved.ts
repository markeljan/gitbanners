/**
 * First URL path segments that belong to the app itself and are therefore
 * never interpreted as a GitHub owner.
 *
 * Keep this file dependency-free: `next.config.ts` imports it to build the
 * rewrite rules, and the route code uses it to validate owners.
 *
 * A GitHub account whose login collides with one of these (for example
 * `docs`) is still reachable with the `@` form: `/@docs`, `/@docs.svg`.
 *
 * IMPORTANT: every new top-level folder under `src/app` must be added here,
 * otherwise `<img>` requests below it would be rewritten to the banner route.
 */
export const RESERVED_SEGMENTS = [
  "_next",
  "about",
  "api",
  "b",
  "contact",
  "dashboard",
  "docs",
  "embed",
  "gallery",
  "i",
  "mcp",
  "md",
  "nf",
  "pricing",
  "privacy",
  "sitemaps",
  "studio",
  "terms",
  "themes",
] as const;

export type ReservedSegment = (typeof RESERVED_SEGMENTS)[number];

const reserved = new Set<string>(RESERVED_SEGMENTS);

export function isReservedSegment(segment: string): boolean {
  return reserved.has(segment.toLowerCase());
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
