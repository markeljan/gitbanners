/** GET /openapi.json: OpenAPI 3.1 description of the public API. */
import { documentResponse, OPENAPI_MEDIA_TYPE } from "@/lib/agent/discovery";
import { openApiDocument } from "@/lib/agent/openapi";

export function GET(request: Request): Response {
  // Compact on purpose: the document is read by tools and by agents that pay
  // per token, and indentation nearly doubles its size.
  return documentResponse(
    request,
    `${JSON.stringify(openApiDocument())}\n`,
    `${OPENAPI_MEDIA_TYPE}; charset=utf-8`,
  );
}
