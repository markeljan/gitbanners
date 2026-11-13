/**
 * GET /api/auth/github/callback?code=…&state=…
 * (or ?error=access_denied&state=… when the user declined)
 *
 * Finishes "Sign in with GitHub". Every outcome is a 303 back to the page the
 * user started from; failures add `?auth_error=<code>`:
 *
 *   state_mismatch       no or wrong transaction cookie (expired, replayed)
 *   access_denied        the user declined on github.com
 *   github_error         GitHub reported another error
 *   missing_code         no authorization code in the request
 *   expired_code         the code was already used or is older than ten minutes
 *   rate_limited         too many sign-ins from this address
 *   accounts_unavailable accounts are not configured on this deployment
 *   sign_in_failed       anything else (GitHub or the database unreachable)
 */
import type { NextRequest } from "next/server";
import {
  canonicalOrigin,
  env,
  githubSignInAvailable,
  redirectTo,
} from "@/lib/auth/env";
import {
  exchangeCode,
  fetchGitHubUser,
  GitHubSignInError,
  safeReturnTo,
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

type AuthError =
  | "state_mismatch"
  | "access_denied"
  | "github_error"
  | "missing_code"
  | "expired_code"
  | "rate_limited"
  | "accounts_unavailable"
  | "sign_in_failed";

function backTo(returnTo: string, error?: AuthError): Response {
  // `returnTo` was validated when the flow started; it is validated again
  // where it is used, so nothing depends on what an old cookie contains.
  const url = new URL(safeReturnTo(returnTo), "http://internal.invalid");
  if (error) url.searchParams.set("auth_error", error);
  return redirectTo(url.pathname + url.search + url.hash);
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
    await completeSignIn(profile, { accessToken });
    return back();
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
