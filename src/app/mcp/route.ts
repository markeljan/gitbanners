/**
 * POST /mcp: the MCP server (Streamable HTTP, stateless, no credentials).
 *
 * `mcp-handler` serves the 2026-07-28 revision natively and 2025-era
 * clients through its stateless fallback. GET and DELETE reach the handler
 * too, so it can answer 405 with a JSON-RPC error body: there are no
 * sessions to open a stream for or to end.
 *
 * Calls are counted per client IP against the same quota as the JSON API,
 * and every answer carries the `RateLimit` fields and CORS for any origin
 * (the server is public and uses no cookies).
 */
import { createMcpHandler } from "mcp-handler";
import { MCP_SERVER } from "@/lib/agent/identity";
import { registerTools } from "@/lib/agent/mcp";
import { clientIp, limit, POLICIES } from "@/lib/ratelimit";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
  "Access-Control-Expose-Headers": "RateLimit, RateLimit-Policy, Retry-After",
} as const;

const handler = createMcpHandler(registerTools, {
  serverInfo: { name: MCP_SERVER.name, version: MCP_SERVER.version },
  instructions: MCP_SERVER.instructions,
});

/** The handler's answer with extra headers. The body is passed through as a stream. */
function withHeaders(
  response: Response,
  extra: Record<string, string>,
): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function POST(request: Request): Promise<Response> {
  const rate = await limit("api", `ip:${clientIp(request)}`);
  if (!rate.ok) {
    const wait = Math.max(1, rate.resetSeconds);
    return Response.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: `Rate limit exceeded: ${rate.limit} requests per ${POLICIES.api.windowSeconds} seconds. Retry in ${wait} seconds.`,
          data: { code: "rate_limited", retry_after: wait },
        },
        id: null,
      },
      {
        status: 429,
        headers: { ...CORS, ...rate.headers, "Cache-Control": "no-store" },
      },
    );
  }
  return withHeaders(await handler(request), { ...CORS, ...rate.headers });
}

/** 405 with a JSON-RPC error body, from the handler itself. */
async function notServed(request: Request): Promise<Response> {
  return withHeaders(await handler(request), CORS);
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: { ...CORS, Allow: "POST, OPTIONS" },
  });
}

export { notServed as DELETE, notServed as GET };
