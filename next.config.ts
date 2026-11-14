import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { CONTENT_PATHS } from "./src/content/paths";
import { DISCOVERY_LINK_HEADER } from "./src/lib/agent/links";
import { BLOCKED_SEGMENTS, RESERVED_SEGMENTS } from "./src/lib/reserved";

/*
 * URL grammar
 * ───────────
 * Public banner URLs are GitHub-shaped: `/{owner}`, `/{owner}/{preset}`,
 * `/{owner}/{repo}`, `/{owner}/{repo}/{preset}`. The same URL answers with
 *
 *   - an HTML page            (browsers, default)
 *   - the image itself        (`.svg` / `.png` suffix, `/embed/…`, or an
 *                              `Accept` header that wants an image but not HTML)
 *   - a Markdown document     (`.md` suffix or `Accept: text/markdown`)
 *
 * The mapping is done with rewrites so it is resolved at the routing layer:
 * no proxy function runs, and every representation is cached on its own.
 * Internal handlers live under `/-/` because "-" can never be a GitHub login.
 *
 * Rewrite-derived values are passed as PATH segments on purpose: a handler
 * behind a rewrite sees the original request URL, so destination query
 * params would be invisible to it.
 */

// `afterFiles` rewrites run before dynamic routes, so the app's own routes are
// excluded up front, and with them the names that are never an owner (see
// `BLOCKED_SEGMENTS`). `(?:/|\\.|$)`: a bare `$` in a lookahead would mean the
// end of the whole path, not of the segment.
const NOT_OWNER = [...RESERVED_SEGMENTS, ...BLOCKED_SEGMENTS].join("|");
const NOT_RESERVED = `(?!(?:${NOT_OWNER})(?:/|\\.|$))`;
// A GitHub login as GitHub spells it.
const BARE_LOGIN = "[A-Za-z0-9][A-Za-z0-9-]*";
// A GitHub login, optionally written `@login` to escape a collision with an app route.
const LOGIN = `@?${BARE_LOGIN}`;
const OWNER = `${NOT_RESERVED}${LOGIN}`;
// A first segment containing a character that can never appear in a login.
// "-" itself is not junk: a `beforeFiles` rewrite to an internal handler
// passes through the `afterFiles` rules again on its way to the route.
const JUNK = `(?!(?:-|${LOGIN})(?:/|$))[^/]+`;
const IMAGE_EXT = "svg|png";
// Paths that negotiate Markdown by `Accept`: banner pages, and every path that
// is nothing at all (it gets the Markdown 404 an agent can recover from).
// Left out, so they answer the same whatever `Accept` says:
// - the app's own routes. Machine files (/docs/llms.txt, /.well-known/*, the
//   API, /mcp) must reach a scanner that asks for Markdown unchanged, and an
//   app page without a Markdown version (/studio) must answer HTML, not 404.
//   The content pages are listed one by one in `rewrites()` instead.
// - root files (/llms.txt, /openapi.json) and image URLs. Extensions are only
//   trusted on single-segment paths (`/vercel/next.js` is a repository).
const NEGOTIABLE = [
  `(?!(?:${RESERVED_SEGMENTS.join("|")}|-|\\.well-known)(?:/|$))`,
  "(?![^/]+\\.[A-Za-z0-9]+$)",
  `(?!.*\\.(?:${IMAGE_EXT})$)`,
  ".+",
].join("");
// Routes that are never a page, so a ".md" at the end of one means nothing.
const NOT_MACHINE = "(?!(?:api|mcp|embed|b|_next|-|\\.well-known)(?:/|$))";
// What an agent guesses for a versioned API at the root: /v1, /v2/anything.
const API_VERSION = "v[0-9]+";

/** The four /embed rules for one spelling of the owner segment. */
function embedRewrites(owner: string, to: string) {
  return [
    {
      source: `/embed/${owner}.:format(${IMAGE_EXT})`,
      destination: `/-/i/:format/${to}`,
    },
    {
      source: `/embed/${owner}/:rest+.:format(${IMAGE_EXT})`,
      destination: `/-/i/:format/${to}/:rest+`,
    },
    { source: `/embed/${owner}`, destination: `/-/i/auto/${to}` },
    {
      source: `/embed/${owner}/:rest+`,
      destination: `/-/i/auto/${to}/:rest+`,
    },
  ];
}

const header = (value: string) => ({
  type: "header" as const,
  key: "accept",
  value,
});

