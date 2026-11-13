import type { NextConfig } from "next";
import { RESERVED_SEGMENTS } from "./src/lib/reserved";

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
 *
 * Rewrite-derived values are passed as PATH segments on purpose: a handler
 * behind a rewrite sees the original request URL, so destination query
 * params would be invisible to it.
 */

// `afterFiles` rewrites run before dynamic routes, so the app's own routes are
// excluded up front. `(?:/|\\.|$)`: a bare `$` in a lookahead would mean the end
// of the whole path, not of the segment.
const NOT_RESERVED = `(?!(?:${RESERVED_SEGMENTS.join("|")})(?:/|\\.|$))`;
// A GitHub login, optionally written `@login` to escape a collision with an app route.
const LOGIN = "@?[A-Za-z0-9-]+";
const OWNER = `${NOT_RESERVED}${LOGIN}`;
// A first segment containing a character that can never appear in a login.
const JUNK = `(?!${LOGIN}(?:/|$))[^/]+`;
const IMAGE_EXT = "svg|png";

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

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  poweredByHeader: false,
  // Native addons cannot be bundled into ESM chunks.
  serverExternalPackages: ["@resvg/resvg-js"],
  // Banner fonts are read from disk by the image route.
  outputFileTracingIncludes: {
    "/i/**": ["./assets/fonts/**/*"],
    "/b/**": ["./assets/fonts/**/*"],
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
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return {
      // Before the filesystem, so static pages negotiate Markdown too.
      beforeFiles: [
        { source: "/", ...WANTS_MARKDOWN, destination: "/md" },
        {
          source: "/:path((?!(?:api|i|md|mcp|_next)(?:/|$)).+)",
          ...WANTS_MARKDOWN,
          destination: "/md/:path",
        },
      ],
      afterFiles: [
        // Saved banners: /b/abc123.svg
        {
          source: `/b/:id([A-Za-z0-9_-]+).:format(${IMAGE_EXT})`,
          destination: "/i/saved/:format/:id",
        },
        // Explicit image suffix: /vercel.svg, /vercel/next.js/contributors.png
        {
          source: `/:owner(${OWNER}).:format(${IMAGE_EXT})`,
          destination: "/i/:format/:owner",
        },
        {
          source: `/:owner(${OWNER})/:rest+.:format(${IMAGE_EXT})`,
          destination: "/i/:format/:owner/:rest+",
        },
        // Embed endpoint: always the image. /embed/vercel, /embed/vercel/next.js.png
        {
          source: `/embed/:owner(${LOGIN}).:format(${IMAGE_EXT})`,
          destination: "/i/:format/:owner",
        },
        {
          source: `/embed/:owner(${LOGIN})/:rest+.:format(${IMAGE_EXT})`,
          destination: "/i/:format/:owner/:rest+",
        },
        { source: `/embed/:owner(${LOGIN})`, destination: "/i/auto/:owner" },
        {
          source: `/embed/:owner(${LOGIN})/:rest+`,
          destination: "/i/auto/:owner/:rest+",
        },
        // Markdown suffix: /vercel.md, /docs/api.md, /pricing.md
        { source: "/index.md", destination: "/md" },
        { source: "/:path(.+).md", destination: "/md/:path" },
        // Junk (/.env, /wp-login.php) → one static 404, no function, no per-URL cache entry.
        { source: `/:owner(${JUNK})/:rest*`, destination: "/nf" },
        // Content negotiation on the bare URL: <img src="https://…/vercel">
        {
          source: `/:owner(${OWNER})`,
          ...WANTS_IMAGE,
          destination: "/i/auto/:owner",
        },
        {
          source: `/:owner(${OWNER})/:rest+`,
          ...WANTS_IMAGE,
          destination: "/i/auto/:owner/:rest+",
        },
      ],
      fallback: [],
    };
  },
};

export default nextConfig;
