import type { VercelConfig } from "@vercel/config/v1";

/**
 * Platform-only settings. App routing (headers / redirects / rewrites) lives in
 * next.config.ts so it behaves the same under `next dev`.
 * Compiled by the Vercel CLI on every build; inspect the result in .vercel/vercel.json.
 */
export const config: VercelConfig = {
  framework: "nextjs",
  // Vercel's default is a plain `bun install`, which would rewrite a drifted lockfile.
  installCommand: "bun install --frozen-lockfile",
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
