/**
 * CSRF guard for cookie-authenticated, state-changing Route Handlers
 * (POST, PATCH, DELETE).
 *
 * Next.js checks `Origin` for Server Actions but does nothing for Route
 * Handlers, and `SameSite=Lax` alone still lets a sibling subdomain through.
 */
export function isSameOrigin(request: Request): boolean {
  // Fetch Metadata: sent by every current browser and not settable from page
  // JavaScript. "same-site" (a sibling subdomain) is deliberately not enough.
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";

  // Older browsers: compare the host of `Origin` with the host addressed.
  const origin = request.headers.get("origin");
  // No browser omits both headers on a cross-site write, so their absence
  // means a script, which has no business using the session cookie.
  if (!origin) return false;
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
