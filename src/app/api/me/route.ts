/**
 * GET /api/me
 *
 * Who is signed in, their plan and their limits. Meant for Client Components
 * on fully static pages (which call it only when the `gb_in` hint cookie is
 * present). Always private and never cached. Anonymous visitors get the same
 * shape with `user: null` and the free plan.
 *
 * DELETE /api/me
 *
 * Deletes the account: user record, login index, Pro cache and every saved
 * banner, then signs the browser out. 204 on success.
 */
import { revalidateTag } from "next/cache";
import { accountsAvailable } from "@/lib/auth/env";
import {
  clearSessionCookie,
  getSession,
  refreshSessionCookie,
  withUser,
} from "@/lib/auth/session";
import { countBanners } from "@/lib/db/banners";
import { deleteUser, getUser } from "@/lib/db/users";
import { entityCacheTag, PRIVATE_NO_STORE } from "@/lib/http/cache-headers";
import { methodGuards, unavailable } from "@/lib/http/problem";
import { entitlementsFor, FREE, getProStatus } from "@/lib/pro";
import { StoreUnavailableError } from "@/lib/store";

const HEADERS = { ...PRIVATE_NO_STORE, Vary: "Cookie" };

const { notAllowed, options } = methodGuards(["GET", "DELETE"]);

export {
  notAllowed as PATCH,
  notAllowed as POST,
  notAllowed as PUT,
  options as OPTIONS,
};

function anonymous(): Response {
  return Response.json(
    {
      user: null,
      pro: false,
      entitlements: FREE,
      banners: { count: 0, max: FREE.maxSavedBanners },
    },
    { headers: HEADERS },
  );
}

export async function GET(): Promise<Response> {
  // Reading the cookie is what keeps this handler dynamic. Without a request
  // read the build would prerender one frozen answer for everybody.
  const session = await getSession();
  if (!session || !accountsAvailable()) return anonymous();
  try {
    const user = await getUser(session.uid);
    if (!user || user.sv !== session.sv) {
      // Revoked or deleted: drop the dead cookie so the client stops asking.
      await clearSessionCookie();
      return anonymous();
    }
    const [status, count] = await Promise.all([
      getProStatus(user.id),
      countBanners(user.id),
    ]);
    // Sliding expiry, and the place a renamed login or new avatar reaches the
    // cookie.
    await refreshSessionCookie({
      ...session,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatarUrl,
    });
    const entitlements = entitlementsFor(status.pro);
    return Response.json(
      {
        user: {
          id: user.id,
          login: user.login,
          name: user.name,
          avatarUrl: user.avatarUrl,
        },
        pro: status.pro,
        entitlements,
        banners: { count, max: entitlements.maxSavedBanners },
      },
      { headers: HEADERS },
    );
  } catch (error) {
    if (!(error instanceof StoreUnavailableError)) throw error;
    return unavailable(5, {
      detail: "The account store is temporarily unavailable.",
      instance: "/api/me",
      headers: HEADERS,
    });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  return withUser(request, { policy: "mutations" }, async ({ user }) => {
    const bannerIds = await deleteUser(user.id);
    await clearSessionCookie();
    // Cached images must not outlive the account they belonged to.
    for (const id of bannerIds) {
      revalidateTag(entityCacheTag("saved", id), { expire: 0 });
    }
    revalidateTag(entityCacheTag("owner", user.login), { expire: 0 });
    return new Response(null, { status: 204 });
  });
}
