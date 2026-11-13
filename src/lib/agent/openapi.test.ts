import { describe, expect, test } from "bun:test";
import { apiIndex } from "@/lib/api/index-document";
import { PARAMETER_DOCS } from "@/lib/api/parameters";
import { optionsCatalog } from "@/lib/api/service";
import { POLICIES } from "@/lib/ratelimit";
import { site } from "@/lib/site";
import { errorCodes } from "./error-codes";
import { ApiIndexSchema, openApiDocument } from "./openapi";
import { API_OPERATIONS, apiOperation } from "./operations";

type Json = Record<string, unknown>;
const document = openApiDocument();
const text = JSON.stringify(document);
const paths = document.paths as Record<string, { get: Json }>;
const components = document.components as Record<string, Record<string, Json>>;
const operations = Object.entries(paths).map(([path, item]) => ({
  path,
  ...(item.get as {
    operationId: string;
    summary: string;
    description: string;
    security: unknown[];
    parameters: Json[];
    responses: Record<string, { content?: Record<string, { schema?: Json }> }>;
  }),
}));

function resolve(value: Json): Json {
  const ref = value.$ref;
  if (typeof ref !== "string") return value;
  const found = ref
    .split("/")
    .slice(1)
    .reduce<unknown>(
      (node, key) => (node as Record<string, unknown> | undefined)?.[key],
      document,
    );
  if (found === undefined) throw new Error(`dangling ${ref}`);
  return found as Json;
}

