/**
 * GET /api/auth/github?returnTo=/studio
 *
 * Starts "Sign in with GitHub": answers 302 to github.com with a `state`
 * value and a PKCE challenge, and remembers both in a ten-minute cookie.
 *
 * Link to it with a plain `<a>`, never `<Link>`: a prefetch would mint
 * cookies and follow the redirect.
 */
import type { NextRequest } from "next/server";
import {
  canonicalOrigin,
  env,
  githubSignInAvailable,
  requestOrigin,
} from "@/lib/auth/env";
import {
  buildAuthorizeUrl,
  randomToken,
  safeReturnTo,
} from "@/lib/auth/github";
import { setSignInCookie } from "@/lib/auth/session";
import { methodGuards, problem, unavailable } from "@/lib/http/problem";

const PATH = "/api/auth/github";

const { notAllowed, options } = methodGuards(["GET"]);
export {
  notAllowed as DELETE,
  notAllowed as PATCH,
  notAllowed as POST,
  notAllowed as PUT,
  options as OPTIONS,
};

function redirect(location: string, status: 302 | 307): Response {
  return new Response(null, {
    status,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  // Reading the request also keeps this handler out of build-time prerendering.
  const params = request.nextUrl.searchParams;
  const returnTo = safeReturnTo(params.get("returnTo"));

  if (!githubSignInAvailable()) {
    return unavailable(undefined, {
      code: "accounts_unavailable",
      title: "Accounts are not configured on this deployment",
      detail:
        "GitHub sign-in needs a database, a session secret and GitHub app credentials, and this deployment is missing at least one of them. Public banners work without an account.",
      instance: PATH,
    });
  }

  // The transaction cookie is host-only, so the flow has to start on the host
  // GitHub will send the user back to (someone may have opened a deployment
  // alias instead of the canonical domain).
  const origin = canonicalOrigin(request);
  if (requestOrigin(request) !== origin) {
    if (params.has("canonical")) {
      // We already sent the browser to the canonical origin and it came back
      // somewhere else: a misconfigured site URL. Stop instead of looping.
      return problem(500, {
        code: "origin_mismatch",
        title: "Sign-in is misconfigured",
        detail:
          "The canonical site URL of this deployment does not lead back to it.",
        instance: PATH,
      });
    }
    const start = new URL(PATH, origin);
    start.searchParams.set("returnTo", returnTo);
    start.searchParams.set("canonical", "1");
    return redirect(start.toString(), 307);
  }

  const state = randomToken();
  const codeVerifier = randomToken();
  await setSignInCookie({ state, codeVerifier, returnTo });
  const authorizeUrl = await buildAuthorizeUrl({
    clientId: env.githubClientId,
    redirectUri: `${origin}${PATH}/callback`,
    state,
    codeVerifier,
  });
  return redirect(authorizeUrl, 302);
}
