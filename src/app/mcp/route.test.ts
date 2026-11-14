/**
 * The MCP endpoint, driven as an HTTP client would: handshake, tool
 * listing, one call per tool against the bundled samples (no token, no
 * network), the error paths, and the HTTP wrapper around the handler.
 */
import { describe, expect, test } from "bun:test";
import { MCP_SERVER, MCP_TOOLS } from "@/lib/agent/identity";
import { limit, POLICIES } from "@/lib/ratelimit";
import { DELETE, GET, OPTIONS, POST } from "./route";

interface Rpc {
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: Record<string, unknown> };
}

let nextId = 1;

async function rpc(
  method: string,
  params?: unknown,
  headers: Record<string, string> = {},
): Promise<{ response: Response; message: Rpc }> {
  nextId += 1;
  const response = await POST(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId, method, params }),
    }),
  );
  const text = await response.text();
  const data = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice(6);
  return { response, message: JSON.parse(data ?? text) as Rpc };
}

async function call(name: string, args: Record<string, unknown>) {
  const { message } = await rpc("tools/call", { name, arguments: args });
  const result = message.result as {
    content: { type: string; text: string }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
  return { message, result };
}

interface ListedTool {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  outputSchema: { type: string; properties?: Record<string, unknown> };
  annotations: Record<string, boolean>;
}

describe("handshake", () => {
  test("initialize: identity, instructions, tools only, no session", async () => {
    const { response, message } = await rpc("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    expect(message.result?.serverInfo).toEqual({
      name: MCP_SERVER.name,
      version: MCP_SERVER.version,
    });
    expect(message.result?.instructions).toBe(MCP_SERVER.instructions);
    // Advertising a capability with nothing behind it fails a scanner check.
    expect(Object.keys(message.result?.capabilities as object)).toEqual([
      "tools",
    ]);
  });

  test("answers carry CORS and the rate limit fields", async () => {
    const { response } = await rpc("tools/list");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("ratelimit-policy")).toBe(
      `"api";q=${POLICIES.api.limit};w=${POLICIES.api.windowSeconds}`,
    );
    expect(response.headers.get("ratelimit")).toMatch(/^"api";r=\d+;t=\d+$/);
  });

  test("resources and prompts are not methods of this server", async () => {
    for (const method of ["resources/list", "prompts/list"]) {
      const { message } = await rpc(method);
      expect(message.error?.code).toBe(-32601);
    }
  });
});

describe("tools/list", () => {
  test("the documented tools, each fully described", async () => {
    const { message } = await rpc("tools/list");
    const tools = message.result?.tools as ListedTool[];
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      Object.keys(MCP_TOOLS).sort(),
    );
    for (const tool of tools) {
      const info = MCP_TOOLS[tool.name as keyof typeof MCP_TOOLS];
      expect(tool.title).toBe(info.title);
      expect(tool.description).toBe(info.description);
      expect(tool.description.length).toBeGreaterThanOrEqual(80);
      expect(tool.description).toMatch(/\buse it\b/i);
      expect(tool.description).toMatch(/\breturns?\b/i);
      expect(tool.inputSchema.type).toBe("object");
      for (const [name, property] of Object.entries(
        tool.inputSchema.properties ?? {},
      )) {
        expect(`${tool.name}.${name}: ${typeof property.description}`).toBe(
          `${tool.name}.${name}: string`,
        );
      }
      expect(tool.outputSchema.type).toBe("object");
      expect(
        Object.keys(tool.outputSchema.properties ?? {}).length,
      ).toBeGreaterThan(0);
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.annotations.destructiveHint).toBe(false);
    }
    const descriptions = tools.map((tool) => tool.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    expect(JSON.stringify(tools).toLowerCase()).not.toContain(`o${"auth"}`);
  });
});

