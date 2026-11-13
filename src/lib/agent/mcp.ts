import "server-only";

/**
 * The tools of the MCP server at `/mcp`: thin wrappers around the same
 * transport-independent operations the JSON API serves
 * (`@/lib/api/service`), so both answer the same thing for the same input.
 *
 * Every tool is read-only, declares an input and an output schema, and
 * answers with structured content plus the same JSON as text for clients
 * that only read text. Failures are tool results with `isError` and the
 * `code` values of the API; nothing an upstream said is ever passed on.
 *
 * Tools only: no resources and no prompts are registered, so the server
 * never advertises a capability it could not back.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import {
  BannerDescriptionSchema,
  OptionsCatalogSchema,
  SearchResultSchema,
} from "@/lib/api/schema";
import {
  describeBanner,
  getOwnerData,
  getRepoData,
  optionsCatalog,
  parseYear,
  searchData,
} from "@/lib/api/service";
import {
  DEFAULT_THEME_ID,
  OPTION_LIMITS,
  parseOptions,
  SIZE_IDS,
  THEMES,
} from "@/lib/banner";
import { isGitHubError } from "@/lib/github/errors";
import {
  CalendarSchema,
  OrgSchema,
  RepoSchema,
  UserSchema,
} from "@/lib/github/schema";
import { problemType } from "@/lib/http/problem";
import { MCP_TOOLS } from "./identity";

/** Reads public data from GitHub: read-only, repeatable, open world. */
const READS_GITHUB = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/** Reads this site's own catalog. */
const READS_CATALOG = { ...READS_GITHUB, openWorldHint: false } as const;

interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Structured content, and the same JSON as text. */
function ok(data: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

/**
 * A failed call as a tool result. Only what the API itself would say is
 * passed on: anything unexpected is logged and reported as `internal_error`.
 */
function failure(caught: unknown): ToolResult {
  const known =
    caught instanceof ApiError
      ? caught
      : isGitHubError(caught)
        ? ApiError.fromGitHub(caught)
        : null;
  if (!known) console.error("[mcp] unexpected error", caught);
  const error = known
    ? {
        code: known.code,
        status: known.status,
        title: known.title,
        detail: known.message,
        resolution: known.resolution ?? null,
        retry_after: known.retryAfter,
        type: problemType(known.code),
      }
    : {
        code: "internal_error",
        status: 500,
        title: "Internal error",
        detail: "The request could not be completed.",
        resolution: "Retry in a moment.",
        retry_after: null,
        type: problemType("internal_error"),
      };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error }) }],
  };
}

async function run(
  operation: () => Promise<Record<string, unknown>>,
): Promise<ToolResult> {
  try {
    return ok(await operation());
  } catch (caught) {
    return failure(caught);
  }
}

// A year of contribution days is about 15 kB of JSON an agent rarely needs.
// It is left out unless asked for, so the output schema makes it optional.
const UserToolSchema = UserSchema.extend({
  calendar: CalendarSchema.extend({
    days: CalendarSchema.shape.days
      .optional()
      .describe(
        "One entry per day, oldest first. Only present when include_calendar is true.",
      ),
  }),
});

const LOGIN = z
  .string()
  .min(1)
  .max(40)
  .describe('GitHub login of a user or organization, for example "vercel".');

