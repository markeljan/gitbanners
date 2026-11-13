/**
 * The public operations, described once. `/openapi.json`, the docs page,
 * `/api/llms.txt` and the acceptance script all read this list, so a path or
 * an example that changes here changes everywhere.
 *
 * Isomorphic: text only. Parameters and response schemas are attached in
 * `./openapi`.
 */
import { OPTION_LIMITS, OWNER_PRESET_IDS } from "@/lib/banner";
import { site } from "@/lib/site";

/** A JSON Schema fragment. */
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface OperationParameter {
  name: string;
  in: "path" | "query";
  required: boolean;
  description: string;
  example: string | number;
  schema: JsonSchema;
}

export interface ApiOperation {
  /** OpenAPI `operationId`. */
  id: string;
  /** Path template, relative to the site origin. */
  path: string;
  summary: string;
  description: string;
  /** The operation's own parameters, path parameters first. */
  parameters: readonly OperationParameter[];
  /** Also takes every banner option (`PARAMETER_DOCS`) as a query parameter. */
  bannerOptions: boolean;
  /** A request that works as written: path and query with real values. */
  example: string;
  /** What a successful answer is. */
  returns: string;
  kind: "json" | "image";
}

const base = site.api.basePath;
const login = site.exampleLogin;

/** The shapes `isValidLogin` and `isValidRepoName` accept. */
const LOGIN_PATTERN = "^[A-Za-z0-9][A-Za-z0-9-]{0,38}$";
const REPO_PATTERN = "^[A-Za-z0-9._-]{1,100}$";

const ownerParam = (description: string): OperationParameter => ({
  name: "owner",
  in: "path",
  required: true,
  description,
  example: "vercel",
  schema: { type: "string", pattern: LOGIN_PATTERN },
});

const formatParam: OperationParameter = {
  name: "format",
  in: "path",
  required: true,
  description:
    "Image format. SVG is the form to embed in a README; PNG is for surfaces that do not draw SVG.",
  example: "svg",
  schema: { type: "string", enum: ["svg", "png"] },
};

const imageParams: readonly OperationParameter[] = [
  {
    name: "scale",
    in: "query",
    required: false,
    description:
      "PNG pixel density. Default 2 for README banners (automatic height) and 1 for the fixed social sizes. Ignored for SVG.",
    example: 2,
    schema: { type: "integer", enum: [1, 2, 3] },
  },
  {
    name: "download",
    in: "query",
    required: false,
    description:
      "Set to 1 to have the browser save the image instead of showing it.",
    example: 1,
    schema: { type: "integer", enum: [1] },
  },
];

/**
 * JSON operations first, and among them the ones that need no parameter:
 * a client probing "the first operation" gets an answer without guessing.
 */
