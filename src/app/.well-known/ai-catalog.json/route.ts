/** GET /.well-known/ai-catalog.json: AI Catalog of the agent-facing resources. */
import { aiCatalog, documentResponse, jsonBody } from "@/lib/agent/discovery";

export function GET(request: Request): Response {
  return documentResponse(
    request,
    jsonBody(aiCatalog()),
    "application/ai-catalog+json; charset=utf-8",
  );
}
