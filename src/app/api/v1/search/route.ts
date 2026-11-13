/**
 * GET /api/v1/search?q=verc
 *
 * Typeahead: accounts for a login prefix, repositories for `owner/prefix`.
 */
import { apiMethodNotAllowed, apiPreflight, publicApi } from "@/lib/api/http";
import { searchData } from "@/lib/api/service";
import { CACHE } from "@/lib/http/cache-headers";

export function GET(request: Request): Promise<Response> {
  return publicApi(request, "search", async (url) => ({
    body: await searchData(url.searchParams.get("q") ?? ""),
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
