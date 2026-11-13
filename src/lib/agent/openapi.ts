/**
 * `/openapi.json`: the OpenAPI 3.1 description of the public API.
 *
 * Nothing here is typed twice. Operations, paths, summaries and parameters
 * come from `./operations`, response bodies from the zod schemas the routes
 * return (`@/lib/github/schema`, `@/lib/api/schema`), banner options from
 * `PARAMETER_DOCS`, quotas from the rate limiter and error codes from
 * `./error-codes`.
 *
 * The document declares no security scheme, because there is none: every
 * operation is public.
 */
import { z } from "zod";
import { FACTS } from "@/content/facts";
import { PARAMETER_DOCS } from "@/lib/api/parameters";
import {
  BannerDescriptionSchema,
  OptionsCatalogSchema,
  SearchResultSchema,
} from "@/lib/api/schema";
import {
  DEFAULT_THEME_ID,
  FONTS,
  OPTION_LIMITS,
  type QueryKey,
  SIZE_IDS,
  THEMES,
} from "@/lib/banner";
import { OrgSchema, RepoSchema, UserSchema } from "@/lib/github/schema";
import { POLICIES, type PolicyName } from "@/lib/ratelimit";
import { absoluteUrl, site } from "@/lib/site";
import { errorCodes } from "./error-codes";
import {
  API_OPERATIONS,
  type ApiOperation,
  type JsonSchema,
  type OperationParameter,
} from "./operations";

type Json = Record<string, unknown>;

/** Shape of `apiIndex()` in `@/lib/api/index-document`. */
export const ApiIndexSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    current_version: z.string().describe("Version segment of the path."),
    authentication: z.literal("none"),
    openapi: z.url().describe("This document."),
    api_catalog: z.url(),
    docs: z.url(),
    mcp: z.url().describe("Streamable HTTP endpoint of the MCP server."),
    llms: z.url(),
    operations: z
      .record(z.string(), z.string())
      .describe("One URL template per JSON operation."),
    images: z
      .object({
        profile: z.string(),
        profile_preset: z.string(),
        repository: z.string(),
        repository_preset: z.string(),
        formats: z.array(z.string()),
      })
      .describe("URL templates of the banner images."),
  })
  .meta({
    id: "ApiIndex",
    description: "Where everything is: versions, descriptions, operations.",
  });

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

/** What each JSON operation answers with, by `operationId`. */
const RESPONSE_SCHEMAS: Record<string, { schema: Json; description: string }> =
  {
    getOptions: {
      schema: ref("OptionsCatalog"),
      description: "The options catalog.",
    },
    search: { schema: ref("SearchResult"), description: "Suggestions." },
    getBanner: {
      schema: ref("BannerDescription"),
      description: "The banner, described.",
    },
    getOwner: {
      schema: {
        oneOf: [ref("User"), ref("Organization")],
        discriminator: {
          propertyName: "kind",
          mapping: {
            user: "#/components/schemas/User",
            org: "#/components/schemas/Organization",
          },
        },
      },
      description: "The user or organization.",
    },
    getRepository: {
      schema: ref("Repository"),
      description: "The repository.",
    },
    getIndex: { schema: ref("ApiIndex"), description: "The API index." },
    getApiRoot: { schema: ref("ApiIndex"), description: "The API index." },
  };

/** Quota each JSON operation counts against. */
const OPERATION_POLICY: Record<string, PolicyName> = { search: "search" };

/** Operations that ask GitHub, and can therefore fail with a 404 or a 503. */
const ASKS_GITHUB = new Set([
  "search",
  "getBanner",
  "getOwner",
  "getRepository",
]);

// --- Schemas from zod --------------------------------------------------------

/**
 * zod prints output schemas as closed objects and spells out the safe
 * integer range. Both are noise in an API description, and the first would
 * turn every added response member into a contract violation: the
 * versioning policy says members may be added.
 */
function tidy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(tidy);
  if (typeof value !== "object" || value === null) return value;
  const out: Json = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "$schema" || key === "$id") continue;
    if (key === "additionalProperties" && entry === false) continue;
    if (key === "maximum" && entry === Number.MAX_SAFE_INTEGER) continue;
    if (key === "minimum" && entry === Number.MIN_SAFE_INTEGER) continue;
    out[key] = tidy(entry);
  }
  return out;
}

