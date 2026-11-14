/**
 * What to tell the visitor for each `?auth_error=<code>` the sign-in
 * callback can send back (see `src/app/api/auth/github/callback/route.ts`).
 */
export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  state_mismatch:
    "That sign-in attempt expired or was already used. Sign in again to continue.",
  access_denied:
    "Sign-in was cancelled on GitHub. Nothing changed on your account.",
  github_error:
    "GitHub reported a problem while signing you in. Try again in a moment.",
  missing_code:
    "GitHub did not send a sign-in code back. Sign in again to continue.",
  expired_code:
    "The sign-in code from GitHub expired before it could be used. Sign in again.",
  rate_limited:
    "Too many sign-in attempts from this network. Wait a few minutes, then try again.",
  accounts_unavailable:
    "Accounts are not available on this deployment. Public banners work without signing in.",
  sign_in_failed:
    "Sign-in did not finish because GitHub or our database could not be reached. Try again in a moment.",
};

const FALLBACK_MESSAGE = "Sign-in did not finish. Try again in a moment.";

/** The sentence for an `auth_error` code, known or not. */
export function authErrorMessage(code: string): string {
  return Object.hasOwn(AUTH_ERROR_MESSAGES, code)
    ? AUTH_ERROR_MESSAGES[code]
    : FALLBACK_MESSAGE;
}

/**
 * Removes `auth_error` from a URL's query. Returns the new relative URL, or
 * `null` when the parameter is absent.
 */
export function withoutAuthError(href: string): string | null {
  const url = new URL(href);
  if (!url.searchParams.has("auth_error")) return null;
  url.searchParams.delete("auth_error");
  return `${url.pathname}${url.search}${url.hash}`;
}

/** What the page says after "I starred it, check again". */
export function proCheckMessage(
  result: string,
  repo: string,
): { body: string; type: "info" | "error" } | null {
  switch (result) {
    case "pro":
      return { body: `Pro is on. Thanks for starring ${repo}!`, type: "info" };
    case "not_starred":
      return {
        body: `GitHub does not show a star from you on ${repo} yet. Star it, wait a few seconds, then check again.`,
        type: "error",
      };
    case "unverified":
      return {
        body: `Your star on ${repo} could not be confirmed with GitHub right now, so your plan did not change. Try again in a minute.`,
        type: "error",
      };
    default:
      return null;
  }
}

/** Removes `pro_check` from a URL's query, or `null` when it is absent. */
export function withoutProCheck(href: string): string | null {
  const url = new URL(href);
  if (!url.searchParams.has("pro_check")) return null;
  url.searchParams.delete("pro_check");
  return `${url.pathname}${url.search}${url.hash}`;
}
