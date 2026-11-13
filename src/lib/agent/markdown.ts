/**
 * Markdown versions of pages: what `/{page}.md` and `Accept: text/markdown`
 * answer with. Pure functions that build the documents; the route handler
 * in `src/app/-/md` adds the data access and the HTTP headers.
 *
 * Every document opens with front matter (`title`, `description`,
 * `canonical`, `last-updated`), uses absolute URLs so it stands on its own
 * outside the site, and has balanced code fences.
 */
import { contentMarkdown } from "@/content/pages";
import type { ContentPage } from "@/content/types";
import type { BannerDescription } from "@/lib/api/schema";
import {
  bannerPath,
  defaultPresetId,
  formatNumber,
  type ParsedBannerPath,
  presetsFor,
  targetLabel,
} from "@/lib/banner";
import { bannerLinks } from "@/lib/embed";
import type { Entity, RepoSummary } from "@/lib/github/schema";
import { absoluteUrl, site } from "@/lib/site";
import { MCP_SERVER } from "./identity";
import { previewImagePath } from "./metadata";

export interface FrontMatter {
  title: string;
  description: string;
  /** Absolute URL of the HTML page this document is a version of. */
  canonical: string;
  /** ISO date or timestamp of the last change. */
  updated: string;
}

/** YAML front matter. Strings are JSON-quoted, which YAML reads as written. */
export function frontMatter(meta: FrontMatter): string {
  return [
    "---",
    `title: ${JSON.stringify(meta.title)}`,
    `description: ${JSON.stringify(meta.description)}`,
    `canonical: ${meta.canonical}`,
    `last-updated: ${meta.updated.slice(0, 10)}`,
    "---",
    "",
    "",
  ].join("\n");
}

/** The entry points an agent can continue from, as a Markdown list. */
function resourceList(): string {
  return [
    `- [Docs](${absoluteUrl("/docs")}): URL patterns, parameters, API, errors and limits`,
    `- [OpenAPI description](${absoluteUrl("/openapi.json")})`,
    `- MCP server (Streamable HTTP): \`${absoluteUrl(MCP_SERVER.path)}\``,
    `- [llms.txt](${absoluteUrl("/llms.txt")}): index of this site for language models`,
    `- [Sitemap](${absoluteUrl("/sitemap.xml")})`,
  ].join("\n");
}

/** A content page as a complete Markdown document. */
export function contentDocument(page: ContentPage): string {
  const body = contentMarkdown(page);
  // Markdown has no site footer; the homepage carries the links one would hold.
  const footer =
    page.path === "/" ? `\n## Public resources\n\n${resourceList()}\n` : "";
  const head = frontMatter({
    title: page.title,
    description: page.description,
    canonical: absoluteUrl(page.path),
    updated: page.updated,
  });
  return `${head}${body}${footer}`;
}

/**
 * The 404 an agent can recover from: what happened, in a sentence, and the
 * indexes to continue with.
 */
