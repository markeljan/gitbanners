/**
 * GET /api/auth/github/callback?code=…&state=…
 * (or ?error=access_denied&state=… when the user declined)
 *
 * Finishes "Sign in with GitHub". Every outcome is a 303 back to the page the
 * user started from; failures add `?auth_error=<code>` (the codes are listed
 * at `AuthError` in `src/lib/auth/env.ts`).
 */
import type { NextRequest } from "next/server";
import {
  type AuthError,
  backTo,
  canonicalOrigin,
  env,
  githubSignInAvailable,
} from "@/lib/auth/env";
import {
  exchangeCode,
  fetchGitHubUser,
  GitHubSignInError,
  timingSafeEqual,
} from "@/lib/auth/github";
import { completeSignIn, consumeSignInCookie } from "@/lib/auth/session";
import { methodGuards } from "@/lib/http/problem";
import { clientIp, limit } from "@/lib/ratelimit";

const { notAllowed, options } = methodGuards(["GET"]);

export {
  notAllowed as DELETE,
  notAllowed as PATCH,
  notAllowed as POST,
  notAllowed as PUT,
  options as OPTIONS,
};

/** GitHub's codes are 20 characters; anything long is not one. */
const MAX_CODE_LENGTH = 256;
/** What an error code or an error class name looks like. */
const LOGGABLE_REASON = /^\w{1,64}$/;

/**
 * "I starred it, check again" signs in with `pro_check` in its return
 * address. The answer replaces it, so the page can say what happened:
 * `pro`, `not_starred` (GitHub says no star) or `unverified` (no check could
 * answer; the plan stayed as it was).
 */
function withProCheck(
  returnTo: string,
  pro: { pro: boolean; verdict: "starred" | "not_starred" | "unknown" },
): string {
  const url = new URL(returnTo, "http://internal.invalid");
  if (!url.searchParams.has("pro_check")) return returnTo;
  url.searchParams.set(
    "pro_check",
    pro.pro
      ? "pro"
      : pro.verdict === "not_starred"
        ? "not_starred"
        : "unverified",
  );
  return url.pathname + url.search + url.hash;
}

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  // Single use: the cookie is cleared whatever happens next.
  const tx = await consumeSignInCookie();
  const back = (error?: AuthError) => backTo(tx?.returnTo ?? "/", error);

  const state = params.get("state");
  if (!tx || !state || !timingSafeEqual(state, tx.state)) {
    return back("state_mismatch");
  }
  const githubError = params.get("error");
  if (githubError) {
    return back(
      githubError === "access_denied" ? "access_denied" : "github_error",
    );
  }
  const code = params.get("code");
  if (!code || code.length > MAX_CODE_LENGTH) return back("missing_code");
  if (!githubSignInAvailable()) return back("accounts_unavailable");

  // After the state check, so requests without a valid transaction cost no
  // database round trip.
  const rate = await limit("auth", `ip:${clientIp(request)}`);
  if (!rate.ok) return back("rate_limited");

  try {
    // The token lives in this scope only: never stored, logged or put in a
    // cookie. It is not revoked afterwards either. That would be one more call
    // that can fail on this path, and it is unverified that revoking a token
    // leaves the user's authorization in place (without it every later
    // sign-in would show the consent screen again). The token has no scopes;
    // GitHub expires it after eight hours where token expiry is enabled (the
    // default for new apps) and keeps at most ten per user otherwise.
    const accessToken = await exchangeCode({
      clientId: env.githubClientId,
      clientSecret: env.githubClientSecret,
      code,
      codeVerifier: tx.codeVerifier,
      // Must equal the one sent to the authorize endpoint.
      redirectUri: `${canonicalOrigin(request)}/api/auth/github/callback`,
    });
    const profile = await fetchGitHubUser(accessToken);
    const { pro } = await completeSignIn(profile, { accessToken });
    return backTo(withProCheck(tx.returnTo, pro), undefined);
  } catch (error) {
    const reason =
      error instanceof GitHubSignInError
        ? error.code
        : error instanceof Error
          ? error.name
          : "unknown";
    // Never the code, the token or the URL. An error code is whatever the
    // token endpoint answered, so only a short plain word reaches the log.
    console.error(
      "GitHub sign-in callback failed:",
      LOGGABLE_REASON.test(reason) ? reason : "unrecognised_error",
    );
    return back(
      error instanceof GitHubSignInError &&
        error.code === "bad_verification_code"
        ? "expired_code"
        : "sign_in_failed",
    );
  }
}
