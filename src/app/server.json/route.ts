/** GET /server.json: manifest for the official MCP registry. */
import {
  documentResponse,
  jsonBody,
  registryManifest,
} from "@/lib/agent/discovery";

export function GET(request: Request): Response {
  return documentResponse(
    request,
    jsonBody(registryManifest()),
    "application/json; charset=utf-8",
  );
}