export function notFoundDocument(requestedPath: string): string {
  const shown = requestedPath.replace(/[`\s]+/g, " ").slice(0, 200);
  return `# Page not found

There is no ${site.name} page at \`${shown}\`.

Banner pages live at \`/{owner}\` and \`/{owner}/{repo}\`, where owner is the login of a GitHub user or organization. Add \`.svg\` or \`.png\` for the image, or \`.md\` for Markdown.

Continue from one of these:

- [Home](${absoluteUrl("/")}): make a banner from a GitHub login
${resourceList()}
`;
}

/** 503 while GitHub cannot be asked and no earlier copy of the data exists. */
export function unavailableDocument(
  requestedPath: string,
  retryAfterSeconds: number,
): string {
  const shown = requestedPath.replace(/[`\s]+/g, " ").slice(0, 200);
  return `# GitHub is not answering

The page at \`${shown}\` is built from live GitHub data, and GitHub could not be asked just now. Nothing is wrong with the address. Retry in ${retryAfterSeconds} seconds.

Meanwhile:

${resourceList()}
`;
}

/** 500 for a failure that is neither the caller's nor GitHub's. */
export function errorDocument(requestedPath: string): string {
  const shown = requestedPath.replace(/[`\s]+/g, " ").slice(0, 200);
  return `# Something went wrong

The page at \`${shown}\` could not be built. The fault is on this side, not in the address. Retry in a moment.

Meanwhile:

${resourceList()}
`;
}

// --- Banner pages ----------------------------------------------------------

/**
 * Text written by GitHub users (names, bios, descriptions), made safe to
 * drop into a Markdown line: one line, and nothing in it can start a link,
 * an image, raw HTML, a code span or a table cell.
 */
export function userText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\`[\]<>|*]/g, "\\$&");
}

function fact(label: string, value: number | null | undefined): string | null {
  return typeof value === "number"
    ? `| ${label} | ${formatNumber(value)} |`
    : null;
}

function table(rows: readonly (string | null)[]): string {
  const kept = rows.filter((row): row is string => row !== null);
  return ["| | |", "| --- | --- |", ...kept].join("\n");
}

function repoLine(repo: RepoSummary): string {
  const slug = `${repo.owner}/${repo.name}`;
  const page = absoluteUrl(
    bannerPath({ kind: "repo", owner: repo.owner, name: repo.name }),
  );
  const description = userText(repo.description);
  const details = [
    `${formatNumber(repo.stars)} stars`,
    repo.language ? userText(repo.language.name) : null,
  ]
    .filter(Boolean)
    .join(", ");
  return `- [${userText(slug)}](${page})${description ? `: ${description}` : ""} (${details})`;
}

function identity(entity: Entity): { heading: string; lines: string[] } {
  if (entity.kind === "repo") {
    const github = `https://github.com/${entity.fullName}`;
    const about = userText(entity.description);
    return {
      heading: userText(entity.fullName),
      lines: [
        ...(about ? [`> ${about}`] : []),
        [
          `Public repository on GitHub: [${userText(entity.fullName)}](${github}).`,
          entity.language
            ? `Main language: ${userText(entity.language.name)}.`
            : null,
          entity.license ? `License: ${userText(entity.license)}.` : null,
          entity.isArchived ? "Archived." : null,
          entity.isFork ? "A fork." : null,
        ]
          .filter(Boolean)
          .join(" "),
      ],
    };
  }
  const github = `https://github.com/${entity.login}`;
  const name = userText(entity.name);
  const about = userText(
    entity.kind === "org" ? entity.description : entity.bio,
  );
  const kind = entity.kind === "org" ? "Organization" : "User";
  return {
    heading: name ? `${name} (@${entity.login})` : `@${entity.login}`,
    lines: [
      ...(about ? [`> ${about}`] : []),
      [
        `${kind} on GitHub: [${entity.login}](${github}).`,
        entity.location ? `Location: ${userText(entity.location)}.` : null,
        `On GitHub since ${entity.createdAt.slice(0, 4)}.`,
      ]
        .filter(Boolean)
        .join(" "),
    ],
  };
}

function numbers(entity: Entity): string {
  if (entity.kind === "repo") {
    return table([
      fact("Stars", entity.stars),
      fact("Forks", entity.forks),
      fact("Watchers", entity.watchers),
      fact("Open issues", entity.openIssues),
      fact("Open pull requests", entity.openPullRequests),
      fact("Commits on the default branch", entity.commits),
      fact("Commits in the last year", entity.activity?.total),
      fact("Contributors", entity.contributorCount),
      entity.latestRelease
        ? `| Latest release | ${userText(entity.latestRelease.tag)}${
            entity.latestRelease.publishedAt
              ? ` (${entity.latestRelease.publishedAt.slice(0, 10)})`
              : ""
          } |`
        : null,
    ]);
  }
  if (entity.kind === "org") {
    return table([
      fact("Public repositories", entity.stats.repositories),
      fact("Stars on its top repositories", entity.stats.stars),
      fact("Forks", entity.stats.forks),
      fact("Public members", entity.stats.members),
      fact("Followers", entity.stats.followers),
      fact(
        "Commits in the last year, top repositories",
        entity.activity?.total,
      ),
    ]);
  }
  const { calendar, stats, streak } = entity;
  return table([
    `| Contributions, ${calendar.from} to ${calendar.to} | ${formatNumber(calendar.total)} |`,
    fact("Current streak, days", streak.current),
    fact("Longest streak in that range, days", streak.longest),
    fact("Commits", stats.commits),
    fact("Pull requests opened", stats.pullRequests),
    fact("Issues opened", stats.issues),
    fact("Reviews", stats.reviews),
    fact("Followers", entity.followers),
    fact("Public repositories", stats.repositories),
    fact("Stars received", stats.stars),
  ]);
}

function lists(entity: Entity): string[] {
  const parts: string[] = [];
  if (entity.kind !== "repo" && entity.repos.length > 0) {
    parts.push("## Top repositories", entity.repos.map(repoLine).join("\n"));
  }
  if (entity.languages.length > 0) {
    parts.push(
      "## Languages",
      entity.languages
        .map((language) => `${userText(language.name)} ${language.percent}%`)
        .join(", "),
    );
  }
  if (entity.kind === "repo" && entity.contributors.length > 0) {
    parts.push(
      "## Top contributors",
      entity.contributors
        .slice(0, 10)
        .map(
          (person) =>
            `- [${person.login}](https://github.com/${person.login}): ${formatNumber(person.contributions)} commits`,
        )
        .join("\n"),
    );
  }
  return parts;
}

/** Title and description of a banner page, shared with its HTML twin's metadata. */
export function entityHeadline(
  entity: Entity,
  banner: BannerDescription,
): { title: string; description: string } {
  const label = targetLabel(banner.target);
  const title =
    entity.kind === "repo"
      ? `${label} GitHub banner`
      : `${entity.name?.trim() ? `${entity.name.trim()} (@${entity.login})` : `@${entity.login}`} GitHub banner`;
  return {
    title: `${title} | ${site.name}`,
    description:
      `Live banner for ${label} on GitHub, as SVG and PNG. ${banner.alt}`
        .replace(/\s+/g, " ")
        .slice(0, 300),
  };
}

/**
 * The page of a user, organization or repository as Markdown: who it is,
 * the headline numbers, the banner and how to embed it, and the image URL
 * of every preset.
 */
export function entityDocument(
  entity: Entity,
  banner: BannerDescription,
): string {
  const { target } = banner;
  const selected = banner.preset;
  const canonicalPath = bannerPath(target, { preset: selected });
  const { title, description } = entityHeadline(entity, banner);
  const who = identity(entity);
  const slug = banner.slug;
  const dataUrl =
    target.kind === "repo"
      ? absoluteUrl(`${site.api.basePath}/repos/${target.owner}/${target.name}`)
      : absoluteUrl(`${site.api.basePath}/owners/${target.login}`);
  const presets = presetsFor(entity.kind).map((preset) => {
    const links = bannerLinks({ target, preset: preset.id });
    return `| ${preset.name}${preset.id === selected ? " (this page)" : ""} | ${preset.description} | ${links.svg} |`;
  });

  const parts = [
    `# ${who.heading}`,
    ...who.lines,
    "## Numbers",
    numbers(entity),
    `Read from GitHub at ${entity.fetchedAt}.`,
    "## Banner",
    `[![${banner.alt.replace(/[[\]\r\n]+/g, " ").trim()}](${banner.links.svg})](${banner.links.page})`,
    [
      `- SVG: ${banner.links.svg}`,
      `- PNG: ${banner.links.png}`,
      `- Link preview size, 1200 by 630: ${absoluteUrl(previewImagePath(canonicalPath))}`,
      `- Without an extension (the format follows \`Accept\`): ${banner.links.embed}`,
      `- Size as drawn: ${banner.width} by ${banner.height} pixels`,
    ].join("\n"),
    "## Embed it",
    "Markdown, for a README:",
    `\`\`\`md\n${banner.snippets.markdown}\n\`\`\``,
    "HTML:",
    `\`\`\`html\n${banner.snippets.html}\n\`\`\``,
    "## Every preset",
    ["| Preset | Shows | Image |", "| --- | --- | --- |", ...presets].join(
      "\n",
    ),
    `Add options to any image URL, such as \`?theme=dracula\` or \`?size=og\`. The [docs](${absoluteUrl("/docs#parameters")}) list them all.`,
    ...lists(entity),
    "## As data",
    [
      `- JSON: ${dataUrl}`,
      `- This banner described as JSON: ${absoluteUrl(`${site.api.basePath}/banner?target=${slug}${selected === defaultPresetId(entity.kind) ? "" : `&preset=${selected}`}`)}`,
      `- On GitHub: https://github.com/${slug}`,
    ].join("\n"),
  ];

  const head = frontMatter({
    title,
    description,
    canonical: absoluteUrl(canonicalPath),
    updated: entity.fetchedAt,
  });
  return `${head}${parts.join("\n\n")}\n`;
}

/**
 * Whether the preset in a banner path exists for the kind the target turned
 * out to be. `/vercel/streak` is not a page: organizations have no streak.
 */
export function presetExists(
  kind: Entity["kind"],
  preset: ParsedBannerPath["preset"],
): boolean {
  return (
    preset === null || presetsFor(kind).some((entry) => entry.id === preset)
  );
}
