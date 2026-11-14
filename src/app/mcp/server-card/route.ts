/** GET /mcp/server-card: the MCP server card, where clients look for it first. */
import { documentResponse, jsonBody, serverCard } from "@/lib/agent/discovery";

export function GET(request: Request): Response {
  return documentResponse(
    request,
    jsonBody(serverCard()),
    "application/mcp-server-card+json; charset=utf-8",
  );
}