export function registerTools(server: McpServer): void {
  server.registerTool(
    MCP_TOOLS.get_banner.name,
    {
      title: MCP_TOOLS.get_banner.title,
      description: MCP_TOOLS.get_banner.description,
      inputSchema: z.object({
        target: z
          .string()
          .min(1)
          .max(160)
          .describe(
            'What the banner is about: a GitHub login such as "vercel", or a repository as "owner/name" such as "vercel/next.js". A github.com URL works too.',
          ),
        preset: z
          .string()
          .max(40)
          .optional()
          .describe(
            'Preset id, for example "streak" for a user or "contributors" for a repository. Omit it for the default. list_banner_options names them all.',
          ),
        theme: z
          .enum(THEMES.map((theme) => theme.id))
          .optional()
          .describe(`Colour theme id. Default "${DEFAULT_THEME_ID}".`),
        size: z
          .enum(SIZE_IDS)
          .optional()
          .describe(
            'Canvas: "readme" (default, 846 pixels wide) or a fixed social size such as "x", "linkedin" or "og".',
          ),
        options: z
          .string()
          .max(500)
          .optional()
          .describe(
            'Further banner options as a query string, for example "accent=ff7ac6&hide=bio". list_banner_options documents every parameter.',
          ),
      }),
      outputSchema: z.object(BannerDescriptionSchema.shape),
      annotations: READS_GITHUB,
    },
    ({ target, preset, theme, size, options }) =>
      run(async () => {
        const query = new URLSearchParams(options ?? "");
        if (theme) query.set("theme", theme);
        if (size) query.set("size", size);
        return describeBanner({
          target,
          preset: preset ?? null,
          options: parseOptions(query),
        });
      }),
  );

  server.registerTool(
    MCP_TOOLS.search_github.name,
    {
      title: MCP_TOOLS.search_github.title,
      description: MCP_TOOLS.search_github.description,
      inputSchema: z.object({
        query: z
          .string()
          .min(2)
          .max(140)
          .describe(
            'The start of a login such as "verc", or "owner/prefix" such as "vercel/ne" to search the repositories of one owner.',
          ),
      }),
      outputSchema: z.object(SearchResultSchema.shape),
      annotations: READS_GITHUB,
    },
    ({ query }) => run(() => searchData(query)),
  );

  server.registerTool(
    MCP_TOOLS.get_owner.name,
    {
      title: MCP_TOOLS.get_owner.title,
      description: MCP_TOOLS.get_owner.description,
      inputSchema: z.object({
        login: LOGIN,
        year: z
          .number()
          .int()
          .min(OPTION_LIMITS.year.min)
          .max(OPTION_LIMITS.year.max)
          .optional()
          .describe(
            "Calendar year for a user's contributions and statistics. Omit it for the last 12 months.",
          ),
        include_calendar: z
          .boolean()
          .default(false)
          .describe(
            "Also return the contribution count of every single day. Off by default: it is about 370 entries.",
          ),
      }),
      outputSchema: z.object({
        owner: z.discriminatedUnion("kind", [UserToolSchema, OrgSchema]),
      }),
      annotations: READS_GITHUB,
    },
    ({ login, year, include_calendar }) =>
      run(async () => {
        const owner = await getOwnerData(login, { year: parseYear(year) });
        if (owner.kind !== "user" || include_calendar) return { owner };
        const { days: _days, ...calendar } = owner.calendar;
        return { owner: { ...owner, calendar } };
      }),
  );

  server.registerTool(
    MCP_TOOLS.get_repository.name,
    {
      title: MCP_TOOLS.get_repository.title,
      description: MCP_TOOLS.get_repository.description,
      inputSchema: z.object({
        owner: LOGIN,
        repo: z
          .string()
          .min(1)
          .max(100)
          .describe(
            'Repository name as it appears on github.com, for example "next.js".',
          ),
      }),
      outputSchema: z.object({ repository: RepoSchema }),
      annotations: READS_GITHUB,
    },
    ({ owner, repo }) =>
      run(async () => ({ repository: await getRepoData(owner, repo) })),
  );

  server.registerTool(
    MCP_TOOLS.list_banner_options.name,
    {
      title: MCP_TOOLS.list_banner_options.title,
      description: MCP_TOOLS.list_banner_options.description,
      inputSchema: z.object({}),
      outputSchema: z.object(OptionsCatalogSchema.shape),
      annotations: READS_CATALOG,
    },
    () => run(async () => optionsCatalog()),
  );
}