/** `#/$defs/Name` as zod prints it, moved to where OpenAPI keeps schemas. */
function relocate(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(relocate);
  if (typeof value !== "object" || value === null) return value;
  const out: Json = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] =
      key === "$ref" && typeof entry === "string"
        ? entry.replace("#/$defs/", "#/components/schemas/")
        : relocate(entry);
  }
  return out;
}

/**
 * Every schema the operations answer with, and every schema those refer
 * to, by the id each one carries in its metadata.
 *
 * Converted root by root rather than from zod's global registry: Next.js
 * loads a source module once per bundle layer, each copy registers its
 * schemas under the same ids, and converting the whole registry then fails
 * on the duplicates. One root only ever reaches schemas of its own copy.
 */
function componentSchemas(): Json {
  const roots = [
    ApiIndexSchema,
    BannerDescriptionSchema,
    OptionsCatalogSchema,
    SearchResultSchema,
    UserSchema,
    OrgSchema,
    RepoSchema,
  ];
  const found: Json = {};
  for (const root of roots) {
    const converted = z.toJSONSchema(root, { target: "draft-2020-12" });
    Object.assign(found, converted.$defs);
  }
  const schemas: Json = {};
  for (const name of Object.keys(found).sort()) {
    schemas[name] = relocate(tidy(found[name]));
  }
  schemas.ProblemDetails = problemSchema();
  return schemas;
}

function problemSchema(): Json {
  return {
    type: "object",
    description:
      "RFC 9457 problem details. Branch on `code`; show `title` and `detail`; follow `resolution`.",
    required: ["type", "title", "status", "code"],
    properties: {
      type: {
        type: "string",
        format: "uri",
        description:
          "Identifies the kind of problem. Resolves to the documentation of the code.",
      },
      title: {
        type: "string",
        description: "Short summary, the same for every case of a code.",
      },
      status: { type: "integer", minimum: 400, maximum: 599 },
      detail: { type: "string", description: "What went wrong this time." },
      code: {
        type: "string",
        enum: errorCodes("api").map((entry) => entry.code),
        description: "Stable identifier to branch on.",
      },
      resolution: {
        type: "string",
        description: "What the caller can do about it.",
      },
      instance: {
        type: "string",
        description: "Path and query of the request.",
      },
      documentation_url: { type: "string", format: "uri" },
    },
    additionalProperties: true,
  };
}

// --- Parameters ---------------------------------------------------------------

const HEX = {
  type: "string",
  pattern: "^#?(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$",
};
const FLAG = { type: "integer", enum: [0, 1] };
const ID_LIST = { type: "string", pattern: "^[A-Za-z]+(?:,[A-Za-z]+)*$" };
const range = (limits: { min: number; max: number }) => ({
  type: "integer",
  minimum: limits.min,
  maximum: limits.max,
});

/** Machine-readable type of every banner option. */
const OPTION_SCHEMAS: Record<QueryKey, JsonSchema> = {
  size: { type: "string", enum: SIZE_IDS, default: "readme" },
  width: range(OPTION_LIMITS.width),
  height: range(OPTION_LIMITS.height),
  theme: {
    type: "string",
    enum: THEMES.map((theme) => theme.id),
    default: DEFAULT_THEME_ID,
  },
  bg: HEX,
  surface: HEX,
  border_color: HEX,
  text: HEX,
  muted: HEX,
  accent: HEX,
  heat: {
    type: "string",
    pattern:
      "^#?[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?(?:,#?[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?){0,4}$",
  },
  font: { type: "string", enum: Object.keys(FONTS), default: "mona" },
  radius: range(OPTION_LIMITS.radius),
  border: FLAG,
  title: { type: "string", maxLength: OPTION_LIMITS.title },
  year: { type: "integer", minimum: OPTION_LIMITS.year.min },
  stats: ID_LIST,
  show: ID_LIST,
  hide: ID_LIST,
  count: range(OPTION_LIMITS.count),
  brand: FLAG,
  animate: FLAG,
};

/** Options that work on ad-hoc URLs. The Pro ones need a saved banner. */
const PUBLIC_OPTIONS = PARAMETER_DOCS.filter((doc) => !doc.pro);

const optionRef = (name: string) => ({
  $ref: `#/components/parameters/option_${name}`,
});

function exampleOf(value: string, schema: JsonSchema): string | number {
  return schema.type === "integer" ? Number(value) : value;
}

