# GitBanners

Live GitHub banners for profiles, repos and orgs. Put a GitHub login or `owner/repo` in a URL and get an image that updates itself: contribution graph, headline numbers, top repositories, languages, contributors. SVG for READMEs, PNG for X, LinkedIn and link previews.

[![GitHub banner for markeljan](https://gitbanners.com/markeljan.svg)](https://gitbanners.com/markeljan)

[![Contributors of vercel/next.js](https://gitbanners.com/vercel/next.js/contributors.svg?theme=dracula)](https://gitbanners.com/vercel/next.js)

<a href="https://gitbanners.com/markeljan"><img alt="Streak of markeljan" src="https://gitbanners.com/markeljan/streak.svg" width="49%"></a> <a href="https://gitbanners.com/markeljan"><img alt="Stats card of markeljan" src="https://gitbanners.com/markeljan/card.svg" width="49%"></a>

Site: [gitbanners.com](https://gitbanners.com) · Docs: [gitbanners.com/docs](https://gitbanners.com/docs) · README doctor: [gitbanners.com/docs/migrate](https://gitbanners.com/docs/migrate)

## What it is

- **Banners from a URL.** Every public GitHub user, organization and repository has a banner page and image URLs. Nothing to sign up for, no key.
- **Sixteen presets, six sizes, twenty-four themes.** Profiles: overview, activity, stats, repos, languages, streak, wrapped, card. Repositories: overview, activity, contributors, social, release. Organizations: overview, repos, activity. README, X header, LinkedIn banner, link preview, GitHub social preview and square canvases. The default theme matches GitHub dark.
- **Images that never break.** An image URL always answers `200` with an image. An unknown login or a GitHub outage is drawn as a small card, and the edge keeps serving the last good copy for up to seven days.
- **A studio** to compose, theme and copy a banner, and **saved banners** with stable links after you sign in with GitHub.
- **Pro for a star.** Star this repository while signed in to unlock more saved banners, no brand mark, animated SVG and a default banner at your own profile URL. See [how Pro works](#how-pro-works).
- **Agent ready.** Every page has a Markdown version, there is a keyless JSON API with an OpenAPI description, an MCP server, `llms.txt` and an agent skill.
- **README doctor.** A browser-only tool that swaps dead github-readme-stats, trophy and activity graph images for working banners.

## URL grammar

The same path is a page, an image or a Markdown document, by its ending.

| URL                            | Answers with                                              |
| ------------------------------ | --------------------------------------------------------- |
| `/{owner}`                     | The banner page of a user or an organization              |
| `/{owner}.svg`, `/{owner}.png` | Its banner, default preset                                |
| `/{owner}/{preset}.svg`        | One preset: `/torvalds/streak.svg`                        |
| `/{owner}/{repo}.svg`          | A repository's banner                                     |
| `/{owner}/{repo}/{preset}.svg` | One repository preset: `/vercel/next.js/contributors.svg` |
| `/embed/{owner}[/{repo}]`      | The image, format chosen by the `Accept` header           |
| `/b/{id}.svg`                  | A saved banner                                            |
| `/{owner}.md`, `/{page}.md`    | The page as Markdown                                      |

Options go in the query string: `?theme=dracula&size=x`, `?width=495`, `?bg=0d1117&accent=f78166&heat=a855f7`, `?year=2025`, `?hide=bio,legend`. Parsing is lenient: unknown parameters are ignored and bad values fall back to defaults, so an embedded image never breaks. A login that collides with a route of the site is written with `@`: `/@docs.svg`. The full reference, with every parameter, is at [/docs](https://gitbanners.com/docs).

Embed in a README:

```md
[![GitHub banner](https://gitbanners.com/your-login.svg)](https://gitbanners.com/your-login)
```

## Local development

You need [bun](https://bun.sh) 1.4 or newer and Node 26 (Next itself runs on Node).

```sh
bun install
cp .env.example .env.development.local   # optional: accounts and Pro
bun run dev                               # http://localhost:3000
```

Public banners work with no environment at all. Under `next dev` the GitHub CLI's token (`gh auth token`) is used for GitHub data when you are logged in with `gh`; without a token the bundled samples answer for their accounts and other users come from a reduced public fallback.

Checks, the same ones CI runs:

```sh
bun run lint        # Biome
bun run typecheck   # next typegen && tsc --noEmit
bun test            # unit tests
bun run build       # production build, works without secrets
```

More: `bun tests/e2e/auth/run.ts` drives sign-in, saved banners and Pro over HTTP against a mock GitHub, and `scripts/agent-readiness-check.sh http://localhost:3000` checks the machine-readable surface against `next start`.

### Environment variables

All optional for public banners. `.env.example` documents each one in full.

| Variable                                                   | What it is for                                                                                                                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_SECRET`                                           | Signs session cookies. Base64 of 32 random bytes: `openssl rand -base64 32`.                                                                                |
| `SESSION_SECRET_PREVIOUS`                                  | The old secret during a rotation.                                                                                                                           |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`                 | The GitHub app people sign in with. Callback URL `https://<your-domain>/api/auth/github/callback`. No scopes are requested.                                 |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN`                     | Upstash Redis for accounts and saved banners (or `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`). Without them local development uses a JSON file. |
| `KEY_NAMESPACE`                                            | Prefix for Redis keys. Default `gb:`, and `gb:<VERCEL_ENV>:` on previews.                                                                                   |
| `GB_STORE_FILE`                                            | Local only: where the file store lives. Default `.data/store.json`.                                                                                         |
| `GITHUB_TOKEN`                                             | Server token for GitHub data and for re-checking stars. Must be able to list the stargazers of the Pro repository.                                          |
| `PRO_REPO`                                                 | `owner/name` whose stargazers are Pro. Default: this repository.                                                                                            |
| `PRO_LOGINS`                                               | Comma-separated logins that are always Pro.                                                                                                                 |
| `NEXT_PUBLIC_SITE_URL`                                     | Canonical origin, such as `https://gitbanners.com`. Default: the Vercel production domain.                                                                  |
| `NEXT_PUBLIC_GITBANNERS_REPO`                              | The repository people star, `owner/name`.                                                                                                                   |
| `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_CONTACT_COUNTRY` | Optional public contact details for the contact page and structured data.                                                                                   |
| `GITBANNERS_DEV_GH_LOGIN`                                  | Local only. `1` enables `/api/auth/dev`, which signs you in as your GitHub CLI account. Never set it on Vercel.                                             |

## Architecture in one screen

```text
src/
  app/                    Next.js App Router (cacheComponents, static-first)
    page.tsx, docs/, pricing/, about/ …   content pages, static shells
    docs/migrate/         README doctor: static page, client tool
    -/i/…                 image handlers behind rewrites (SVG, PNG)
    -/md/…                Markdown versions of pages
    api/v1/…              keyless JSON API (RFC 9457 problems, rate limits)
    api/auth, api/me, api/banners   accounts and saved banners
    mcp/                  MCP server (Streamable HTTP, stateless)
  lib/
    banner/               pure banner engine: presets, themes, sizes, options, layout
    render/               banner element to SVG or PNG, caching and response headers
    github/               GitHub data: GraphQL and REST, 'use cache', samples, fallback
    auth/, pro/, store/, db/   sign-in, Pro check, Upstash or file store, records
    api/, agent/          API service and docs, OpenAPI, llms.txt, JSON-LD, MCP tools
    migrate/              README doctor engine (pure, runs in the browser)
    site.ts, reserved.ts, embed.ts   canonical URL, reserved routes, links and snippets
  content/                page copy as data, rendered to HTML and to Markdown
  components/             site shell, banner UI, content renderer, tools
next.config.ts            URL grammar as rewrites: page, image or Markdown by suffix and Accept
```

A banner is one React element with explicit pixel layout (`buildBanner` in `src/lib/banner`). The server turns it into SVG or PNG; the browser mounts the same element as DOM for an instant preview. GitHub data is cached for 15 minutes with `'use cache'`, images are cached at the edge with `stale-while-revalidate` and `stale-if-error`, and rewrites resolve the URL grammar at the routing layer, so pages stay static.

## How Pro works

Pro means: signed in with GitHub, and a star on the repository named by `PRO_REPO` (this one by default).

1. Sign-in asks GitHub for no scopes. During the callback the short-lived token reads who you are and whether you starred the repository, then it is thrown away.
2. The decision is stored per user. A Pro decision is trusted for six hours, a Free one for a minute; after that the server re-checks with its own token through the stargazer list, so no user token is ever kept. An outage never downgrades anyone.
3. Limits live in one place, `src/lib/pro/entitlements.ts`: 3 or 50 saved banners, hiding the brand mark, animation, a default banner at `/{login}.svg`, and 15 or 5 minutes of edge refresh for saved banners. The image routes and the account API both read it.
4. "Check again" on the site is a fresh sign-in, which sees a new star at once.

Removing the star turns the account back into Free at the next check. Saved banners stay.

## Deploy to Vercel

1. Import the repository in Vercel. `vercel.ts` sets the install command (the exact bun version from `package.json`), the region and function limits.
2. Add the domain and set `NEXT_PUBLIC_SITE_URL` to it, such as `https://gitbanners.com`, so canonical URLs, sitemaps and embed snippets name one host. Redirect `www` to the apex.
3. Add Upstash Redis from the Vercel Marketplace: it sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
4. Register a GitHub sign-in app with the callback `https://<your-domain>/api/auth/github/callback` and set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Use a separate app for local work.
5. Set `SESSION_SECRET` and `GITHUB_TOKEN` as sensitive variables, with different values for production and preview.
6. Turn on Web Analytics and Speed Insights in the project; the app already includes both.
7. After the first deploy, run `scripts/agent-readiness-check.sh https://<your-domain>`.

## Credits and licences

- Code: [MIT](LICENSE).
- [Mona Sans](https://github.com/github/mona-sans) by GitHub, the banner typeface, under the SIL Open Font License 1.1 (`assets/fonts/OFL.txt`).
- [Octicons](https://github.com/primer/octicons) by GitHub, the banner icons, under the MIT License.
- [Twemoji](https://github.com/jdecked/twemoji) artwork for emoji in banners, licensed under CC BY 4.0.
- The interface uses the Astryx design system.

GitBanners is an independent project, not affiliated with or endorsed by GitHub. GitHub and the Invertocat are trademarks of GitHub, Inc.

See [CONTRIBUTING.md](CONTRIBUTING.md) to work on it and [SECURITY.md](SECURITY.md) to report a vulnerability.
