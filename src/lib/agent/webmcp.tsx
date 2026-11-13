"use client";

/**
 * WebMCP: tools an agent working in the page can call, registered on
 * `document.modelContext` in browsers that implement the draft. Everywhere
 * else this component does nothing.
 *
 * Each tool is a literal `document.modelContext.registerTool({...})` call
 * with its name, description and schema written out in place. That is
 * deliberate: agents and scanners read tool definitions statically from the
 * page's scripts, so they must not be assembled from variables.
 *
 * The read tools call the public JSON API. `save_banner` and
 * `update_saved_banner` call the account routes with the visitor's own
 * session, which is the point of an in-page tool: they answer with a
 * problem (`unauthorized`) when nobody is signed in.
 */
import { useEffect } from "react";
import { parseTargetSlug } from "@/lib/embed";

interface ModelContextTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
    consequentialHint?: boolean;
  };
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

interface ModelContext {
  registerTool(
    tool: ModelContextTool,
    options?: { signal?: AbortSignal },
  ): void;
}

declare global {
  interface Document {
    /** WebMCP draft. Absent in browsers that do not implement it. */
    readonly modelContext?: ModelContext;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** GET a public API operation. Problems come back as their JSON body. */
async function read(
  path: string,
  params: Record<string, string | undefined>,
): Promise<unknown> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  const suffix = query.size > 0 ? `?${query}` : "";
  const response = await fetch(`${path}${suffix}`, {
    headers: { accept: "application/json" },
  });
  return response.json();
}

/** Write to the visitor's account. The session cookie travels with the request. */
async function write(
  method: "POST" | "PATCH",
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

/** The account API takes a target object; tools take the slug people type. */
function savedBannerFields(input: Record<string, unknown>) {
  const slug = text(input.target);
  const target = slug ? parseTargetSlug(slug) : null;
  if (slug && !target) {
    throw new Error(
      'target must be a GitHub login such as "vercel" or "owner/name" such as "vercel/next.js".',
    );
  }
  return {
    ...(text(input.name) ? { name: text(input.name) } : {}),
    ...(target ? { target } : {}),
    ...(text(input.preset) ? { preset: text(input.preset) } : {}),
    ...(typeof input.query === "string"
      ? { query: input.query.trim().replace(/^\?/, "") }
      : {}),
  };
}

export function WebMcp() {
  useEffect(() => {
    if (
      !("modelContext" in document) ||
      typeof document.modelContext?.registerTool !== "function"
    ) {
      return;
    }
    // Unregisters the tools when the component goes away (and between the
    // two effect runs of React's development mode).
    const controller = new AbortController();
    const options = { signal: controller.signal };
    try {
      document.modelContext.registerTool(
        {
          name: "search_github",
          title: "Search GitHub accounts and repositories",
          description:
            "Find GitHub users, organizations or repositories by the start of their name. Returns suggestions with kind, slug, title and star count.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                minLength: 2,
                description:
                  'Start of a login such as "verc", or "owner/prefix" such as "vercel/ne" for repositories.',
              },
            },
            required: ["query"],
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: (input) => read("/api/v1/search", { q: text(input.query) }),
        },
        options,
      );
      document.modelContext.registerTool(
        {
          name: "get_banner",
          title: "Get a banner and its embed code",
          description:
            "Get the live banner of a GitHub user, organization or repository: SVG and PNG URLs, Markdown and HTML embed snippets, size and alt text.",
          inputSchema: {
            type: "object",
            properties: {
              target: {
                type: "string",
                description:
                  'GitHub login such as "vercel", or a repository as "owner/name" such as "vercel/next.js".',
              },
              preset: {
                type: "string",
                description:
                  'Preset id such as "streak" or "contributors". Omit it for the default.',
              },
              theme: {
                type: "string",
                description:
                  'Theme id such as "dracula". Default "github-dark".',
              },
              size: {
                type: "string",
                description:
                  'Canvas size id such as "og" or "x". Default "readme". list_banner_options names them all.',
              },
            },
            required: ["target"],
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: (input) =>
            read("/api/v1/banner", {
              target: text(input.target),
              preset: text(input.preset),
              theme: text(input.theme),
              size: text(input.size),
            }),
        },
        options,
      );
      document.modelContext.registerTool(
        {
          name: "list_banner_options",
          title: "List banner presets, themes and sizes",
          description:
            "List every banner preset, colour theme, canvas size and query parameter, with ids to use in get_banner and save_banner.",
          inputSchema: { type: "object", properties: {} },
          annotations: { readOnlyHint: true },
          execute: () => read("/api/v1/options", {}),
        },
        options,
      );
      document.modelContext.registerTool(
        {
          name: "save_banner",
          title: "Save a banner to the visitor's account",
          description:
            "Save a banner in the signed-in visitor's account, which gives it a stable link. Answers with an error when nobody is signed in or the plan's limit is reached.",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                maxLength: 60,
                description:
                  "Label for the saved banner, shown in the dashboard.",
              },
              target: {
                type: "string",
                description:
                  'GitHub login such as "vercel", or a repository as "owner/name".',
              },
              preset: {
                type: "string",
                description:
                  "Preset id. Omit it for the default of the target.",
              },
              query: {
                type: "string",
                description:
                  'Banner options as a query string, for example "theme=dracula&size=og".',
              },
            },
            required: ["name", "target"],
          },
          annotations: { readOnlyHint: false },
          execute: async (input) =>
            write("POST", "/api/banners", savedBannerFields(input)),
        },
        options,
      );
      document.modelContext.registerTool(
        {
          name: "update_saved_banner",
          title: "Change a saved banner",
          description:
            "Rename a saved banner of the signed-in visitor, or change its target, preset or options. Only the fields given are changed.",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description:
                  "Id of the saved banner, as returned by save_banner.",
              },
              name: {
                type: "string",
                maxLength: 60,
                description: "New label.",
              },
              target: {
                type: "string",
                description: 'New target: a login or "owner/name".',
              },
              preset: { type: "string", description: "New preset id." },
              query: {
                type: "string",
                description: "New banner options as a query string.",
              },
            },
            required: ["id"],
          },
          annotations: { readOnlyHint: false },
          execute: async (input) =>
            write(
              "PATCH",
              `/api/banners/${encodeURIComponent(text(input.id) ?? "")}`,
              savedBannerFields(input),
            ),
        },
        options,
      );
    } catch {
      // A tool that is already registered, or a browser with another draft
      // of the API: the page works the same without in-page tools.
    }
    return () => controller.abort();
  }, []);
  return null;
}
