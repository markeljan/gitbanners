/** GET /api: the API index. */
import { apiMethodNotAllowed, apiPreflight, publicApi } from "@/lib/api/http";
import { apiIndex } from "@/lib/api/index-document";

export function GET(request: Request): Promise<Response> {
  return publicApi(request, "api", async () => ({ body: apiIndex() }));
}

export {
  apiMethodNotAllowed as DELETE,
  apiMethodNotAllowed as PATCH,
  apiMethodNotAllowed as POST,
  apiMethodNotAllowed as PUT,
  apiPreflight as OPTIONS,
};
