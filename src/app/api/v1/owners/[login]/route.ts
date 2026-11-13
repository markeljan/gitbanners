/**
 * GET /api/v1/owners/{login}[?year=2025][&view=preview]
 *
 * A GitHub user or organization as normalized JSON: profile, statistics,
 * contribution calendar, streaks, top repositories and languages.
 */
import { apiMethodNotAllowed, apiPreflight, publicApi } from "@/lib/api/http";
import { getOwnerData, parseYear } from "@/lib/api/service";
import { entityCacheTag } from "@/lib/http/cache-headers";

interface Context {
  params: Promise<{ login: string }>;
}

export async function GET(request: Request, context: Context) {
  const { login } = await context.params;
  return publicApi(request, "api", async (url) => {
    const owner = await getOwnerData(decodeURIComponent(login), {
      year: parseYear(url.searchParams.get("year")),
      view: url.searchParams.get("view") === "preview" ? "preview" : "full",
    });
    return { body: owner, tags: [entityCacheTag("owner", owner.login)] };
  });
}

export {
  apiMethodNotAllowed as DELETE,
  apiMethodNotAllowed as PATCH,
  apiMethodNotAllowed as POST,
  apiMethodNotAllowed as PUT,
  apiPreflight as OPTIONS,
};
