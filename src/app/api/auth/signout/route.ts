/**
 * POST /api/auth/signout[?everywhere=1]
 *
 * Signs this browser out. With `everywhere=1` every session of the user is
 * revoked as well. A form post gets a 303 to the home page (a full navigation,
 * so nothing rendered for the signed-in user survives); a `fetch` that accepts
 * JSON gets `{ "ok": true }`.
 *
 * GET is refused on purpose (405): a link or an `<img>` must not be able to
 * sign anyone out.
 */
import type { NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/auth/csrf";
import { redirectTo } from "@/lib/auth/env";
import { clearSessionCookie, requireUser } from "@/lib/auth/session";
import { bumpSessionVersion } from "@/lib/db/users";
import { PRIVATE_NO_STORE } from "@/lib/http/cache-headers";
import { forbidden, methodGuards, unavailable } from "@/lib/http/problem";
import { StoreUnavailableError } from "@/lib/store";

const PATH = "/api/auth/signout";

// GET answers 405 like the other methods this route lacks: a link, an image
// tag or a prefetch must never be able to sign anyone out.
const { notAllowed, options } = methodGuards(["POST"]);

export {
  notAllowed as DELETE,
  notAllowed as GET,
  notAllowed as PATCH,
  notAllowed as PUT,
  options as OPTIONS,
};

export async function POST(request: NextRequest): Promise<Response> {
  if (!isSameOrigin(request)) {
    return forbidden("Cross-origin requests cannot sign you out.", {
      code: "cross_origin_request",
      instance: PATH,
      headers: PRIVATE_NO_STORE,
    });
  }
  if (request.nextUrl.searchParams.get("everywhere") === "1") {
    try {
      // Only a session that is still valid may revoke the others. A cookie
      // that was itself revoked (a stolen one, say, after its owner signed
      // out everywhere) must not be able to sign the owner out again and
      // again: it verifies until it expires, but it no longer speaks for them.
      const auth = await requireUser();
      if (auth) await bumpSessionVersion(auth.user.id);
    } catch (error) {
      if (!(error instanceof StoreUnavailableError)) throw error;
      // Saying "signed out everywhere" while other sessions stay valid would
      // be a lie, so nothing is cleared and the caller can retry.
      return unavailable(5, {
        detail: "Your other sessions could not be revoked right now.",
        instance: PATH,
        headers: PRIVATE_NO_STORE,
      });
    }
  }
  await clearSessionCookie();
  if (request.headers.get("accept")?.includes("application/json")) {
    return Response.json({ ok: true }, { headers: PRIVATE_NO_STORE });
  }
  return redirectTo("/");
}
