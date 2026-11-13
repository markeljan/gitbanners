import "server-only";
import { site } from "@/lib/site";
import { storeIsDurable } from "@/lib/store";
import { safeReturnTo } from "./github";
import { hasSessionSecret } from "./session-token";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

/**
 * Lazy getters: nothing is read at import time, so the app builds and boots
 * without the secrets and only the routes that need them fail.
 */
export const env = {
  get githubClientId(): string {
    return required("GITHUB_CLIENT_ID");
  },
  get githubClientSecret(): string {
    return required("GITHUB_CLIENT_SECRET");
  },
};

/**
 * Whether accounts can work at all on this deployment: sessions can be signed
 * and whatever gets written survives the request. A deployment without Redis
 * still serves public banners; it just has no accounts.
 */
export function accountsAvailable(): boolean {
  return hasSessionSecret() && storeIsDurable();
}

/**
 * `accountsAvailable()` plus the GitHub app credentials the sign-in flow needs.
 */
export function githubSignInAvailable(): boolean {
  return (
    accountsAvailable() &&
    Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)
  );
}

/**
 * The origin the browser actually used.
 *
 * Not `new URL(request.url).origin`: under `next start` and `next dev` that
 * always carries the server's own hostname, whatever the client asked for.
 * Next.js fills `x-forwarded-host` / `x-forwarded-proto` itself when no proxy
 * did; on Vercel they carry the public domain.
 */
export function requestOrigin(request: Request): string {
  const fallback = new URL(request.url).origin;
  const host = (
    request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  )
    ?.split(",")[0]
    ?.trim();
  if (!host) return fallback;
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
  try {
    // Through URL so case and default ports cannot make equal origins differ.
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return fallback;
  }
}

/**
 * The origin sign-in runs on, which is also where GitHub sends the user back
 * (the callback URL registered with the GitHub app).
 *
 * The transaction cookie is host-only, so the flow must start and end on the
 * same host: in production that is the canonical site URL, even when the
 * visitor arrived through a deployment alias. In development it is whatever
 * address the developer typed.
 */
export function canonicalOrigin(request: Request): string {
  return process.env.NODE_ENV === "development"
    ? requestOrigin(request)
    : new URL(site.url).origin;
}

/**
 * Same-origin redirect with a relative `Location`: no origin guessing, and
 * cookies written through `cookies()` still apply to the response.
 *
 * No `Referrer-Policy` of its own: Next keeps the site-wide one from
 * next.config.ts when a handler sets the same header, and that policy
 * (origin only across origins) already keeps the callback's query private.
 */
export function redirectTo(
  path: string,
  status: 302 | 303 | 307 = 303,
): Response {
  return new Response(null, {
    status,
    headers: { Location: path, "Cache-Control": "no-store" },
  });
}

/**
 * What went wrong, as the sign-in routes report it in `?auth_error=<code>`.
 * `src/components/site/auth-errors.ts` has the sentence shown for each.
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
export type AuthError =
  | "state_mismatch"
  | "access_denied"
  | "github_error"
  | "missing_code"
  | "expired_code"
  | "rate_limited"
  | "accounts_unavailable"
  | "sign_in_failed";

/**
 * 303 back to the page sign-in started from, with `?auth_error=<code>` when
 * it failed, so the page can say what happened. `returnTo` is made safe here
 * again: nothing depends on what a request or an old cookie contains.
 */
export function backTo(returnTo: string, error?: AuthError): Response {
  const url = new URL(safeReturnTo(returnTo), "http://internal.invalid");
  if (error) url.searchParams.set("auth_error", error);
  return redirectTo(url.pathname + url.search + url.hash);
}
