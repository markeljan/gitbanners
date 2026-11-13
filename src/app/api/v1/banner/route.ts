/**
 * GET /api/v1/banner?target=vercel/next.js[&preset=contributors][&theme=…]
 *
 * Image URLs, embed snippets, dimensions and alt text of one banner, after
 * checking with GitHub that the target exists. Takes the same option
 * parameters as the image URLs.
 */
import { apiMethodNotAllowed, apiPreflight, publicApi } from "@/lib/api/http";
import { describeBanner } from "@/lib/api/service";
import { parseOptions } from "@/lib/banner";
import { entityCacheTag } from "@/lib/http/cache-headers";

export function GET(request: Request): Promise<Response> {
  return publicApi(request, "api", async (url) => {
    const banner = await describeBanner({
      target: url.searchParams.get("target") ?? "",
      preset: url.searchParams.get("preset"),
      options: parseOptions(url.searchParams),
    });
    const { target } = banner;
    return {
      body: banner,
      tags:
        target.kind === "owner"
          ? [entityCacheTag("owner", target.login)]
          : [
              entityCacheTag("repo", `${target.owner}/${target.name}`),
              entityCacheTag("owner", target.owner),
            ],
    };
  });
}

export {
  apiMethodNotAllowed as DELETE,
  apiMethodNotAllowed as PATCH,
  apiMethodNotAllowed as POST,
  apiMethodNotAllowed as PUT,
  apiPreflight as OPTIONS,
};
