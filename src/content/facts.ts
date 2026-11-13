/**
 * Numbers the copy states that live in server-only modules, which content
 * (isomorphic by contract) cannot import. `facts.test.ts` compares every
 * value with the code it mirrors, so a changed limit fails the tests until
 * the copy is updated with it.
 *
 * Whatever a pure module exports is imported where it is used instead:
 * cache lifetimes from `@/lib/http/cache-headers`, plan limits from
 * `@/lib/pro/entitlements`, banner registries from `@/lib/banner`.
 */
export const FACTS = {
  /** `POLICIES` in `src/lib/ratelimit.ts`. */
  rateLimits: {
    api: { name: "api", limit: 120, windowSeconds: 60 },
    search: { name: "search", limit: 60, windowSeconds: 60 },
  },
  /** `SESSION_MAX_AGE` in `src/lib/auth/session-token.ts`, in days. */
  sessionDays: 30,
  /** `SIGN_IN_TX_MAX_AGE` in `src/lib/auth/session-token.ts`, in minutes. */
  signInMinutes: 10,
  /** `cacheLife.github.revalidate` in `next.config.ts`, in minutes. */
  dataRefreshMinutes: 15,
  /** How long a last good copy of GitHub data is kept (`src/lib/github/cached.ts`), in days. */
  lastGoodDays: 7,
  /** Notice between the `Deprecation` and the `Sunset` date of an API operation. */
  deprecationNoticeDays: 90,
} as const;

/** "120 requests per 60 seconds" for one of the public quotas. */
export function quota(policy: keyof typeof FACTS.rateLimits): string {
  const { limit, windowSeconds } = FACTS.rateLimits[policy];
  return `${limit} requests per ${windowSeconds} seconds`;
}
