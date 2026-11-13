/**
 * GET /api/banners/{id}     one saved banner of the signed-in user
 * PATCH /api/banners/{id}   change it; body:
 *                           `{ name?, target?, preset?, query?, isDefault? }`
 * DELETE /api/banners/{id}  delete it (204)
 *
 * A banner that belongs to someone else answers 404 like one that does not
 * exist, so the API never reveals which ids are taken.
 */
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { loginChanged, withUser } from "@/lib/auth/session";
import { canonicalQuery } from "@/lib/banner";
import {
  bannerPatchSchema,
  deleteBanner,
  getDefaultBannerId,
  getOwnedBanner,
  setDefaultBanner,
  toBannerView,
  updateBanner,
} from "@/lib/db/banners";
import { entityCacheTag } from "@/lib/http/cache-headers";
import { methodGuards, notFound } from "@/lib/http/problem";
import { getEntitlements, proRequired } from "@/lib/pro";

const { notAllowed, options } = methodGuards(["GET", "PATCH", "DELETE"]);
export { notAllowed as POST, notAllowed as PUT, options as OPTIONS };

const patchSchema = bannerPatchSchema
  .extend({ isDefault: z.boolean().optional() })
  .refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    "Provide at least one field to change.",
  );

function noSuchBanner(): Response {
  return notFound("You have no saved banner with this id.");
}

/**
 * Drops the cached image of the banner and, if needed, of the owner's profile
 * URL.
 */
function purge(id: string, ownerLogin: string | null): void {
  revalidateTag(entityCacheTag("saved", id), { expire: 0 });
  if (ownerLogin) {
    revalidateTag(entityCacheTag("owner", ownerLogin), { expire: 0 });
  }
}

export async function GET(
  request: Request,
  context: RouteContext<"/api/banners/[id]">,
): Promise<Response> {
  const { id } = await context.params;
  return withUser(request, { policy: "api" }, async ({ user }) => {
    const banner = await getOwnedBanner(user.id, id);
    if (!banner) return noSuchBanner();
    return Response.json({
      banner: toBannerView(banner, await getDefaultBannerId(user)),
    });
  });
}

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/banners/[id]">,
): Promise<Response> {
  const { id } = await context.params;
  return withUser(
    request,
    { policy: "mutations", body: patchSchema },
    async ({ user, body }) => {
      const { isDefault, ...patch } = body;
      if (patch.query !== undefined) patch.query = canonicalQuery(patch.query);
      if (isDefault && !(await getEntitlements(user.id)).canSetDefault) {
        return proRequired(
          "Only Pro accounts can choose the banner served at their profile URL.",
        );
      }

      const current = await getOwnedBanner(user.id, id);
      if (!current) return noSuchBanner();

      // The pointer first: it is the step that can still be refused, and
      // nothing has been written yet if it is.
      let defaultId = await getDefaultBannerId(user);
      const wasDefault = defaultId === id;
      // Clearing is open to everyone: someone who lost Pro must still be able
      // to take their default down.
      const wanted = isDefault ?? wasDefault;
      if (wanted !== wasDefault) {
        if (!(await setDefaultBanner(user, wanted ? id : null))) {
          return loginChanged();
        }
        defaultId = wanted ? id : null;
      }

      const hasChanges = Object.values(patch).some(
        (value) => value !== undefined,
      );
      const banner = hasChanges
        ? await updateBanner(user.id, id, patch)
        : current;
      // Deleted by a parallel request between the two reads.
      if (!banner) return noSuchBanner();

      purge(id, wasDefault || wanted ? user.login : null);
      return Response.json({ banner: toBannerView(banner, defaultId) });
    },
  );
}

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/banners/[id]">,
): Promise<Response> {
  const { id } = await context.params;
  return withUser(request, { policy: "mutations" }, async ({ user }) => {
    const deleted = await deleteBanner(user, id);
    if (!deleted) return noSuchBanner();
    purge(id, deleted.wasDefault ? user.login : null);
    return new Response(null, { status: 204 });
  });
}
