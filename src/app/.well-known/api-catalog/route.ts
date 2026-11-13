/**
 * GET /.well-known/api-catalog: RFC 9727 API catalog as a linkset. HEAD
 * answers with the same `Link` header, as the RFC asks.
 */
import {
  apiCatalog,
  documentResponse,
  jsonBody,
  OPENAPI_MEDIA_TYPE,
} from "@/lib/agent/discovery";
import { absoluteUrl } from "@/lib/site";

export function GET(request: Request): Response {
  return documentResponse(
    request,
    jsonBody(apiCatalog()),
    'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
    {
      Link: [
        `<${absoluteUrl("/.well-known/api-catalog")}>; rel="api-catalog"`,
        `<${absoluteUrl("/openapi.json")}>; rel="service-desc"; type="${OPENAPI_MEDIA_TYPE}"`,
      ].join(", "),
    },
  );
}
