/**
 * GET /api/banners
 *
 * The signed-in user's saved banners, most recently updated first.
 *
 * POST /api/banners
 *
 * Saves a banner. Body: `{ name, target, preset?, query?, isDefault? }`.
 * 201 with the banner and a `Location` header. 403 `banner_limit_reached`
 * when the plan's quota is used up.
 */
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { loginChanged, withUser } from "@/lib/auth/session";
import {
  bannerInputSchema,
  createBanner,
  deleteBanner,
  getDefaultBannerId,
  listBanners,
  setDefaultBanner,
  toBannerView,
} from "@/lib/db/banners";
import { entityCacheTag } from "@/lib/http/cache-headers";
import { forbidden, methodGuards } from "@/lib/http/problem";
import { getEntitlements, proRepoSlug, proRequired } from "@/lib/pro";

const { notAllowed, options } = methodGuards(["GET", "POST"]);
export {
  notAllowed as DELETE,
  notAllowed as PATCH,
  notAllowed as PUT,
  options as OPTIONS,
};

const createSchema = bannerInputSchema.extend({
  isDefault: z.boolean().optional(),
});

export async function GET(request: Request): Promise<Response> {
  return withUser(request, { policy: "api" }, async ({ user }) => {
    const [banners, defaultId] = await Promise.all([
      listBanners(user.id),
      getDefaultBannerId(user),
    ]);
    return Response.json({
      banners: banners.map((banner) => toBannerView(banner, defaultId)),
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  return withUser(
    request,
    { policy: "mutations", body: createSchema },
    async ({ user, body }) => {
      const { isDefault = false, ...input } = body;
      const entitlements = await getEntitlements(user.id);
      if (isDefault && !entitlements.canSetDefault) {
        return proRequired(
          "Only Pro accounts can choose the banner served at their profile URL.",
        );
      }

      const created = await createBanner(
        user.id,
        input,
        entitlements.maxSavedBanners,
      );
      if (!created.ok) {
        return forbidden(
          `Your plan allows ${entitlements.maxSavedBanners} saved banners.`,
          {
            code: "banner_limit_reached",
            title: "Saved banner limit reached",
            resolution:
              entitlements.plan === "pro"
                ? "Delete a saved banner to make room."
                : `Delete a saved banner, or star ${proRepoSlug()} on GitHub and sign in again to unlock Pro.`,
            extra: {
              limit: entitlements.maxSavedBanners,
              plan: entitlements.plan,
            },
          },
        );
      }

      const { banner } = created;
      if (isDefault) {
        if (!(await setDefaultBanner(user, banner.id))) {
          // Do not leave behind a banner the caller was told failed.
          await deleteBanner(user, banner.id);
          return loginChanged();
        }
        revalidateTag(entityCacheTag("owner", user.login), { expire: 0 });
      }
      return Response.json(
        { banner: toBannerView(banner, isDefault ? banner.id : null) },
        { status: 201, headers: { Location: `/api/banners/${banner.id}` } },
      );
    },
  );
}
