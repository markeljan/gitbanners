/** GET /.well-known/ard.json: Agentic Resource Discovery catalog. */
import { ardCatalog, documentResponse, jsonBody } from "@/lib/agent/discovery";

export function GET(request: Request): Response {
  return documentResponse(
    request,
    jsonBody(ardCatalog()),
    "application/json; charset=utf-8",
  );
}