// Markdown is chosen when it is listed and not preceded by text/html, which is
// how agents state their preference ("text/markdown, text/html;q=0.9").
const WANTS_MARKDOWN = {
  has: [header("(?!.*text/html.*text/markdown).*text/markdown.*")],
};
// What an <img> tag sends: image types, never text/html.
const WANTS_IMAGE = {
  has: [header(".*image/.*")],
  missing: [header(".*text/html.*")],
};

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const baseConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  poweredByHeader: false,
  // Native addons cannot be bundled into ESM chunks.
  serverExternalPackages: ["@takumi-rs/core"],
  // Banner fonts are read from disk by the image route.
  outputFileTracingIncludes: {
    "/-/i/**": ["./assets/fonts/**/*"],
  },
  cacheLife: {
    // GitHub data: fresh for 15 minutes, then served stale while it refreshes.
    github: { stale: 300, revalidate: 900, expire: 86_400 },
  },
  images: {
    remotePatterns: [new URL("https://avatars.githubusercontent.com/**")],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Discovery for agents that read headers only. The Markdown version of
      // the homepage sends the same links itself, next to its canonical one:
      // two sources for one header name would leave the winner to the host.
      {
        source: "/",
        missing: WANTS_MARKDOWN.has,
        headers: [{ key: "Link", value: DISCOVERY_LINK_HEADER }],
      },
      // Internal handlers are reachable by URL; only their public addresses
      // belong in a search index. (Headers match the path as requested, so
      // a public URL rewritten to a handler is not affected.)
      {
        source: "/-/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
    ];
  },
  async redirects() {
    return [{ source: "/developers", destination: "/docs", permanent: true }];
  },
  async rewrites() {
    return {
      // Before the filesystem, so static pages negotiate Markdown too.
      beforeFiles: [
        { source: "/", ...WANTS_MARKDOWN, destination: "/-/md" },
        ...CONTENT_PATHS.map((path) => ({
          source: path,
          ...WANTS_MARKDOWN,
          destination: `/-/md${path}`,
        })),
        {
          source: `/:path(${NEGOTIABLE})`,
          ...WANTS_MARKDOWN,
          destination: "/-/md/:path",
        },
        // The prerendered homepage would otherwise also answer at /index.
        { source: "/index", destination: "/-/nf" },
        // Content negotiation on the bare URL: <img src="https://…/vercel">.
        // Before the filesystem: owner pages are prerendered, and a static
        // page would answer an image request with HTML.
        {
          source: `/:owner(${OWNER})`,
          ...WANTS_IMAGE,
          destination: "/-/i/auto/:owner",
        },
        {
          // Not an explicit .svg/.png: the afterFiles rules give those their format.
          source: `/:owner(${OWNER})/:rest((?!.*\\.(?:${IMAGE_EXT})$).+)`,
          ...WANTS_IMAGE,
          destination: "/-/i/auto/:owner/:rest",
        },
      ],
      afterFiles: [
        // Saved banners: /b/abc123.svg
        {
          source: `/b/:id([A-Za-z0-9_-]+).:format(${IMAGE_EXT})`,
          destination: "/-/i/saved/:format/:id",
        },
        // Explicit image suffix: /vercel.svg, /vercel/next.js/contributors.png
        {
          source: `/:owner(${OWNER}).:format(${IMAGE_EXT})`,
          destination: "/-/i/:format/:owner",
        },
        {
          source: `/:owner(${OWNER})/:rest+.:format(${IMAGE_EXT})`,
          destination: "/-/i/:format/:owner/:rest+",
        },
        // Embed endpoint: always the image. /embed/vercel, /embed/vercel/next.js.png
        // Below /embed/ nothing collides with an app route, so a bare login is
        // always an owner: it reaches the handler `@`-escaped, and
        // /embed/docs is the banner of the GitHub account "docs".
        ...embedRewrites(`:owner(${BARE_LOGIN})`, "@:owner"),
        ...embedRewrites(`:owner(@${BARE_LOGIN})`, ":owner"),
        // Markdown suffix: /vercel.md, /vercel/next.js.md, /pricing.md. Not
        // below the machine routes: /api/v1/repos/{owner}/notes.md is a
        // repository called "notes.md", not the Markdown version of a page.
        { source: "/index.md", destination: "/-/md" },
        { source: `/:path(${NOT_MACHINE}.+).md`, destination: "/-/md/:path" },
        // Junk (/.env, /wp-login.php) → one static 404, no function, no per-URL cache entry.
        { source: `/:owner(${JUNK})/:rest*`, destination: "/-/nf" },
        // A versioned API guessed at the root answers like the API does for an
        // unknown route: 404 as problem+json that points at the real one. The
        // destination names no operation on purpose: the catch-all under /api
        // takes it.
        {
          source: `/:version(${API_VERSION})/:rest*`,
          destination: "/api/-/not-found",
        },
        // The other names that are never an owner: the same static 404, before
        // the banner page of a GitHub account called "ask" could answer 200.
        {
          source: `/:name(${BLOCKED_SEGMENTS.join("|")})/:rest*`,
          destination: "/-/nf",
        },
      ],
      fallback: [],
    };
  },
};

/**
 * `*.dev.ts(x)` routes (the local-only sign-in helper) are page extensions only
 * under `next dev`: production builds never compile them, so they cannot ship.
 */
export default function nextConfig(phase: string): NextConfig {
  return {
    ...baseConfig,
    pageExtensions:
      phase === PHASE_DEVELOPMENT_SERVER
        ? ["dev.tsx", "dev.ts", "tsx", "ts"]
        : ["tsx", "ts"],
  };
}
