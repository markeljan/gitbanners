<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## GitBanners: a map for coding agents

GitBanners turns a GitHub login or `owner/repo` into a live banner image with a URL (`/{owner}.svg`, `/{owner}/{repo}/contributors.png`), plus a site to compose, theme, copy and save banners. Next.js 16 App Router with `cacheComponents`, React 19, TypeScript strict, Tailwind 4, Biome, the Astryx design system, bun as package manager and test runner. `README.md` has the overview; `CONTRIBUTING.md` the checks.

### Where things are

| Path | What lives there |
| --- | --- |
| `next.config.ts` | The URL grammar as rewrites: a path is a page, an image (`.svg`, `.png`, `Accept: image/*`) or Markdown (`.md`, `Accept: text/markdown`). Internal handlers live under `/-/`. |
| `src/lib/reserved.ts` | First path segments that are never a GitHub owner. Every new top-level folder in `src/app` goes here. `ownerPath(login)` prints owner links. |
| `src/lib/site.ts` | `site.url` (canonical origin), names, the Pro repository. Never hard-code a host. |
| `src/lib/banner` | Pure banner engine: presets, themes, sizes, options parsing, layout, `buildBanner`. Import from `@/lib/banner` only. |
| `src/lib/render`, `src/app/-/i` | Banner element to SVG or PNG, cache headers, the image routes. |
| `src/lib/github` | GitHub data with `'use cache'`. Server code imports `@/lib/github/cached`; client code imports `@/lib/github/schema`, `/samples`, `/calendar`, `/errors` directly. |
| `src/lib/auth`, `src/lib/pro`, `src/lib/store`, `src/lib/db`, `src/app/api` | Sign in with GitHub, sessions, the Pro check, Upstash or file store, saved banners, the account API. |
| `src/lib/api`, `src/app/api/v1` | The keyless public JSON API and its parameter docs. |
| `src/lib/agent`, `src/app/mcp`, `src/app/-/md` | OpenAPI, llms.txt, JSON-LD, metadata, the MCP server, Markdown versions of pages. |
| `src/content` | Page copy as data. `ContentPage` objects render to HTML (`src/components/content`) and to Markdown from the same source. Register new pages in `pages.ts` and `paths.ts`. |
| `src/lib/migrate`, `src/components/migrate` | The README doctor: a pure engine that swaps dead stat-card URLs, and its browser-only page at `/docs/migrate`. |
| `src/components/site`, `src/hooks` | Site shell, `useMe()` for the session, data hooks. |
| `scripts/` | `agent-readiness-check.sh` and `content-ratio.mjs` (run against `next start`), `shot.ts` for screenshots, sample refreshers. |

### Rules

- Read the relevant guide in `node_modules/next/dist/docs/` before using a Next API (see the block above).
- Static first: pages are static shells and the root layout never reads cookies or headers, not even inside Suspense. Per-visitor UI is a client component that fetches after hydration (`useMe()`).
- Route segment config is limited to what `cacheComponents` allows; `dynamic`, `revalidate`, `runtime` and `fetchCache` are not used.
- Image routes always answer `200` with an image, error cards included.
- Never write the protocol name of the sign-in flow in any public page, document, spec or machine-readable file. Say "Sign in with GitHub". The acceptance script greps for it.
- Copy is sentence case with no em dashes, written in `src/content`, and quotes numbers from the code (entitlements, cache lifetimes, `FACTS`) instead of typing them.
- Use Astryx components and design tokens for UI; never mount Astryx's `<Theme>` provider.
- No `any`, no non-null assertions, no default exports except where Next requires them, no leftover `console.log`. Tests sit next to the code as `*.test.ts`.
- Before finishing: `bunx biome check --write <paths>`, `bun run typecheck`, `bun test`, `bun run build`.
- Never commit secrets or print tokens. `.env.development.local` is git-ignored.
