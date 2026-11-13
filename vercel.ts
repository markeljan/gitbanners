import type { VercelConfig } from "@vercel/config/v1";

/**
 * Platform-only settings. App routing (headers / redirects / rewrites) lives in
 * next.config.ts so it behaves the same under `next dev`.
 * Compiled by the Vercel CLI on every build; inspect the result in .vercel/vercel.json.
 */
export const config: VercelConfig = {
  framework: "nextjs",
  // The build image's own bun can be older than the one that wrote bun.lock
  // (an unknown lockfile version fails the install), so install with the
  // exact version package.json pins. `--frozen-lockfile` because the default
  // plain install would rewrite a drifted lockfile.
  installCommand:
    "npx --yes bun@$(node -p \"require('./package.json').packageManager.split('@')[1]\") install --frozen-lockfile",
  // Next to api.github.com and the Redis store (us-east-1).
  regions: ["iad1"],
  functions: {
    // Safety net so a hung upstream call cannot burn the CPU budget.
    // A route's own `export const maxDuration` wins.
    "src/app/**/route.ts": { maxDuration: 30 },
    "src/app/**/route.tsx": { maxDuration: 30 },
  },
  git: {
    // No preview deployments for dependency-bot branches.
    deploymentEnabled: { "dependabot/**": false, "renovate/**": false },
  },
};