describe("OpenAPI document", () => {
  test("is OpenAPI 3.1 for the canonical origin, with no security scheme", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(document.servers).toEqual([
      { url: site.url, description: "Production" },
    ]);
    expect(document.security).toEqual([]);
    expect(components.securitySchemes).toBeUndefined();
    expect((document.info as Json).description).toContain(
      "No authentication, no API key and no sign-up",
    );
    expect(text.toLowerCase()).not.toContain(`o${"auth"}`);
  });

  test("has one path per operation, JSON first, the parameterless ones leading", () => {
    expect(Object.keys(paths)).toEqual(
      API_OPERATIONS.map((operation) => operation.path),
    );
    expect(operations.map((operation) => operation.operationId)).toEqual([
      "getOptions",
      "search",
      "getBanner",
      "getOwner",
      "getRepository",
      "getIndex",
      "getApiRoot",
      "getOwnerImage",
      "getRepositoryImage",
    ]);
    expect(operations[0].parameters).toEqual([]);
  });

  test("every operation is documented, typed and keyless", () => {
    for (const operation of operations) {
      expect(operation.summary.length).toBeGreaterThan(10);
      expect(operation.description.length).toBeGreaterThan(60);
      expect(operation.security).toEqual([]);
      for (const raw of operation.parameters) {
        const parameter = resolve(raw);
        expect(typeof parameter.name).toBe("string");
        expect(["path", "query"]).toContain(parameter.in as string);
        expect(String(parameter.description).length).toBeGreaterThan(10);
        const schema = parameter.schema as Json;
        expect(schema.type ?? schema.enum).toBeDefined();
        expect(parameter.example).toBeDefined();
      }
      // Every `{name}` of the path is a required path parameter.
      for (const [, name] of operation.path.matchAll(/\{([^}]+)\}/g)) {
        const declared = operation.parameters
          .map(resolve)
          .find(
            (parameter) => parameter.in === "path" && parameter.name === name,
          );
        expect(`${operation.path} ${name}: ${declared?.required}`).toBe(
          `${operation.path} ${name}: true`,
        );
      }
    }
  });

  test("every operation has a typed success and a problem response", () => {
    for (const operation of operations) {
      const success = operation.responses["200"].content ?? {};
      expect(Object.keys(success).length).toBeGreaterThan(0);
      for (const media of Object.values(success)) {
        expect(media.schema).toBeDefined();
      }
      const problems = Object.entries(operation.responses).filter(([status]) =>
        /^[45]/.test(status),
      );
      expect(problems.length).toBeGreaterThan(0);
      for (const [, response] of problems) {
        expect(response.content?.["application/problem+json"]?.schema).toEqual({
          $ref: "#/components/schemas/ProblemDetails",
        });
      }
    }
  });

  test("most operations answer JSON; the images are the exception", () => {
    const json = operations.filter(
      (operation) => operation.responses["200"].content?.["application/json"],
    );
    expect(json.length).toBe(7);
    expect(json.length / operations.length).toBeGreaterThanOrEqual(0.76);
    for (const operation of operations.slice(-2)) {
      expect(Object.keys(operation.responses["200"].content ?? {})).toEqual([
        "image/svg+xml",
        "image/png",
      ]);
    }
  });

  test("every reference resolves inside the document", () => {
    const refs = [...text.matchAll(/"\$ref":"([^"]+)"/g)].map(([, ref]) => ref);
    expect(refs.length).toBeGreaterThan(50);
    for (const ref of refs) {
      expect(ref.startsWith("#/components/")).toBe(true);
      expect(() => resolve({ $ref: ref })).not.toThrow();
    }
  });

  test("schemas come from the routes' own zod schemas, open to additions", () => {
    for (const name of [
      "User",
      "Organization",
      "Repository",
      "SearchResult",
      "Suggestion",
      "BannerDescription",
      "BannerTarget",
      "OptionsCatalog",
      "ApiIndex",
      "ProblemDetails",
    ]) {
      expect(`${name}: ${components.schemas[name] !== undefined}`).toBe(
        `${name}: true`,
      );
    }
    const schemas = JSON.stringify(components.schemas);
    expect(schemas).not.toContain('"additionalProperties":false');
    expect(schemas).not.toContain("$defs");
    expect(schemas).not.toContain('"$schema"');
    expect(schemas).not.toContain(String(Number.MAX_SAFE_INTEGER));
    expect((components.schemas.User.properties as Json).calendar).toEqual({
      $ref: "#/components/schemas/ContributionCalendar",
    });
  });

  test("the index schema matches the index the API serves", () => {
    const index = apiIndex();
    expect<unknown>(ApiIndexSchema.strict().parse(index)).toEqual(index);
  });

  test("the problem schema enumerates the public codes", () => {
    const problem = components.schemas.ProblemDetails;
    expect((problem.properties as Record<string, Json>).code.enum).toEqual(
      errorCodes("api").map((entry) => entry.code),
    );
    expect(problem.required).toEqual(["type", "title", "status", "code"]);
  });

  test("banner options are typed parameters, the Pro ones left out", () => {
    const expected = PARAMETER_DOCS.filter((doc) => !doc.pro).map(
      (doc) => `option_${doc.name}`,
    );
    expect(Object.keys(components.parameters)).toEqual(expected);
    expect(components.parameters.option_brand).toBeUndefined();
    const theme = components.parameters.option_theme.schema as Json;
    expect(theme.enum).toEqual(
      optionsCatalog().themes.map((entry) => entry.id),
    );
    for (const id of ["getBanner", "getOwnerImage", "getRepositoryImage"]) {
      const operation = operations.find((entry) => entry.operationId === id);
      const refs = operation?.parameters.filter((entry) => "$ref" in entry);
      expect(refs?.length).toBe(expected.length);
    }
  });

  test("rate limits, versioning and deprecation are stated", () => {
    expect(document["x-rate-limit-policies"]).toEqual([
      expect.objectContaining({
        name: "api",
        quota: POLICIES.api.limit,
        window_seconds: POLICIES.api.windowSeconds,
      }),
      expect.objectContaining({
        name: "search",
        quota: POLICIES.search.limit,
      }),
    ]);
    expect(document["x-api-lifecycle"]).toEqual({
      current_major_version: "v1",
      versioning: "URL path",
      deprecation_policy_url: `${site.url}/docs#versioning-and-deprecation`,
      minimum_deprecation_notice_days: 90,
      deprecated_operations: [],
    });
    for (const name of [
      "RateLimit-Policy",
      "RateLimit",
      "Retry-After",
      "Deprecation",
      "Sunset",
    ]) {
      expect(components.headers[name]).toBeDefined();
    }
    expect(Object.keys(paths).some((path) => path.includes("/v1/"))).toBe(true);
  });
});

describe("operation catalog", () => {
  test("every example is a request for its own path", () => {
    for (const operation of API_OPERATIONS) {
      const pattern = new RegExp(
        `^${operation.path
          .replace(/[.]/g, "\\.")
          .replace(/\{[^}]+\}/g, "[^/?]+")}(\\?.*)?$`,
      );
      expect(`${operation.id}: ${pattern.test(operation.example)}`).toBe(
        `${operation.id}: true`,
      );
      // Required query parameters are in the example.
      for (const parameter of operation.parameters) {
        if (parameter.in === "query" && parameter.required) {
          expect(operation.example).toContain(`${parameter.name}=`);
        }
      }
    }
  });

  test("ids are unique and look-ups fail loudly", () => {
    const ids = API_OPERATIONS.map((operation) => operation.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(apiOperation("getOwner").path).toBe("/api/v1/owners/{login}");
    expect(() => apiOperation("nope")).toThrow();
  });
});
