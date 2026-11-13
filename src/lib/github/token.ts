/**
 * Server credential for the GitHub API.
 *
 * Production reads `GITHUB_TOKEN` and nothing else. In local development the
 * GitHub CLI's token is used as a fallback so `bun dev` and the scripts work
 * with zero configuration. Unit tests never shell out: they must behave the
 * same on a laptop with `gh` signed in and on a CI runner without it.
 *
 * The token is never logged, never put into an error message and never
 * leaves this process except in the `Authorization` header to api.github.com.
 *
 * Which token: one of a dedicated account (or a GitHub App installation)
 * with no scopes beyond public access. The queries are public-only whoever
 * owns the token, with one exception GitHub offers no switch for: its schema
 * documents that a token with the `read:user` scope includes its OWN owner's
 * private contributions in that owner's calendar. A token that belongs to
 * nobody with a banner cannot leak anything.
 */
import { execFileSync } from "node:child_process";

/** `undefined` = not looked up yet, `null` = looked up and unavailable. */
let cliToken: string | null | undefined;

function readCliToken(): string | null {
  try {
    const out = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      // stderr is dropped: `gh` prints sign-in hints there when logged out.
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3_000,
    });
    return out.trim() || null;
  } catch {
    // `gh` is not installed, not signed in, or too slow: no token, no noise.
    return null;
  }
}

/**
 * The server's GitHub token, or `null` when none is configured.
 *
 * `GITHUB_TOKEN` wins. Only when it is unset and `NODE_ENV` is neither
 * `production` nor `test`, `gh auth token` is consulted once per process.
 */
export function getServerToken(): string | null {
  const fromEnv = process.env.GITHUB_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const mode = process.env.NODE_ENV;
  if (mode === "production" || mode === "test") return null;
  if (cliToken === undefined) cliToken = readCliToken();
  return cliToken;
}

/**
 * Whether authenticated requests are possible. When false the data layer
 * degrades to bundled samples and the tokenless fallback (`fallback.ts`).
 */
export function hasGitHubToken(): boolean {
  return getServerToken() !== null;
}
