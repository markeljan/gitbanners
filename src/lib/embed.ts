/**
 * Links and embed snippets of one banner.
 *
 * Isomorphic and dependency-light: the studio, the owner pages, the JSON API
 * and the MCP server all print the same URLs through this file, so a snippet
 * copied anywhere points at the same cached image.
 */
import { bannerPath } from "@/lib/banner/path";
import type { BannerTarget } from "@/lib/banner/types";
import { site } from "@/lib/site";

export interface BannerLinkInput {
  target: BannerTarget;
  /** Preset id, or `null` for the default of the target's kind. */
  preset?: string | null;
  /** Canonical option query without "?" (see `canonicalQuery`). */
  query?: string;
  /** Origin to print. Defaults to the canonical site URL. */
  origin?: string;
}

export interface BannerLinks {
  /** Human page of the target with every preset. */
  page: string;
  /** Live SVG: the form to embed in a README. */
  svg: string;
  /** Live PNG: for surfaces that do not draw SVG (X, LinkedIn, Open Graph). */
  png: string;
  /** Extension-less image URL; the format follows the `Accept` header. */
  embed: string;
  /** The studio opened on this banner. */
  studio: string;
}

/** The slug people type: `vercel` or `vercel/next.js`. */
export function targetSlug(target: BannerTarget): string {
  return target.kind === "repo"
    ? `${target.owner}/${target.name}`
    : target.login;
}

/** Parses `vercel`, `@docs` or `vercel/next.js` typed by a person or agent. */
export function parseTargetSlug(input: string): BannerTarget | null {
  const value = input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  const parts = value.split("/");
  if (parts.length === 1 && /^[a-zA-Z\d][a-zA-Z\d-]{0,38}$/.test(parts[0])) {
    return { kind: "owner", login: parts[0] };
  }
  if (
    parts.length === 2 &&
    /^[a-zA-Z\d][a-zA-Z\d-]{0,38}$/.test(parts[0]) &&
    /^(?!\.{1,2}$)[\w.-]{1,100}$/.test(parts[1])
  ) {
    return { kind: "repo", owner: parts[0], name: parts[1] };
  }
  return null;
}

/** Relative URL of the studio opened on a banner. */
export function studioPath(input: Omit<BannerLinkInput, "origin">): string {
  const params = new URLSearchParams();
  params.set("target", targetSlug(input.target));
  if (input.preset) params.set("preset", input.preset);
  const base = params.toString().replace(/%2F/gi, "/");
  const query = (input.query ?? "").replace(/^\?/, "");
  return `/studio?${base}${query ? `&${query}` : ""}`;
}

export function bannerLinks(input: BannerLinkInput): BannerLinks {
  const origin = (input.origin ?? site.url).replace(/\/+$/, "");
  const { target, preset = null, query = "" } = input;
  const image = (format: "svg" | "png") =>
    `${origin}${bannerPath(target, { preset, format, query })}`;
  return {
    page: `${origin}${bannerPath(target)}`,
    svg: image("svg"),
    png: image("png"),
    embed: `${origin}/embed${bannerPath(target, { preset, query })}`,
    studio: `${origin}${studioPath({ target, preset, query })}`,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Markdown image alt text cannot hold brackets or line breaks. */
function markdownAlt(text: string): string {
  return text.replace(/[[\]\r\n]+/g, " ").trim();
}

function withTheme(url: string, theme: string): string {
  const next = new URL(url);
  next.searchParams.set("theme", theme);
  return next.toString();
}

export interface BannerSnippets {
  /** `[![alt](image)](page)` for a README. */
  markdown: string;
  /** `<a><img></a>` for HTML and README files that need a width. */
  html: string;
  /** `<picture>` that follows the reader's light or dark GitHub theme. */
  picture: string;
  /** The bare image URL. */
  url: string;
}

export function bannerSnippets(
  links: BannerLinks,
  alt: string,
  options: { width?: number | null } = {},
): BannerSnippets {
  const safeAlt = escapeHtml(alt);
  const width = options.width ? ` width="${options.width}"` : "";
  return {
    markdown: `[![${markdownAlt(alt)}](${links.svg})](${links.page})`,
    html: `<a href="${links.page}"><img src="${escapeHtml(links.svg)}" alt="${safeAlt}"${width}></a>`,
    picture: [
      `<a href="${links.page}">`,
      "  <picture>",
      `    <source media="(prefers-color-scheme: dark)" srcset="${escapeHtml(withTheme(links.svg, "github-dark"))}">`,
      `    <img src="${escapeHtml(withTheme(links.svg, "github-light"))}" alt="${safeAlt}"${width}>`,
      "  </picture>",
      "</a>",
    ].join("\n"),
    url: links.svg,
  };
}
