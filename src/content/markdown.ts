import { absoluteUrl } from "@/lib/site";
import type { Block, ContentPage, FaqEntry, Inline } from "./types";

/**
 * Markdown rendering of content pages: what agents get from `/{page}.md`
 * and from `Accept: text/markdown`. Links and banner images are made
 * absolute so the document stands on its own outside the site.
 */

function absolutize(text: Inline): string {
  return text.replace(
    /\]\((\/[^)\s]*)\)/g,
    (_match, path: string) => `](${absoluteUrl(path)})`,
  );
}

function cell(text: Inline): string {
  return absolutize(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** Image URL of a `banner` block: the path gets `.svg` before its query. */
export function bannerImageUrl(path: string): string {
  const [pathname, query] = path.split("?");
  return absoluteUrl(`${pathname}.svg${query ? `?${query}` : ""}`);
}

export function blockToMarkdown(block: Block): string {
  switch (block.type) {
    case "p":
      return absolutize(block.text);
    case "note":
      return `> ${absolutize(block.text)}`;
    case "list":
      return block.items
        .map(
          (item, index) =>
            `${block.ordered ? `${index + 1}.` : "-"} ${absolutize(item)}`,
        )
        .join("\n");
    case "code": {
      const fence = block.code.includes("```") ? "````" : "```";
      const caption = block.caption ? `${block.caption}\n\n` : "";
      return `${caption}${fence}${block.lang}\n${block.code}\n${fence}`;
    }
    case "table":
      return [
        `| ${block.head.map(cell).join(" | ")} |`,
        `| ${block.head.map(() => "---").join(" | ")} |`,
        ...block.rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
      ].join("\n");
    case "banner": {
      const page = absoluteUrl(block.path.split("?")[0]);
      const image = `[![${block.alt}](${bannerImageUrl(block.path)})](${page})`;
      return block.caption ? `${image}\n\n${block.caption}` : image;
    }
  }
}

export function faqToMarkdown(entries: readonly FaqEntry[]): string {
  return entries
    .map((entry) => `### ${entry.question}\n\n${absolutize(entry.answer)}`)
    .join("\n\n");
}

export interface MarkdownOptions {
  /** Extra Markdown appended after the last section (e.g. an FAQ). */
  append?: string;
}

/** The page body: h1, lead and sections. No front matter. */
export function pageToMarkdown(
  page: ContentPage,
  options: MarkdownOptions = {},
): string {
  const parts = [`# ${page.heading}`, absolutize(page.lead)];
  for (const section of page.sections) {
    parts.push(`${"#".repeat(section.level ?? 2)} ${section.title}`);
    for (const block of section.blocks) parts.push(blockToMarkdown(block));
  }
  if (options.append) parts.push(options.append);
  return `${parts.join("\n\n")}\n`;
}