export const API_OPERATIONS: readonly ApiOperation[] = [
  {
    id: "getOptions",
    path: `${base}/options`,
    summary: "List presets, themes, sizes and parameters",
    description:
      "Everything a banner URL can say: the presets for users, organizations and repositories, the colour themes with their palettes, the canvas sizes, the fonts and every documented query parameter. Takes no parameters, so it also works as a first call to check that the API is reachable.",
    parameters: [],
    bannerOptions: false,
    example: `${base}/options`,
    returns: "An `OptionsCatalog`.",
    kind: "json",
  },
  {
    id: "search",
    path: `${base}/search`,
    summary: "Search accounts and repositories by prefix",
    description:
      "Typeahead over GitHub: accounts whose login starts with the query, or the repositories of one owner when the query is written as owner/prefix. The query must be 2 to 140 characters long.",
    parameters: [
      {
        name: "q",
        in: "query",
        required: true,
        description:
          "The start of a login such as `verc`, or `owner/prefix` such as `vercel/ne` for repositories.",
        example: "verc",
        schema: { type: "string", minLength: 2, maxLength: 140 },
      },
    ],
    bannerOptions: false,
    example: `${base}/search?q=verc`,
    returns: "A `SearchResult`: the query and a list of `Suggestion`s.",
    kind: "json",
  },
  {
    id: "getBanner",
    path: `${base}/banner`,
    summary: "Describe one banner: URLs, embed code, size",
    description:
      "The image URLs, embed snippets, dimensions and alt text of one banner, after checking with GitHub that the target exists. Takes the same option parameters as the image URLs and answers with the canonical form of the banner: GitHub's own capitalisation, default values left out of the query.",
    parameters: [
      {
        name: "target",
        in: "query",
        required: true,
        description:
          "A GitHub login such as `vercel`, or a repository as `owner/name` such as `vercel/next.js`. A github.com URL works too.",
        example: "vercel/next.js",
        schema: { type: "string", minLength: 1, maxLength: 160 },
      },
      {
        name: "preset",
        in: "query",
        required: false,
        description:
          "Preset id for the kind of target. An id that does not exist for the kind falls back to its default preset.",
        example: "contributors",
        schema: { type: "string", pattern: "^[a-z][a-z0-9-]{0,39}$" },
      },
    ],
    bannerOptions: true,
    example: `${base}/banner?target=vercel/next.js&preset=contributors&theme=dracula`,
    returns: "A `BannerDescription`.",
    kind: "json",
  },
  {
    id: "getOwner",
    path: `${base}/owners/{login}`,
    summary: "Get a user or an organization",
    description:
      "A GitHub user or organization as normalized JSON: profile, statistics, the contribution calendar with streaks, top repositories and languages. The `kind` field says which of the two it is.",
    parameters: [
      {
        name: "login",
        in: "path",
        required: true,
        description: "GitHub user or organization login.",
        example: "vercel",
        schema: { type: "string", pattern: LOGIN_PATTERN },
      },
      {
        name: "year",
        in: "query",
        required: false,
        description:
          "Calendar year for a user's contribution calendar and statistics, from 2008 to the current year. Omit it for the last 12 months.",
        example: 2025,
        schema: { type: "integer", minimum: OPTION_LIMITS.year.min },
      },
      {
        name: "view",
        in: "query",
        required: false,
        description:
          "`preview` answers faster for users, from one upstream request: profile and contribution calendar, with `complete: false` and the remaining statistics `null`. Default `full`.",
        example: "preview",
        schema: { type: "string", enum: ["full", "preview"], default: "full" },
      },
    ],
    bannerOptions: false,
    example: `${base}/owners/vercel`,
    returns: "A `User` or an `Organization`.",
    kind: "json",
  },
  {
    id: "getRepository",
    path: `${base}/repos/{owner}/{repo}`,
    summary: "Get a repository",
    description:
      "A public repository as normalized JSON: counts, languages, a year of weekly commit activity, star history, the latest release and top contributors. A renamed repository answers under its current name.",
    parameters: [
      ownerParam("Login of the user or organization that owns the repository."),
      {
        name: "repo",
        in: "path",
        required: true,
        description: "Repository name as it appears on github.com.",
        example: "next.js",
        schema: { type: "string", pattern: REPO_PATTERN },
      },
    ],
    bannerOptions: false,
    example: `${base}/repos/vercel/next.js`,
    returns: "A `Repository`.",
    kind: "json",
  },
  {
    id: "getIndex",
    path: base,
    summary: "Get the API index",
    description:
      "Where everything is: the current version, the OpenAPI description, the docs, the MCP endpoint and one URL template per operation and image form.",
    parameters: [],
    bannerOptions: false,
    example: base,
    returns: "An `ApiIndex`.",
    kind: "json",
  },
  {
    id: "getApiRoot",
    path: "/api",
    summary: "Get the API root",
    description:
      "The unversioned entry point. It answers with the same index as the current version, so a client that only knows the host can find the versioned operations from here.",
    parameters: [],
    bannerOptions: false,
    example: "/api",
    returns: "An `ApiIndex`.",
    kind: "json",
  },
  {
    id: "getOwnerImage",
    path: "/{owner}.{format}",
    summary: "Draw the banner of a user or an organization",
    description:
      "The live banner image of a GitHub user or organization, drawn with the default preset. Always answers 200 with an image: an unknown login or an upstream failure is drawn as a card and reported in the `X-Banner-State` header, because an embedded image must never turn into a broken-image icon.",
    parameters: [
      ownerParam(
        "GitHub user or organization login. Write `@login` for a login that collides with a route of this site, such as `@docs`.",
      ),
      formatParam,
      ...imageParams,
    ],
    bannerOptions: true,
    example: `/${login}.svg`,
    returns: "An SVG or PNG image.",
    kind: "image",
  },
  {
    id: "getRepositoryImage",
    path: "/{owner}/{repo}.{format}",
    summary: "Draw the banner of a repository, or a profile preset",
    description:
      "The live banner image of a public repository. When the second segment is the id of a profile preset (such as `activity`, `stats` or `streak`) the answer is that preset of the owner's banner instead. A third segment selects a repository preset: `/{owner}/{repo}/{preset}.{format}`. Always answers 200 with an image, like the owner form.",
    parameters: [
      ownerParam("Login of the user or organization."),
      {
        name: "repo",
        in: "path",
        required: true,
        description: `Repository name, or one of the profile preset ids: ${[...OWNER_PRESET_IDS].join(", ")}.`,
        example: "next.js",
        schema: { type: "string", pattern: REPO_PATTERN },
      },
      formatParam,
      ...imageParams,
    ],
    bannerOptions: true,
    example: "/vercel/next.js.png",
    returns: "An SVG or PNG image.",
    kind: "image",
  },
] as const;

export function apiOperation(id: string): ApiOperation {
  const found = API_OPERATIONS.find((operation) => operation.id === id);
  if (!found) throw new Error(`unknown operation: ${id}`);
  return found;
}
