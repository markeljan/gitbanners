/**
 * The llms.txt family (llmstxt.org): an index of the site for language
 * models, two section indexes, and every content page as one document.
 *
 * Only URLs that answer are listed: scanners follow the links.
 */
import { docs } from "@/content/docs";
import { bannerImageUrl } from "@/content/markdown";
import { CONTENT_PAGES, contentMarkdown } from "@/content/pages";
import { SHOWCASE } from "@/content/showcase";
import { absoluteUrl, site } from "@/lib/site";
import { AGENT_SKILL, MCP_SERVER } from "./identity";
import { markdownPath } from "./metadata";
import { API_OPERATIONS } from "./operations";

const N = site.name;
const url = absoluteUrl;

const SUMMARY = `${N} turns any public GitHub user, organization or repository into a live banner image (SVG or PNG) with a stable URL. Paste one URL into a README, a profile or a website. No account, API key or build step is needed.`;

export function llmsTxt(): string {
  const examples = SHOWCASE.map(
    (item) => `- [${item.title}](${bannerImageUrl(item.path)}): ${item.blurb}`,
  ).join("\n");

  return `# ${N}

> ${SUMMARY}

## When to use ${N}

Use ${N} when someone wants a GitHub profile banner, a stats card, a contribution graph image, a contributor wall or a repository social preview for a README, a personal site or a social header. Use it when you need an embeddable image URL for a GitHub login such as \`vercel\` or a repository such as \`vercel/next.js\`, ready-made Markdown or HTML embed code, the public numbers behind a profile or a repository as JSON, or the list of presets, themes and sizes. Call the JSON API or the MCP server for structured output; link to the banner page for a person.

Do not use ${N} to read private GitHub data, to write to GitHub, or as a general GitHub API proxy: it shows public data only, through a fixed set of operations. It does not host other images.

## How to call it

- Image: \`${url("/{owner}.svg")}\` or \`.png\`; a repository is \`${url("/{owner}/{repo}.svg")}\`. A preset goes last in the path (\`/vercel/next.js/contributors.svg\`), options go in the query (\`?theme=dracula&size=og\`).
- JSON: \`GET ${url(`${site.api.basePath}/banner`)}?target={owner}\` or \`?target={owner}/{repo}\` returns the image URLs, embed snippets, size and alt text. No authentication is required.
- MCP: connect a Streamable HTTP client to \`${url(MCP_SERVER.path)}\` and call \`get_banner\`.
- Markdown: add \`.md\` to a page URL, or send \`Accept: text/markdown\`.

## Main pages

- [${N} home](${url("/")}): type a GitHub login and get a banner
- [Pricing](${url("/pricing")}): Free and Pro, which costs one GitHub star ([Markdown](${url("/pricing.md")}))
- [About](${url("/about")}): what it is and who runs it
- [Contact](${url("/contact")})
- [Privacy](${url("/privacy")}): what is read, what is stored, how to delete it
- [Terms of use](${url("/terms")})

## Developer resources

- [API docs](${url("/docs")}): URL patterns, presets, themes, parameters, the JSON API, errors, rate limits and versioning
- [OpenAPI description](${url("/openapi.json")})
- [API catalog (RFC 9727)](${url("/.well-known/api-catalog")})
- [MCP server card](${url(`${MCP_SERVER.path}/server-card`)}): read-only tools over Streamable HTTP at \`${url(MCP_SERVER.path)}\`, no authentication
- [Agent skill](${url(AGENT_SKILL.path)})
- [Agent skills index](${url("/.well-known/agent-skills/index.json")})
- [ARD catalog](${url("/.well-known/ard.json")})
- [Sitemap](${url("/sitemap.xml")})

## Section indexes

- [Docs index](${url("/docs/llms.txt")}): one entry per docs topic
- [API index](${url("/api/llms.txt")}): one entry per operation

## Examples

Live banners. Each link is an image; replace the names with any public GitHub login or repository.

${examples}

## Optional

- [Home page as Markdown](${url("/index.md")})
- [Every content page as one document](${url("/llms-full.txt")})
- [Versioning and deprecation policy](${url("/docs#versioning-and-deprecation")})
`;
}

export function docsLlmsTxt(): string {
  const topics = docs.sections
    .filter((section) => (section.level ?? 2) === 2)
    .map((section) => `- [${section.title}](${url(`/docs#${section.id}`)})`)
    .join("\n");
  return `# ${N} docs

> Topics of the ${N} documentation. Parent index: ${url("/llms.txt")}

## Topics

${topics}

## Other formats

- [Docs as Markdown](${url("/docs.md")})
- [OpenAPI description](${url("/openapi.json")})
`;
}

export function apiLlmsTxt(): string {
  const operations = API_OPERATIONS.map(
    (operation) =>
      `- [${operation.id}](${url(operation.example)}): \`GET ${operation.path}\`. ${operation.summary}`,
  ).join("\n");
  return `# ${N} API

> Keyless, read-only operations of ${N}: JSON under ${url(site.api.basePath)} and banner images at the site root. Parent index: ${url("/llms.txt")}

## Operations

Each link is a request that works as written.

${operations}

## Reference

- [OpenAPI description](${url("/openapi.json")})
- [API docs](${url("/docs#rest-api")}): parameters, errors, rate limits
- [API catalog (RFC 9727)](${url("/.well-known/api-catalog")})
`;
}

/** Every content page in full, each under its own address. */
export function llmsFullTxt(): string {
  const pages = CONTENT_PAGES.map(
    (page) =>
      `Source: ${url(page.path)} (Markdown: ${url(markdownPath(page.path))}, updated ${page.updated})\n\n${contentMarkdown(page).trimEnd()}`,
  );
  return `# ${N}: all pages

> ${SUMMARY}

This document holds every content page of ${site.url} in full. The index with links is at ${url("/llms.txt")}.

---

${pages.join("\n\n---\n\n")}
`;
}
