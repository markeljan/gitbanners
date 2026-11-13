/**
 * Response shapes of the public API that are not GitHub entities (those live
 * in `@/lib/github/schema`). Zod is the single source: the routes return
 * these shapes, `/openapi.json` and the MCP tools are generated from them.
 */
import { z } from "zod";
import { OwnerSuggestionSchema } from "@/lib/github/schema";

export const BannerTargetSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("owner"),
      login: z.string().describe("GitHub user or organization login."),
    }),
    z.object({
      kind: z.literal("repo"),
      owner: z.string().describe("Login of the repository owner."),
      name: z.string().describe("Repository name."),
    }),
  ])
  .meta({
    id: "BannerTarget",
    description: "What a banner is about: an account or a repository.",
  });

export const BannerLinksSchema = z
  .object({
    page: z.url().describe("Human page of the target with every banner."),
    svg: z.url().describe("Live SVG image. Embed this one in a README."),
    png: z.url().describe("Live PNG image, for surfaces that do not draw SVG."),
    embed: z
      .url()
      .describe("Extension-less image URL; the format follows Accept."),
    studio: z.url().describe("The studio opened on this banner."),
  })
  .meta({ id: "BannerLinks" });

export const BannerSnippetsSchema = z
  .object({
    markdown: z.string().describe("Markdown image wrapped in a link."),
    html: z.string().describe("HTML image wrapped in a link."),
    picture: z
      .string()
      .describe(
        "HTML picture element that follows the reader's light or dark theme.",
      ),
    url: z.url().describe("The bare image URL."),
  })
  .meta({ id: "BannerSnippets" });

export const BannerDescriptionSchema = z
  .object({
    target: BannerTargetSchema,
    slug: z.string().describe("`login` or `owner/name`, as typed in URLs."),
    kind: z
      .enum(["user", "org", "repo"])
      .describe("What the target turned out to be on GitHub."),
    title: z.string().describe("Display name of the target."),
    preset: z.string().describe("Preset the banner is drawn with."),
    query: z
      .string()
      .describe("Canonical option query without the leading question mark."),
    width: z.int().describe("Image width in CSS pixels."),
    height: z.int().describe("Image height in CSS pixels."),
    alt: z.string().describe("Plain-text description of the banner."),
    links: BannerLinksSchema,
    snippets: BannerSnippetsSchema,
    presets: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
          svg: z.url(),
        }),
      )
      .describe("Every preset available for this kind of target."),
  })
  .meta({
    id: "BannerDescription",
    description:
      "URLs, embed snippets and dimensions of one banner, verified against GitHub.",
  });

export const SearchResultSchema = z
  .object({
    query: z.string().describe("The query as it was searched."),
    suggestions: z.array(OwnerSuggestionSchema),
  })
  .meta({ id: "SearchResult" });

const ColorsSchema = z.object({
  bg: z.string(),
  surface: z.string(),
  border: z.string(),
  text: z.string(),
  muted: z.string(),
  accent: z.string(),
  heat: z.array(z.string()).length(5),
});

export const OptionsCatalogSchema = z
  .object({
    presets: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(["user", "org", "repo"]),
        name: z.string(),
        description: z.string(),
        sections: z.array(z.string()),
        default: z.boolean().describe("Drawn at the bare URL of its kind."),
        path: z.string().describe("URL pattern of this preset."),
      }),
    ),
    themes: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        mode: z.enum(["dark", "light"]),
        default: z.boolean(),
        colors: ColorsSchema,
      }),
    ),
    sizes: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        width: z.int(),
        height: z.int().nullable().describe("null: follows the content."),
        default: z.boolean(),
      }),
    ),
    fonts: z.array(z.object({ id: z.string(), name: z.string() })),
    sections: z.array(z.string()),
    stats: z.array(z.string()),
    hide: z.array(z.string()),
    parameters: z.array(
      z.object({
        name: z.string(),
        type: z.string(),
        description: z.string(),
        example: z.string(),
        pro: z.boolean().describe("Only honoured on saved Pro banners."),
      }),
    ),
    limits: z.record(z.string(), z.unknown()),
  })
  .meta({
    id: "OptionsCatalog",
    description: "Everything a banner URL can say: presets, themes, sizes.",
  });

export type BannerDescription = z.infer<typeof BannerDescriptionSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type OptionsCatalog = z.infer<typeof OptionsCatalogSchema>;
