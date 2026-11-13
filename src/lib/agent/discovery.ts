/**
 * The files agents look for at well-known addresses: the agent skill and
 * its index, the MCP server card and registry manifest, the ARD and AI
 * catalogs, and the RFC 9727 API catalog.
 *
 * All of them are built from the same identity constants as the things they
 * describe, and served by {@link documentResponse}, which never negotiates:
 * a scanner that asks for `text/markdown` or `application/json` gets the
 * same file.
 */
import { createHash } from "node:crypto";
import { type CachePolicy, publicCacheHeaders } from "@/lib/http/cache-headers";
import { absoluteUrl, site } from "@/lib/site";
import { AGENT_SKILL, MCP_SERVER, MCP_TOOLS } from "./identity";

/** Documents that change with a deployment, not with a request. */
const DOCUMENT_CACHE: CachePolicy = {
  downstream: 3_600,
  edge: 3_600,
  swr: 86_400,
  sie: 604_800,
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
  "Access-Control-Expose-Headers": "ETag, Link",
} as const;

function etagOf(body: string): string {
  return `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
}

/** Whether `If-None-Match` names this entity tag (weak comparison). */
function matches(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header
    .split(",")
    .map((value) => value.trim().replace(/^W\//, ""))
    .includes(etag);
}

/**
 * Serves a machine-readable document: the given media type whatever the
 * client's `Accept` says, CORS for any origin, an `ETag`, and `304` for a
 * conditional request. Reading the request is also what keeps the route out
 * of build-time prerendering, so the absolute URLs in the body are those of
 * the running deployment.
 */
export function documentResponse(
  request: Request,
  body: string,
  contentType: string,
  extraHeaders: Record<string, string> = {},
): Response {
  const etag = etagOf(body);
  const headers = {
    ...publicCacheHeaders(DOCUMENT_CACHE),
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    ...CORS,
    ...extraHeaders,
  };
  if (matches(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, {
    headers: { ...headers, "Content-Type": contentType },
  });
}

/** Pretty-printed JSON with a trailing newline. */
export function jsonBody(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// --- Agent skill ------------------------------------------------------------

const U = site.url;

/**
 * The skill file. One string constant on purpose: the index publishes the
 * SHA-256 of exactly these bytes, so the file served and the file hashed
 * must be the same value.
 */
export const SKILL_MD = `---
name: ${AGENT_SKILL.name}
description: ${AGENT_SKILL.description}
---

# ${site.name}

${site.name} draws live GitHub banners as SVG or PNG from a URL. Everything below is public, read-only and free. No API key and no sign-in are needed.

## Embed a banner

\`\`\`md
[![GitHub banner](${U}/OWNER.svg)](${U}/OWNER)
\`\`\`

Replace \`OWNER\` with a GitHub login. For a repository use \`OWNER/REPO\`:

\`\`\`md
[![GitHub banner](${U}/OWNER/REPO.svg)](${U}/OWNER/REPO)
\`\`\`

## Choose what it shows

- A preset is the last path segment: \`${U}/OWNER/streak.svg\`, \`${U}/OWNER/REPO/contributors.svg\`.
- Options are query parameters: \`?theme=dracula\`, \`?size=og\`, \`?accent=ff7ac6\`.
- \`.png\` instead of \`.svg\` for surfaces that do not draw SVG. \`?size=x\`, \`linkedin\`, \`og\`, \`social\` and \`square\` are fixed sizes for uploads.
- Every preset, theme, size and parameter: \`GET ${U}${site.api.basePath}/options\`.

## Check before you embed

Ask the API. It confirms the target exists and returns the exact URLs and snippets:

\`\`\`sh
curl "${U}${site.api.basePath}/banner?target=OWNER/REPO&preset=contributors"
\`\`\`

An image URL always answers 200, also for a login that does not exist (the image then says so), which is why the check belongs in the API call.

## Machine interfaces

- JSON API: ${U}${site.api.basePath} (OpenAPI: ${U}/openapi.json)
- MCP server, Streamable HTTP: ${U}${MCP_SERVER.path} (tools: ${Object.keys(MCP_TOOLS).join(", ")})
- Docs: ${U}/docs (Markdown: ${U}/docs.md)
- Any page as Markdown: add \`.md\` or send \`Accept: text/markdown\`

## Errors and limits

Failures are RFC 9457 \`application/problem+json\` with a stable \`code\` and a \`resolution\` hint. Responses carry \`RateLimit-Policy\` and \`RateLimit\`. On 429 wait for \`Retry-After\` seconds.
`;

export const SKILL_DIGEST = `sha256:${createHash("sha256").update(SKILL_MD).digest("hex")}`;

/** Agent Skills discovery index, schema 0.2.0. */
export function agentSkillsIndex() {
  return {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [
      {
        name: AGENT_SKILL.name,
        type: "skill-md",
        description: AGENT_SKILL.description,
        url: absoluteUrl(AGENT_SKILL.path),
        digest: SKILL_DIGEST,
      },
    ],
  };
}

// --- MCP server card and registry manifest ----------------------------------

const ICON = {
  src: absoluteUrl("/icon.svg"),
  mimeType: "image/svg+xml",
  sizes: ["any"],
} as const;

/** MCP server card (SEP-2127). No `tools`: clients list them from the server. */
export function serverCard() {
  return {
    $schema:
      "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
    name: MCP_SERVER.name,
    title: MCP_SERVER.title,
    description: MCP_SERVER.description,
    version: MCP_SERVER.version,
    websiteUrl: absoluteUrl("/docs#mcp"),
    icons: [ICON],
    remotes: [
      {
        type: "streamable-http",
        url: absoluteUrl(MCP_SERVER.path),
        supportedProtocolVersions: [...MCP_SERVER.protocolVersions],
      },
    ],
  };
}

/** Manifest for the official MCP registry (`server.json`). */
export function registryManifest() {
  return {
    $schema:
      "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    name: MCP_SERVER.name,
    title: MCP_SERVER.title,
    description: MCP_SERVER.description,
    version: MCP_SERVER.version,
    websiteUrl: absoluteUrl("/"),
    remotes: [{ type: "streamable-http", url: absoluteUrl(MCP_SERVER.path) }],
  };
}

// --- Catalogs ----------------------------------------------------------------

const HOST = new URL(site.url).hostname;

interface CatalogEntry {
  identifier: string;
  displayName: string;
  type: string;
  url: string;
  description: string;
  tags: string[];
  representativeQueries: string[];
  capabilities?: string[];
}

function catalogEntries(): CatalogEntry[] {
  return [
    {
      identifier: `urn:air:${HOST}:mcp:${site.repo.name}`,
      displayName: `${site.name} MCP server`,
      type: "application/mcp-server-card+json",
      url: absoluteUrl(`${MCP_SERVER.path}/server-card`),
      description:
        "Read-only MCP server: GitHub profile and repository data, banner image URLs and embed code.",
      tags: ["mcp", "github", "banner", "readme"],
      capabilities: Object.keys(MCP_TOOLS),
      representativeQueries: [
        "make a GitHub profile banner for my README",
        "get an embeddable stats image for a GitHub repository",
        "which banner themes and sizes are there",
      ],
    },
    {
      identifier: `urn:air:${HOST}:api:openapi`,
      displayName: `${site.name} API (OpenAPI)`,
      type: "application/vnd.oai.openapi+json;version=3.1",
      url: absoluteUrl("/openapi.json"),
      description:
        "OpenAPI 3.1 description of the keyless JSON API and the banner image URLs.",
      tags: ["api", "rest", "openapi"],
      representativeQueries: [
        "GitHub banner API endpoints",
        "fetch banner URLs and embed code as JSON",
      ],
    },
    {
      identifier: `urn:air:${HOST}:skill:${AGENT_SKILL.name}`,
      displayName: `${site.name} agent skill`,
      type: "application/agent-skills+md",
      url: absoluteUrl(AGENT_SKILL.path),
      description:
        "Skill file: how to embed a banner, choose a preset and theme, and call the API.",
      tags: ["skill", "github", "readme"],
      representativeQueries: [
        "add a GitHub banner to this README",
        "generate a contribution graph image",
      ],
    },
    {
      identifier: `urn:air:${HOST}:docs:llms-txt`,
      displayName: `${site.name} llms.txt`,
      type: "text/markdown",
      url: absoluteUrl("/llms.txt"),
      description:
        "Index of the pages, the API and the agent resources for language models.",
      tags: ["llms.txt", "docs"],
      representativeQueries: [
        `what is ${site.name}`,
        `${site.name} documentation index`,
      ],
    },
    {
      identifier: `urn:air:${HOST}:docs:api`,
      displayName: `${site.name} API docs`,
      type: "text/html",
      url: absoluteUrl("/docs"),
      description:
        "Reference for URL patterns, parameters, the JSON API, errors, rate limits and the MCP server.",
      tags: ["docs", "api"],
      representativeQueries: [
        "banner URL parameters",
        "banner API rate limits",
      ],
    },
  ];
}

const catalogHost = () => ({
  displayName: site.name,
  identifier: site.url,
  documentationUrl: absoluteUrl("/docs"),
});

/** Agentic Resource Discovery catalog: entries with a trust manifest on our own origin. */
export function ardCatalog() {
  const trustManifest = { identity: site.url, identityType: "https" };
  return {
    specVersion: "1.0",
    host: catalogHost(),
    entries: catalogEntries().map((entry) => ({ ...entry, trustManifest })),
  };
}

/** AI Catalog: the same entries, without trust manifests. */
export function aiCatalog() {
  return {
    specVersion: "1.0",
    host: catalogHost(),
    entries: catalogEntries(),
  };
}

export const OPENAPI_MEDIA_TYPE =
  "application/vnd.oai.openapi+json;version=3.1";

/** RFC 9727 API catalog as a linkset. */
export function apiCatalog() {
  return {
    linkset: [
      {
        anchor: absoluteUrl(site.api.basePath),
        item: [
          {
            href: absoluteUrl("/openapi.json"),
            type: OPENAPI_MEDIA_TYPE,
            title: `${site.name} API`,
          },
        ],
        "service-desc": [
          {
            href: absoluteUrl("/openapi.json"),
            type: OPENAPI_MEDIA_TYPE,
            title: "OpenAPI description",
          },
        ],
        "service-doc": [
          {
            href: absoluteUrl("/docs"),
            type: "text/html",
            title: "API docs",
          },
        ],
        "service-meta": [
          {
            href: absoluteUrl(`${MCP_SERVER.path}/server-card`),
            type: "application/mcp-server-card+json",
            title: "MCP server card",
          },
        ],
      },
    ],
  };
}