function optionParameters(): Json {
  const parameters: Json = {};
  for (const doc of PUBLIC_OPTIONS) {
    const schema = OPTION_SCHEMAS[doc.name];
    parameters[`option_${doc.name}`] = {
      name: doc.name,
      in: "query",
      required: false,
      description: `${doc.description} Value: ${doc.type}.`,
      schema,
      example: exampleOf(doc.example, schema),
    };
  }
  return parameters;
}

function parameter(source: OperationParameter): Json {
  return {
    name: source.name,
    in: source.in,
    required: source.required,
    description: source.description,
    schema: source.schema,
    example: source.example,
  };
}

// --- Responses ------------------------------------------------------------------

const header = (name: string) => ({ $ref: `#/components/headers/${name}` });

const rateHeaders = {
  "RateLimit-Policy": header("RateLimit-Policy"),
  RateLimit: header("RateLimit"),
};

function problem(description: string, retry = false): Json {
  return {
    description,
    headers: {
      ...rateHeaders,
      ...(retry ? { "Retry-After": header("Retry-After") } : {}),
    },
    content: {
      "application/problem+json": { schema: ref("ProblemDetails") },
    },
  };
}

function jsonResponses(operation: ApiOperation): Json {
  const answer = RESPONSE_SCHEMAS[operation.id];
  const asksGitHub = ASKS_GITHUB.has(operation.id);
  const takesInput = operation.parameters.length > 0 || operation.bannerOptions;
  return {
    "200": {
      description: answer.description,
      headers: {
        ...rateHeaders,
        "Cache-Control": header("Cache-Control"),
        Link: header("Link"),
        // Not sent today. Documented on every operation because this is where
        // a client has to look for them once an operation is being retired.
        Deprecation: header("Deprecation"),
        Sunset: header("Sunset"),
      },
      content: { "application/json": { schema: answer.schema } },
    },
    ...(takesInput
      ? {
          "400": problem(
            "A parameter is missing, malformed or out of range (`invalid_request`).",
          ),
        }
      : {}),
    ...(asksGitHub && operation.id !== "search"
      ? {
          "404": problem(
            "No public GitHub user, organization or repository has that name (`not_found`).",
          ),
        }
      : {}),
    "429": problem(
      "The client is over its quota (`rate_limited`). Wait `Retry-After` seconds.",
      true,
    ),
    ...(asksGitHub
      ? {
          "503": problem(
            "GitHub could not be asked and no earlier copy of the data exists (`upstream_rate_limited`, `upstream_unavailable`).",
            true,
          ),
        }
      : {}),
    default: problem(
      "Any other failure, in the same format: `method_not_allowed` (405) for a method other than GET, HEAD or OPTIONS, `internal_error` (500).",
    ),
  };
}

function imageResponses(): Json {
  const image = (mediaType: string) => ({
    schema: { type: "string", contentMediaType: mediaType },
  });
  return {
    "200": {
      description:
        "The banner. Also when the target is unknown or GitHub cannot be asked: the image then says so, and `X-Banner-State` tells which.",
      headers: {
        "X-Banner-State": header("X-Banner-State"),
        "Cache-Control": header("Cache-Control"),
      },
      content: {
        "image/svg+xml": image("image/svg+xml"),
        "image/png": image("image/png"),
      },
    },
    // Two layers refuse a URL that cannot be a banner, and they answer
    // differently: the image handler with a problem, the routing layer (which
    // never starts a function for such a path) with the static 404 page.
    "404": {
      description:
        "The URL cannot be a banner. A login or repository name that is too long or malformed, or more than three segments, answers a problem (`not_found`). A first segment that is one of this site's own routes, or that contains a character no GitHub login can, answers the site's HTML 404 page.",
      content: {
        "application/problem+json": { schema: ref("ProblemDetails") },
        "text/html": { schema: { type: "string" } },
      },
    },
  };
}

function operationObject(operation: ApiOperation): Json {
  const image = operation.kind === "image";
  const quota = OPERATION_POLICY[operation.id] ?? "api";
  return {
    operationId: operation.id,
    summary: operation.summary,
    description: image
      ? operation.description
      : `${operation.description} Counts against the \`${quota}\` quota.`,
    tags: [image ? "Images" : "Data"],
    security: [],
    parameters: [
      ...operation.parameters.map(parameter),
      ...(operation.bannerOptions
        ? PUBLIC_OPTIONS.map((doc) => optionRef(doc.name))
        : []),
    ],
    responses: image ? imageResponses() : jsonResponses(operation),
  };
}

