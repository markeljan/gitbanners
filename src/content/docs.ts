import { errorAnchor, errorCodes } from "@/lib/agent/error-codes";
import { AGENT_SKILL, MCP_SERVER, MCP_TOOLS } from "@/lib/agent/identity";
import {
  API_OPERATIONS,
  type ApiOperation,
  type OperationParameter,
} from "@/lib/agent/operations";
import { PARAMETER_DOCS } from "@/lib/api/parameters";
import {
  DEFAULT_THEME_ID,
  defaultPresetId,
  type EntityKind,
  OPTION_LIMITS,
  OWNER_PRESET_IDS,
  PRESETS,
  SIZES,
  THEMES,
} from "@/lib/banner";
import { bannerLinks, bannerSnippets } from "@/lib/embed";
import { CACHE } from "@/lib/http/cache-headers";
import { site } from "@/lib/site";
import { FACTS, quota } from "./facts";
import { duration } from "./format";
import type { Block, ContentPage, Section } from "./types";

const U = site.url;
const login = site.exampleLogin;

const KIND_LABEL: Record<EntityKind, string> = {
  user: "User",
  org: "Organization",
  repo: "Repository",
};

function presetUrl(kind: EntityKind, id: string): string {
  const base = kind === "repo" ? "/{owner}/{repo}" : "/{owner}";
  return id === defaultPresetId(kind) ? `${base}.svg` : `${base}/${id}.svg`;
}

const exampleLinks = bannerLinks({ target: { kind: "owner", login } });
const exampleSnippets = bannerSnippets(
  exampleLinks,
  `GitHub banner for ${login}`,
);

