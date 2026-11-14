/**
 * RFC 8288 `Link` relations the homepage sends so an agent that only reads
 * response headers still finds the machine-readable entry points.
 *
 * Dependency-free and relative on purpose: `next.config.ts` imports it for
 * `headers()`, where the canonical origin is not known yet.
 */
export const DISCOVERY_LINKS: readonly string[] = [
  '</sitemap.xml>; rel="sitemap"; type="application/xml"',
  '</llms.txt>; rel="describedby"; type="text/plain"',
  '</openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
  '</docs>; rel="service-doc"; type="text/html"',
  '</.well-known/api-catalog>; rel="api-catalog"',
  '</.well-known/ard.json>; rel="ard"',
  '</index.md>; rel="alternate"; type="text/markdown"',
];

export const DISCOVERY_LINK_HEADER = DISCOVERY_LINKS.join(", ");