// --- The document ------------------------------------------------------------------

const textHeader = (description: string, example?: string) => ({
  description,
  schema: { type: "string" },
  ...(example ? { example } : {}),
});

function policyOf(name: PolicyName): Json {
  const policy = POLICIES[name];
  return {
    name: policy.name,
    quota: policy.limit,
    window_seconds: policy.windowSeconds,
    partition: "client IP address (an IPv6 /64 network counts as one client)",
  };
}

export function openApiDocument(): Json {
  const api = POLICIES.api;
  const paths: Json = {};
  for (const operation of API_OPERATIONS) {
    paths[operation.path] = { get: operationObject(operation) };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: `${site.name} API`,
      version: "1.0.0",
      summary:
        "Live GitHub banners, and the public profile and repository data they are drawn from.",
      description: `Read-only API of ${site.name}. No authentication, no API key and no sign-up: every operation is public and keyless. JSON operations live under ${site.api.basePath}; the banner images are addressed at the site root. Errors are RFC 9457 application/problem+json with a stable \`code\`. Every JSON answer carries the IETF RateLimit-Policy and RateLimit fields, and 429 answers add Retry-After. The version is part of the path. Within a version only additions are made; a breaking change ships under a new path, and an operation that is being retired announces it with the RFC 9745 Deprecation header and the RFC 8594 Sunset header at least ${FACTS.deprecationNoticeDays} days ahead.`,
      termsOfService: absoluteUrl("/terms"),
      contact: { name: site.name, url: absoluteUrl("/contact") },
    },
    externalDocs: {
      description: "Docs: URL patterns, parameters, errors, limits, versioning",
      url: absoluteUrl("/docs"),
    },
    servers: [{ url: site.url, description: "Production" }],
    security: [],
    tags: [
      {
        name: "Data",
        description:
          "JSON: accounts, repositories, search, banner descriptions and the options catalog.",
      },
      {
        name: "Images",
        description:
          "The banner images themselves, as SVG or PNG. A well-formed banner URL always answers 200.",
      },
    ],
    "x-rate-limit-policies": [policyOf("api"), policyOf("search")],
    "x-api-lifecycle": {
      current_major_version: site.api.version,
      versioning: "URL path",
      deprecation_policy_url: absoluteUrl("/docs#versioning-and-deprecation"),
      minimum_deprecation_notice_days: FACTS.deprecationNoticeDays,
      deprecated_operations: [],
    },
    paths,
    components: {
      parameters: optionParameters(),
      headers: {
        "RateLimit-Policy": textHeader(
          "Quota policy as an IETF structured field: name, quota (q) and window in seconds (w).",
          `"${api.name}";q=${api.limit};w=${api.windowSeconds}`,
        ),
        RateLimit: textHeader(
          "What is left in the current window (r) and the seconds until it resets (t).",
          `"${api.name}";r=${api.limit - 1};t=${api.windowSeconds}`,
        ),
        "Retry-After": {
          description: "Seconds to wait before the next request.",
          schema: { type: "integer", minimum: 1 },
        },
        "Cache-Control": textHeader(
          "How long clients and shared caches may reuse the answer.",
        ),
        Link: textHeader(
          "RFC 8288 links to this description (service-desc), the API catalog, the docs (service-doc) and the deprecation policy (deprecation).",
        ),
        "X-Banner-State": {
          description:
            "What the image shows: the banner (`ok`, or `provisional` while GitHub is still computing part of it), or a card for an unknown target (`not_found`), an unreachable GitHub (`unavailable`) or a drawing failure (`error`).",
          schema: {
            type: "string",
            enum: ["ok", "provisional", "not_found", "unavailable", "error"],
          },
        },
        Deprecation: textHeader(
          "RFC 9745. Only sent by an operation that is being retired: the date from which it counts as deprecated, as a structured field date. Absent on every operation today.",
          "@1798761600",
        ),
        Sunset: textHeader(
          `RFC 8594. Only sent together with Deprecation: the HTTP date after which the operation may stop answering, at least ${FACTS.deprecationNoticeDays} days after the deprecation date.`,
          "Thu, 01 Apr 2027 00:00:00 GMT",
        ),
      },
      schemas: componentSchemas(),
    },
  };
}
