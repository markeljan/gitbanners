/**
 * GET /robots.txt
 *
 * A route handler instead of `app/robots.ts`: the metadata type cannot
 * print `Content-Signal` lines. Reads nothing from the request, so it is
 * prerendered: a crawler never waits for a function to learn the rules.
 */
import { absoluteUrl } from "@/lib/site";

/** Agents that fetch pages for an answer or an index, named so the rule is explicit. */
const AI_AGENTS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "Claude-SearchBot",
  "Claude-User",
  "ClaudeBot",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
];

/**
 * What crawlers have no business with: the sign-in round trip, the account
 * routes (they answer per visitor) and the internal handlers behind the
 * public URLs. The public API and the image URLs stay open: link previews
 * and agents fetch them.
 */
const PRIVATE = ["/api/auth/", "/api/me", "/api/banners", "/dashboard", "/-/"];

function group(agents: readonly string[]): string[] {
  return [
    ...agents.map((agent) => `User-Agent: ${agent}`),
    "Content-Signal: search=yes, ai-input=yes, ai-train=yes",
    "Allow: /",
    ...PRIVATE.map((path) => `Disallow: ${path}`),
  ];
}

export function GET(): Response {
  const body = [
    ...group(AI_AGENTS),
    "",
    ...group(["*"]),
    "",
    `Sitemap: ${absoluteUrl("/sitemap.xml")}`,
    "",
  ].join("\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
