import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { site } from "@/lib/site";
import {
  agentSkillsIndex,
  aiCatalog,
  apiCatalog,
  ardCatalog,
  documentResponse,
  jsonBody,
  registryManifest,
  SKILL_DIGEST,
  SKILL_MD,
  serverCard,
} from "./discovery";
import { AGENT_SKILL, MCP_SERVER, MCP_TOOLS } from "./identity";

describe("documentResponse", () => {
  const request = (headers: Record<string, string> = {}) =>
    new Request("https://example.test/x", { headers });

  test("serves the given type with CORS, a cache lifetime and an ETag", async () => {
    const response = documentResponse(request(), "{}\n", "application/json");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=3600, s-maxage=3600",
    );
    expect(response.headers.get("etag")).toMatch(/^"[\w-]{27}"$/);
    expect(await response.text()).toBe("{}\n");
  });

  test("ignores Accept: a scanner asking for Markdown gets the file", () => {
    const response = documentResponse(
      request({ accept: "text/markdown" }),
      "{}",
      "application/json",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("vary")).toBeNull();
  });

  test("answers a matching If-None-Match with 304", async () => {
    const etag = documentResponse(request(), "body", "text/plain").headers.get(
      "etag",
    );
    for (const value of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
      const response = documentResponse(
        request({ "if-none-match": String(value) }),
        "body",
        "text/plain",
      );
      expect(response.status).toBe(304);
      expect(await response.text()).toBe("");
      expect(response.headers.get("etag")).toBe(etag);
    }
    const changed = documentResponse(
      request({ "if-none-match": String(etag) }),
      "new body",
      "text/plain",
    );
    expect(changed.status).toBe(200);
  });

  test("extra headers win", () => {
    const response = documentResponse(request(), "x", "text/plain", {
      Link: "<a>; rel=b",
    });
    expect(response.headers.get("link")).toBe("<a>; rel=b");
  });
});

describe("agent skill", () => {
  test("the digest is the SHA-256 of the bytes served", () => {
    const digest = createHash("sha256").update(SKILL_MD).digest("hex");
    expect(SKILL_DIGEST).toBe(`sha256:${digest}`);
  });

  test("the file has skill front matter and says when to use it", () => {
    expect(SKILL_MD.startsWith(`---\nname: ${AGENT_SKILL.name}\n`)).toBe(true);
    expect(SKILL_MD).toContain(`description: ${AGENT_SKILL.description}\n---`);
    expect(AGENT_SKILL.description).toContain("Use when");
    const fences = SKILL_MD.split("\n").filter((line) =>
      line.startsWith("```"),
    );
    expect(fences.length % 2).toBe(0);
    for (const tool of Object.keys(MCP_TOOLS)) expect(SKILL_MD).toContain(tool);
  });

  test("the index is schema 0.2.0 with every field of an entry", () => {
    const index = agentSkillsIndex();
    expect(index.$schema).toBe(
      "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    );
    expect(index.skills).toEqual([
      {
        name: "gitbanners",
        type: "skill-md",
        description: AGENT_SKILL.description,
        url: `${site.url}/.well-known/agent-skills/gitbanners/SKILL.md`,
        digest: SKILL_DIGEST,
      },
    ]);
  });
});

describe("MCP server card and registry manifest", () => {
  test("the card has what the schema and the registries ask for", () => {
    const card = serverCard();
    expect(card.$schema).toBe(
      "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
    );
    expect(card.name).toBe("io.github.markeljan/gitbanners");
    expect(card.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    expect(card.description.length).toBeLessThanOrEqual(100);
    expect(card.title).toBe(site.name);
    expect(card.icons[0].src).toBe(`${site.url}/icon.svg`);
    expect(card.remotes).toEqual([
      {
        type: "streamable-http",
        url: `${site.url}/mcp`,
        supportedProtocolVersions: ["2026-07-28", "2025-11-25", "2025-06-18"],
      },
    ]);
    // Tools are listed by the server, never in the card.
    expect("tools" in card).toBe(false);
  });

  test("the manifest names the same server", () => {
    const manifest = registryManifest();
    expect(manifest.name).toBe(MCP_SERVER.name);
    expect(manifest.version).toBe(MCP_SERVER.version);
    expect(manifest.remotes[0].url).toBe(`${site.url}/mcp`);
  });

  test("the instructions are long enough to steer a client", () => {
    expect(MCP_SERVER.instructions.length).toBeGreaterThan(200);
    for (const tool of Object.keys(MCP_TOOLS)) {
      expect(MCP_SERVER.instructions).toContain(tool);
    }
  });
});

describe("catalogs", () => {
  const host = new URL(site.url).hostname;

  test("ARD entries are anchored to our domain and carry a trust manifest", () => {
    const catalog = ardCatalog();
    expect(catalog.specVersion).toBe("1.0");
    expect(catalog.entries.length).toBeGreaterThanOrEqual(5);
    for (const entry of catalog.entries) {
      expect(entry.identifier.startsWith(`urn:air:${host}:`)).toBe(true);
      expect(entry.displayName.length).toBeGreaterThan(0);
      expect(entry.type).toMatch(/^[a-z]+\/[\w.+;=-]+$/);
      expect(entry.url.startsWith(`${site.url}/`)).toBe(true);
      expect("data" in entry).toBe(false);
      expect(entry.representativeQueries.length).toBeGreaterThanOrEqual(2);
      expect(entry.representativeQueries.length).toBeLessThanOrEqual(5);
      expect(entry.trustManifest).toEqual({
        identity: site.url,
        identityType: "https",
      });
    }
    const ids = catalog.entries.map((entry) => entry.identifier);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the AI catalog has the same entries without trust manifests", () => {
    const catalog = aiCatalog();
    expect(catalog.entries.map((entry) => entry.identifier)).toEqual(
      ardCatalog().entries.map((entry) => entry.identifier),
    );
    for (const entry of catalog.entries) {
      expect("trustManifest" in entry).toBe(false);
    }
    expect(
      catalog.entries.some(
        (entry) =>
          entry.type === "application/mcp-server-card+json" &&
          entry.url === `${site.url}/mcp/server-card`,
      ),
    ).toBe(true);
  });

  test("the API catalog is a linkset with item entries", () => {
    const [link] = apiCatalog().linkset;
    expect(link.anchor).toBe(`${site.url}/api/v1`);
    expect(link.item[0].href).toBe(`${site.url}/openapi.json`);
    expect(link["service-desc"][0].href).toBe(`${site.url}/openapi.json`);
    expect(link["service-doc"][0].href).toBe(`${site.url}/docs`);
  });

  test("jsonBody is pretty-printed with a trailing newline", () => {
    expect(jsonBody({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });
});
