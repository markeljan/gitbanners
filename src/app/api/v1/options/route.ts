/**
 * GET /api/v1/options
 *
 * Everything a banner URL can say: presets per kind, themes with their
 * colours, sizes, fonts and the documented query parameters.
 */
import { apiMethodNotAllowed, apiPreflight, publicApi } from "@/lib/api/http";
import { optionsCatalog } from "@/lib/api/service";
import { CACHE } from "@/lib/http/cache-headers";

export function GET(request: Request): Promise<Response> {
  return publicApi(request, "api", async () => ({
    body: optionsCatalog(),
    cache: CACHE.search,
  }));
}

export {
  apiMethodNotAllowed as DELETE,
  apiMethodNotAllowed as PATCH,
  apiMethodNotAllowed as POST,
  apiMethodNotAllowed as PUT,
  apiPreflight as OPTIONS,
};