function anchorOf(operation: ApiOperation): string {
  return operation.id.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function parameterLine(parameter: OperationParameter): string {
  const where = parameter.in === "path" ? "path" : "query";
  const need = parameter.required ? "required" : "optional";
  return `\`${parameter.name}\` (${where}, ${need}): ${parameter.description}`;
}

function operationSection(operation: ApiOperation): Section {
  const blocks: Block[] = [
    {
      type: "p",
      text: `\`GET ${operation.path}\`. ${operation.description}`,
    },
  ];
  const lines = operation.parameters.map(parameterLine);
  if (operation.bannerOptions) {
    lines.push(
      "Every [banner parameter](#parameters) as a query parameter, such as `theme`, `size` or `accent`.",
    );
  }
  if (lines.length > 0) blocks.push({ type: "list", items: lines });
  blocks.push({
    type: "code",
    lang: "bash",
    code:
      operation.kind === "image"
        ? `curl -o banner.${operation.example.split(".").pop()} "${U}${operation.example}"`
        : `curl "${U}${operation.example}"`,
  });
  blocks.push({ type: "p", text: `Returns: ${operation.returns}` });
  return {
    id: anchorOf(operation),
    title: operation.summary,
    level: 3,
    blocks,
  };
}

const jsonOperations = API_OPERATIONS.filter(
  (operation) => operation.kind === "json",
);
const imageOperations = API_OPERATIONS.filter(
  (operation) => operation.kind === "image",
);

function errorTable(surface: "api" | "account"): Block {
  const codes = errorCodes(surface);
  return {
    type: "table",
    head: ["Code", "Status", "Meaning", "What to do"],
    rows: codes.map((entry) => [
      `\`${entry.code}\``,
      String(entry.status),
      entry.meaning,
      entry.action,
    ]),
    rowIds: codes.map((entry) => errorAnchor(entry.code)),
  };
}

const exampleProblem = {
  documentation_url: `${U}/docs#errors`,
  type: `${U}/docs#${errorAnchor("not_found")}`,
  title: "Not found",
  status: 404,
  detail: "No public GitHub user or organization is named no-such-login-here.",
  code: "not_found",
  resolution: "Check the spelling on github.com, then retry.",
  instance: `${site.api.basePath}/owners/no-such-login-here`,
};

const api = FACTS.rateLimits.api;

export const docs: ContentPage = {
  path: "/docs",
  title: `${site.name} API docs`,
  description: `Reference for ${site.name}: banner image URLs, presets, themes and sizes, the keyless JSON API, errors, rate limits, the MCP server and Markdown pages.`,
  updated: "2026-11-13",
  heading: `${site.name} API docs`,
  lead: `Everything ${site.name} does has an address. A banner is a URL, the data behind it is a JSON API, and the same operations are tools on an MCP server. None of it needs a key, an account or a build step.`,
  sections: [
    {
      id: "quick-start",
      title: "Quick start",
      blocks: [
        {
          type: "p",
          text: "Put a GitHub login, or `owner/repo`, in the path and add `.svg` or `.png`:",
        },
        {
          type: "code",
          lang: "text",
          code: `${U}/${login}.svg\n${U}/vercel/next.js/contributors.png?theme=dracula`,
        },
        {
          type: "p",
          text: "In a README, wrap the image in a link to its page:",
        },
        { type: "code", lang: "md", code: exampleSnippets.markdown },
        {
          type: "p",
          text: "Software should ask the API instead of building URLs by hand. It checks that the target exists and answers with the image URLs and the embed code:",
        },
        {
          type: "code",
          lang: "bash",
          code: `curl "${U}${site.api.basePath}/banner?target=vercel/next.js"`,
        },
      ],
    },
    {
      id: "url-patterns",
      title: "URL patterns",
      blocks: [
        {
          type: "p",
          text: "URLs are shaped like GitHub's own. The same path is a page, an image or a Markdown document, depending on its ending.",
        },
        {
          type: "table",
          head: ["URL", "Answers with"],
          rows: [
            ["`/{owner}`", "The page of a user or an organization."],
            [
              "`/{owner}.svg`, `/{owner}.png`",
              "The banner of that account, drawn with its default preset.",
            ],
            [
              "`/{owner}/{preset}.svg`",
              "One preset of a profile, such as `/torvalds/streak.svg`.",
            ],
            ["`/{owner}/{repo}`", "The page of a repository."],
            ["`/{owner}/{repo}.svg`", "The banner of a repository."],
            [
              "`/{owner}/{repo}/{preset}.svg`",
              "One preset of a repository, such as `/vercel/next.js/contributors.svg`.",
            ],
            [
              "`/embed/{owner}`, `/embed/{owner}/{repo}`",
              "The image without an extension. The format follows the `Accept` header.",
            ],
            ["`/b/{id}.svg`, `/b/{id}.png`", "A saved banner, by its id."],
            [
              "`/{owner}.md`, `/{owner}/{repo}.md`",
              "The page as Markdown: who it is, the numbers, every banner URL.",
            ],
          ],
        },
        {
          type: "list",
          items: [
            "`{owner}` is the login of a GitHub user or organization. It is not case-sensitive; links are printed in lower case.",
            `A second segment that is the id of a profile preset (${[
              ...OWNER_PRESET_IDS,
            ]
              .map((id) => `\`${id}\``)
              .join(
                ", ",
              )}) selects that preset. Anything else is read as a repository name. A repository that shares its name with a preset is written with its own preset: \`/{owner}/{repo}/overview.svg\`.`,
            "A login that collides with a route of this site is written with `@`: `/@docs.svg` is the banner of the GitHub account named docs.",
            "`.svg` and `.png` are honoured on the last segment only, so `/vercel/next.js` is a repository and not a file.",
            "Options go in the query string and are the same for every form: `?theme=dracula&size=og`. A saved banner keeps its own options and ignores them.",
          ],
        },
      ],
    },
    {
      id: "image-responses",
      title: "Image responses",
      level: 3,
      blocks: [
        {
          type: "p",
          text: "A well-formed image URL always answers `200` with an image. A README shows a broken-image icon for any other status, so an unknown login or a GitHub outage is drawn as a small card instead, and the `X-Banner-State` header says which it was.",
        },
        {
          type: "table",
          head: ["`X-Banner-State`", "Meaning", "Kept by the CDN for"],
          rows: [
            ["`ok`", "Drawn from complete data.", duration(CACHE.banner.edge)],
            [
              "`provisional`",
              "Drawn while GitHub was still computing part of the data.",
              duration(CACHE.provisional.edge),
            ],
            [
              "`not_found`",
              "No account or public repository has that name.",
              duration(CACHE.notFound.edge),
            ],
            [
              "`unavailable`",
              "GitHub could not be asked and no earlier copy exists.",
              duration(CACHE.unavailable.edge),
            ],
            ["`error`", "Drawing failed.", duration(CACHE.unavailable.edge)],
          ],
        },
        {
          type: "list",
          items: [
            `\`Cache-Control: public, max-age=${CACHE.banner.downstream}\` lets browsers and GitHub's image proxy reuse an image for ${duration(CACHE.banner.downstream)}. The CDN refreshes its own copy every ${duration(CACHE.banner.edge)}, serves the previous one while it does, and keeps serving it for up to ${duration(CACHE.banner.sie)} if GitHub cannot be reached.`,
            "`Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin`: a banner can be embedded, fetched and drawn on a canvas from any site.",
            "SVG answers carry a `Content-Security-Policy` that allows no scripts and no external resources. Avatars are inlined, so the image needs nothing from the network.",
            "`?scale=1`, `2` or `3` sets the pixel density of a PNG. README banners default to 2, the fixed social sizes to 1. `?download=1` asks the browser to save the file.",
            "A URL that cannot be a banner answers `404` and no image: as a problem (`not_found`) when a login or repository name is too long or malformed or the path has more than three segments, and as the HTML 404 page when the first segment is a route of this site or contains a character no GitHub login can.",
          ],
        },
      ],
    },
    {
      id: "content-negotiation",
      title: "Content negotiation",
      level: 3,
      blocks: [
        {
          type: "p",
          text: "The bare URL of a banner page answers with what the client asks for.",
        },
        {
          type: "table",
          head: ["Request", "Answer"],
          rows: [
            [
              "`Accept: text/html`, `Accept: */*` or no `Accept` header",
              "The HTML page.",
            ],
            [
              "`Accept: text/markdown`, alone or listed before `text/html`",
              "The page as Markdown.",
            ],
            [
              "`Accept: image/*` without `text/html`, which is what an `<img>` tag sends",
              "The image.",
            ],
          ],
        },
        {
          type: "p",
          text: "Negotiated answers carry `Vary: Accept`. Embed snippets always use the explicit `.svg` or `.png` URL, which answers the same for every client.",
        },
      ],
    },
    {
      id: "embedding",
      title: "Embedding",
      level: 3,
      blocks: [
        {
          type: "p",
          text: "Markdown for a README. The image links to its page, where a reader can copy the banner for themselves:",
        },
        { type: "code", lang: "md", code: exampleSnippets.markdown },
        {
          type: "p",
          text: "HTML that follows the reader's light or dark theme on GitHub:",
        },
        { type: "code", lang: "html", code: exampleSnippets.picture },
        {
          type: "p",
          text: `GitHub data is refreshed every ${FACTS.dataRefreshMinutes} minutes, the CDN copy of an image every ${duration(CACHE.banner.edge)}, and GitHub's image proxy keeps its copy for ${duration(CACHE.banner.downstream)}. A banner in a README therefore trails GitHub by less than an hour.`,
        },
      ],
    },
    {
      id: "variants-and-themes",
      title: "Variants and themes",
      blocks: [
        {
          type: "p",
          text: `A banner is a preset (what it shows), a size (the canvas), a theme (the colours) and optional overrides. [GET ${site.api.basePath}/options](#get-options) returns everything in this section as JSON.`,
        },
      ],
    },
    {
      id: "presets",
      title: "Presets",
      level: 3,
      blocks: [
        {
          type: "p",
          text: `There are ${PRESETS.length} presets. The kind of the target decides which ones apply; an id that does not exist for the kind falls back to its default.`,
        },
        {
          type: "table",
          head: ["For", "Preset", "URL", "Shows"],
          rows: PRESETS.map((preset) => [
            KIND_LABEL[preset.kind],
            `\`${preset.id}\``,
            `\`${presetUrl(preset.kind, preset.id)}\``,
            preset.description,
          ]),
        },
      ],
    },
    {
      id: "sizes",
      title: "Sizes",
      level: 3,
      blocks: [
        {
          type: "table",
          head: ["`size`", "Name", "Pixels", "For"],
          rows: Object.values(SIZES).map((size) => [
            `\`${size.id}\``,
            size.name,
            size.height === null
              ? `${size.width} wide, height follows the content`
              : `${size.width} by ${size.height}`,
            size.description,
          ]),
        },
        {
          type: "p",
          text: `\`width\` (${OPTION_LIMITS.width.min} to ${OPTION_LIMITS.width.max}) and \`height\` (${OPTION_LIMITS.height.min} to ${OPTION_LIMITS.height.max}) set a custom canvas in pixels. A custom width without a height keeps the automatic height.`,
        },
      ],
    },
    {
      id: "themes",
      title: "Themes",
      level: 3,
      blocks: [
        {
          type: "p",
          text: `There are ${THEMES.length} themes. The default is \`${DEFAULT_THEME_ID}\`, and an unknown id falls back to it. Every colour of a theme can be overridden with the parameters below.`,
        },
        {
          type: "table",
          head: ["`theme`", "Name", "Mode", "Background", "Accent"],
          rows: THEMES.map((theme) => [
            `\`${theme.id}\``,
            theme.name,
            theme.mode,
            `\`${theme.colors.bg}\``,
            `\`${theme.colors.accent}\``,
          ]),
        },
      ],
    },
    {
      id: "parameters",
      title: "Query parameters",
      level: 3,
      blocks: [
        {
          type: "table",
          head: ["Parameter", "Value", "What it does", "Example"],
          rows: PARAMETER_DOCS.map((parameter) => [
            `\`${parameter.name}\`${parameter.pro ? " (Pro)" : ""}`,
            parameter.type,
            parameter.description,
            `\`${parameter.name}=${parameter.example}\``,
          ]),
        },
        {
          type: "p",
          text: "Parsing is lenient on purpose: an unknown parameter is ignored and an invalid value falls back to the default, so a typo never breaks an image that is already embedded somewhere. The parameters marked Pro are honoured on saved banners of Pro accounts only.",
        },
      ],
    },
    {
      id: "rest-api",
      title: "REST API",
      blocks: [
        {
          type: "p",
          text: `The JSON API lives under \`${U}${site.api.basePath}\`. It is read-only (\`GET\`, \`HEAD\` and \`OPTIONS\`), needs no key, and sends \`Access-Control-Allow-Origin: *\`, so a browser can call it from any site. [/openapi.json](/openapi.json) describes it in OpenAPI 3.1.`,
        },
        {
          type: "table",
          head: ["Operation", "Request", "Returns"],
          rows: jsonOperations.map((operation) => [
            `[\`${operation.id}\`](#${anchorOf(operation)})`,
            `\`GET ${operation.path}\``,
            operation.returns,
          ]),
        },
        {
          type: "p",
          text: `Answers are JSON and may be cached: \`Cache-Control: public, max-age=${CACHE.api.downstream}\` for account and repository data, \`max-age=${CACHE.search.downstream}\` for search and the options catalog. Every answer, errors included, carries the [rate limit headers](#rate-limits) and a \`Link\` header to the OpenAPI description, the API catalog and this page.`,
        },
      ],
    },
    ...jsonOperations.map(operationSection),
    {
      id: "images",
      title: "Image operations",
      level: 3,
      blocks: [
        {
          type: "p",
          text: "The image URLs are part of the same OpenAPI description. They answer with `image/svg+xml` or `image/png` instead of JSON, and follow the rules under [image responses](#image-responses).",
        },
      ],
    },
    ...imageOperations.map(operationSection),
    {
      id: "errors",
      title: "Errors",
      blocks: [
        {
          type: "p",
          text: "Every API answer that is not a success is `application/problem+json` (RFC 9457). Branch on `code`, show `title` and `detail` to a person, and follow `resolution`.",
        },
        {
          type: "code",
          lang: "json",
          code: JSON.stringify(exampleProblem, null, 2),
        },
        {
          type: "table",
          head: ["Member", "What it holds"],
          rows: [
            [
              "`type`",
              "A URL that identifies the kind of problem. It points at the row for the code in the table below.",
            ],
            ["`title`", "A short summary, the same for every case of a code."],
            ["`status`", "The HTTP status code, repeated."],
            ["`detail`", "What went wrong this time."],
            ["`code`", "A stable identifier to branch on."],
            ["`resolution`", "What the caller can do about it."],
            ["`instance`", "The path and query of the request."],
            ["`documentation_url`", "This section."],
          ],
        },
        { type: "p", text: "Codes of the public API and the image URLs:" },
        errorTable("api"),
        {
          type: "p",
          text: "The web app's own account routes (saved banners, the signed-in user) use the same format with these codes. They work with a browser session from this site only and are not part of the public API:",
        },
        errorTable("account"),
      ],
    },
    {
      id: "rate-limits",
      title: "Rate limits",
      blocks: [
        {
          type: "p",
          text: "Requests are counted per client IP address, in short windows. An IPv6 client is counted as its /64 network.",
        },
        {
          type: "table",
          head: ["Policy", "Applies to", "Quota"],
          rows: [
            [
              `\`${api.name}\``,
              `Every operation under \`${site.api.basePath}\` except search, unknown paths under \`/api\`, and the MCP endpoint.`,
              quota("api"),
            ],
            [
              `\`${FACTS.rateLimits.search.name}\``,
              `\`GET ${site.api.basePath}/search\`. Each call can cost a request to GitHub.`,
              quota("search"),
            ],
          ],
        },
        {
          type: "p",
          text: "Every API answer carries the IETF rate limit fields:",
        },
        {
          type: "code",
          lang: "http",
          code: `RateLimit-Policy: "${api.name}";q=${api.limit};w=${api.windowSeconds}\nRateLimit: "${api.name}";r=${api.limit - 1};t=${api.windowSeconds}`,
        },
        {
          type: "list",
          items: [
            "`q` is the quota and `w` the length of the window in seconds.",
            "`r` is what is left in the current window and `t` the seconds until it resets.",
            "Past the quota the answer is `429` with the code `rate_limited` and a `Retry-After` header. Wait that many seconds before the next request.",
            "If the counter itself cannot be reached, requests go through and only `RateLimit-Policy` is sent.",
          ],
        },
        {
          type: "p",
          text: "Banner images and pages are not limited per client. They are cached instead, so embedding a banner on a busy page costs one render per cache lifetime.",
        },
      ],
    },
    {
      id: "data",
      title: "Data and freshness",
      blocks: [
        {
          type: "list",
          items: [
            "Banners and API answers are built from public GitHub data only: profiles, public repositories and the public contribution calendar.",
            'Private repositories are never read or named. If a user turned on "Private contributions" in their GitHub profile settings, GitHub includes those counts in the public calendar, and a banner shows them as counts.',
            `GitHub data is refreshed every ${FACTS.dataRefreshMinutes} minutes. When GitHub cannot be reached, the last good copy is used for up to ${FACTS.lastGoodDays} days.`,
            "`fetchedAt` on every entity says when its data was read from GitHub.",
          ],
        },
      ],
    },
    {
      id: "versioning-and-deprecation",
      title: "Versioning and deprecation",
      blocks: [
        {
          type: "p",
          text: `The version is in the path: \`${site.api.basePath}\`. Within a version, changes only add: new operations, new optional parameters, new members in a response. Clients should ignore members they do not know.`,
        },
        {
          type: "p",
          text: "A change that would break a client ships under a new path (`/api/v2`), and the old version keeps answering while it is being retired. A retiring operation says so in its responses:",
        },
        {
          type: "list",
          items: [
            "`Deprecation`: the date from which the operation counts as deprecated (RFC 9745).",
            `\`Sunset\`: the date after which it may stop answering (RFC 8594), at least ${FACTS.deprecationNoticeDays} days after the deprecation date.`,
            '`Link` with `rel="successor-version"`: the operation to move to.',
          ],
        },
        {
          type: "p",
          text: 'Every API answer already carries a `Link` header with `rel="deprecation"` that points at this section, so a client can find the policy from any response. No operation is deprecated today.',
        },
        {
          type: "p",
          text: "Image URLs follow the same idea from the other side: they ignore what they do not understand, so a banner embedded today keeps drawing when parameters are added later.",
        },
      ],
    },
    {
      id: "authentication",
      title: "Authentication",
      blocks: [
        {
          type: "p",
          text: "None. Every operation on this page is public and needs no API key, token or sign-up.",
        },
        {
          type: "p",
          text: "Sign in with GitHub exists for the web app only, to save banners and unlock Pro. It is a browser session that works from this site alone, and it is not part of the API.",
        },
      ],
    },
    {
      id: "mcp",
      title: "MCP server",
      blocks: [
        {
          type: "p",
          text: `The same data is available to agents as tools on a Model Context Protocol server at \`${U}${MCP_SERVER.path}\`. It speaks Streamable HTTP, is stateless, and needs no credentials. Only \`POST\` is served; \`GET\` and \`DELETE\` answer \`405\`.`,
        },
        {
          type: "table",
          head: ["Tool", "Returns"],
          rows: Object.values(MCP_TOOLS).map((tool) => [
            `\`${tool.name}\``,
            tool.summary,
          ]),
        },
        {
          type: "p",
          text: "Add it to a client that reads an `mcpServers` configuration:",
        },
        {
          type: "code",
          lang: "json",
          code: JSON.stringify(
            {
              mcpServers: {
                gitbanners: { type: "http", url: `${U}${MCP_SERVER.path}` },
              },
            },
            null,
            2,
          ),
        },
        { type: "p", text: "Or call it by hand:" },
        {
          type: "code",
          lang: "bash",
          code: `curl -X POST "${U}${MCP_SERVER.path}" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_banner","arguments":{"target":"vercel/next.js"}}}'`,
        },
        {
          type: "list",
          items: [
            "Every tool is read-only and declares it (`readOnlyHint`). Results come as structured content that matches the tool's output schema, and as the same JSON in a text block.",
            "A failed lookup is a tool result with `isError` and the same `code` values as the REST API. An unknown tool or a malformed message is a JSON-RPC error.",
            `Calls count against the \`${api.name}\` quota (${quota("api")}).`,
            `The server card is at [${MCP_SERVER.path}/server-card](${MCP_SERVER.path}/server-card) and [/.well-known/mcp/server-card.json](/.well-known/mcp/server-card.json); the registry manifest is [/server.json](/server.json).`,
          ],
        },
      ],
    },
    {
      id: "webmcp",
      title: "Tools in the browser",
      level: 3,
      blocks: [
        {
          type: "p",
          text: "In a browser that implements WebMCP, the site registers tools on `document.modelContext` so an agent working in the page can use it directly: `search_github`, `get_banner` and `list_banner_options` read, and `save_banner` and `update_saved_banner` store a banner in the account of the signed-in visitor.",
        },
      ],
    },
    {
      id: "agent-skill",
      title: "Agent skill",
      blocks: [
        {
          type: "p",
          text: `An agent skill that teaches the URL grammar and the machine interfaces is published at [${AGENT_SKILL.path}](${AGENT_SKILL.path}). The index at [/.well-known/agent-skills/index.json](/.well-known/agent-skills/index.json) lists it with the SHA-256 digest of the file, so a client can verify what it downloaded.`,
        },
      ],
    },
    {
      id: "markdown",
      title: "Markdown",
      blocks: [
        {
          type: "p",
          text: "Content pages and banner pages have a Markdown version, for agents that would rather not parse HTML.",
        },
        {
          type: "list",
          items: [
            "Add `.md` to the URL: [/docs.md](/docs.md), [/pricing.md](/pricing.md), `/vercel.md`, `/vercel/next.js.md`. The homepage is [/index.md](/index.md).",
            "Or send `Accept: text/markdown` to the page URL. The answer carries `Vary: Accept`.",
            "Each document opens with front matter: `title`, `description`, `canonical` and `last-updated`.",
            "A path that is nothing answers `404` in Markdown too, with links to the indexes below.",
            "The Markdown of an account or a repository lists who it is, its headline numbers, and the image URL of every preset.",
          ],
        },
      ],
    },
    {
      id: "discovery",
      title: "Machine-readable files",
      blocks: [
        {
          type: "table",
          head: ["URL", "What it is"],
          rows: [
            [
              "[/llms.txt](/llms.txt)",
              "Index of the site for language models.",
            ],
            [
              "[/llms-full.txt](/llms-full.txt)",
              "Every content page as one Markdown document.",
            ],
            [
              "[/docs/llms.txt](/docs/llms.txt), [/api/llms.txt](/api/llms.txt)",
              "Section indexes: the topics of this page, and one entry per API operation.",
            ],
            ["[/openapi.json](/openapi.json)", "OpenAPI 3.1 description."],
            [
              "[/.well-known/api-catalog](/.well-known/api-catalog)",
              "API catalog (RFC 9727).",
            ],
            [
              "[/.well-known/ard.json](/.well-known/ard.json), [/.well-known/ai-catalog.json](/.well-known/ai-catalog.json)",
              "Catalogs of the agent-facing resources.",
            ],
            [
              "[/.well-known/agent-skills/index.json](/.well-known/agent-skills/index.json)",
              "Agent skills index.",
            ],
            [
              `[${MCP_SERVER.path}/server-card](${MCP_SERVER.path}/server-card), [/server.json](/server.json)`,
              "MCP server card and registry manifest.",
            ],
            [
              "[/sitemap.xml](/sitemap.xml), [/robots.txt](/robots.txt)",
              "Sitemap and crawler rules.",
            ],
          ],
        },
      ],
    },
  ],
};