describe("tools/call", () => {
  test("get_banner: URLs and snippets for a repository preset", async () => {
    const { result } = await call("get_banner", {
      target: "vercel/next.js",
      preset: "contributors",
      theme: "dracula",
      options: "hide=topics&brand=0",
    });
    expect(result.isError).toBeUndefined();
    const banner = result.structuredContent as {
      slug: string;
      preset: string;
      query: string;
      links: { svg: string };
    };
    expect(banner.slug).toBe("vercel/next.js");
    expect(banner.preset).toBe("contributors");
    // Pro options are dropped from ad-hoc banners.
    expect(banner.query).toContain("theme=dracula");
    expect(banner.query).not.toContain("brand");
    expect(banner.links.svg).toMatch(/\/vercel\/next\.js\/contributors\.svg\?/);
    // The text block is the same JSON, for clients that only read text.
    expect(JSON.parse(result.content[0].text)).toEqual(banner);
  });

  test("get_owner leaves the daily calendar out unless asked", async () => {
    const lean = await call("get_owner", { login: "markeljan" });
    const owner = lean.result.structuredContent?.owner as {
      kind: string;
      calendar: { total: number; days?: unknown[] };
    };
    expect(owner.kind).toBe("user");
    expect(owner.calendar.total).toBeGreaterThan(0);
    expect(owner.calendar.days).toBeUndefined();

    const full = await call("get_owner", {
      login: "markeljan",
      include_calendar: true,
    });
    const content = full.result.structuredContent;
    if (!content) throw new Error("Expected structured owner content");
    const days = (content.owner as { calendar: { days: unknown[] } }).calendar
      .days;
    expect(days.length).toBeGreaterThan(300);
  });

  test("get_owner answers for an organization too", async () => {
    const { result } = await call("get_owner", { login: "vercel" });
    expect(
      (result.structuredContent?.owner as { kind: string } | undefined)?.kind,
    ).toBe("org");
  });

  test("get_repository", async () => {
    const { result } = await call("get_repository", {
      owner: "vercel",
      repo: "next.js",
    });
    const repository = result.structuredContent?.repository as {
      fullName: string;
      stars: number;
    };
    expect(repository.fullName).toBe("vercel/next.js");
    expect(repository.stars).toBeGreaterThan(1000);
  });

  test("list_banner_options is the options catalog", async () => {
    const { result } = await call("list_banner_options", {});
    const catalog = result.structuredContent as {
      presets: unknown[];
      themes: unknown[];
    };
    expect(catalog.presets.length).toBe(16);
    expect(catalog.themes.length).toBe(24);
  });

  test("search_github refuses a query that is too short", async () => {
    const { message, result } = await call("search_github", { query: "v" });
    // The schema refuses it before the tool runs.
    expect(message.error ?? result.isError).toBeTruthy();
  });

  test("a failure is a tool error with the API's code, and nothing else", async () => {
    const { result } = await call("get_owner", { login: "not_a_login" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const { error } = JSON.parse(result.content[0].text) as {
      error: Record<string, unknown>;
    };
    expect(error.code).toBe("invalid_request");
    expect(error.status).toBe(400);
    expect(String(error.type)).toMatch(/\/docs#error-invalid_request$/);
    expect(typeof error.resolution).toBe("string");
  });

  test("an unknown tool is a JSON-RPC error", async () => {
    const { message } = await rpc("tools/call", {
      name: "nope",
      arguments: {},
    });
    expect(message.error?.code).toBe(-32602);
    expect(typeof message.error?.message).toBe("string");
  });
});

describe("HTTP wrapper", () => {
  test("GET and DELETE answer 405 with a JSON-RPC error body", async () => {
    for (const [handler, method] of [
      [GET, "GET"],
      [DELETE, "DELETE"],
    ] as const) {
      const response = await handler(
        new Request("http://localhost/mcp", { method }),
      );
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      const body = (await response.json()) as Rpc & { jsonrpc: string };
      expect(body.jsonrpc).toBe("2.0");
      expect(typeof body.error?.code).toBe("number");
    }
  });

  test("OPTIONS is a CORS preflight for POST", () => {
    const response = OPTIONS();
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "POST, OPTIONS",
    );
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "MCP-Protocol-Version",
    );
  });

  test("past the quota the answer is 429 with Retry-After", async () => {
    const address = "203.0.113.77";
    for (let used = 0; used < POLICIES.api.limit; used += 1) {
      await limit("api", `ip:${address}`);
    }
    const { response, message } = await rpc("tools/list", undefined, {
      "x-forwarded-for": address,
    });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(response.headers.get("ratelimit")).toMatch(/^"api";r=0;t=\d+$/);
    expect(message.error?.code).toBe(-32000);
    expect(message.error?.data?.code).toBe("rate_limited");
    // Another client is not affected.
    const other = await rpc("tools/list", undefined, {
      "x-forwarded-for": "203.0.113.78",
    });
    expect(other.response.status).toBe(200);
  });
});
