# Contributing to GitBanners

Thanks for helping. Issues and pull requests are welcome: bug reports with the banner URL that misbehaves, new themes, presets, fixes to the copy.

## Setup

```sh
bun install
bun run dev        # http://localhost:3000
```

You need bun 1.4 or newer and Node 26. Public banners need no environment. For accounts, saved banners and Pro, copy `.env.example` to `.env.development.local` and read the comments in it; with `GITBANNERS_DEV_GH_LOGIN=1`, `/api/auth/dev` signs you in as your GitHub CLI account so you never need a real sign-in app locally. When `gh` is logged in, `next dev` uses its token for GitHub data.

## Checks

Run these before you open a pull request. CI runs the same ones.

```sh
bun run lint        # Biome: formatting and lint (bun run lint:fix writes fixes)
bun run typecheck   # next typegen && tsc --noEmit
bun test            # unit tests, next to the code they test (*.test.ts)
bun run build       # must succeed without any secrets
```

When you change routing, pages or anything machine-readable, also run `bun run build && bun run start` and then `scripts/agent-readiness-check.sh http://localhost:3000` and `node scripts/content-ratio.mjs`. Account changes have an HTTP suite: `bun tests/e2e/auth/run.ts`.

The account-store test shim uses `ioredis-mock` 8, which requires ioredis 5. Keep that peer dependency on major 5 until the mock integration is migrated too. ioredis 6 changes the reply-transformer contract and breaks the existing sorted-set tests; production uses the separate `@upstash/redis` client.

## Conventions

- **This Next.js has breaking changes.** It is Next 16 with `cacheComponents`. Read the guide in `node_modules/next/dist/docs/` before using an API, and see `AGENTS.md`.
- **Static first.** Pages are static shells; anything about the visitor (the session, saved banners) is a client component that fetches after hydration. The root layout never reads cookies or headers.
- **Image routes always answer 200** with an image, an error card included. A README shows a broken-image icon for anything else.
- **TypeScript strict**, no `any`, no non-null assertions, no default exports except where Next requires them, no `console.log` left behind. Comments explain why, not what.
- **Biome** formats at 80 columns. Do not fight it. The exact captured GitHub response `src/lib/github/__fixtures__/raw/contributions.torvalds.html` is excluded from tooling because it is external parser test data; preserve its bytes. Other fixtures remain checked.
- **Copy** is sentence case, has no em dashes, and lives in `src/content` as data so the HTML page and its Markdown version cannot disagree. Say "Sign in with GitHub"; the name of the sign-in protocol never appears in public text. No placeholder text and no fake data presented as real.
- **UI** uses the Astryx design system and its tokens (`var(--color-*)`, `var(--spacing-*)`, `var(--radius-*)`), one primary button per view, and never colour alone to carry meaning.
- **Banner engine** code in `src/lib/banner` is pure and isomorphic; import it from `@/lib/banner` only. Client components import `@/lib/github/schema`, `/samples`, `/calendar` or `/errors` directly, never the `@/lib/github` index.
- **New top-level route?** Add its folder name to `RESERVED_SEGMENTS` in `src/lib/reserved.ts`, or image requests below it are read as a GitHub login.
- **Secrets** never go into commits, logs or test fixtures.

## Commits and pull requests

Conventional prefixes, as in the history: `feat(scope):`, `fix(scope):`, `perf:`, `refactor:`, `chore:`, `docs:`. Keep a pull request to one change, say what you verified and how, and include a banner URL or a screenshot when the change is visual.

By contributing you agree that your contribution is licensed under the MIT License of this repository.
