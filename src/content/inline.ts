import type { Inline } from "./types";

/**
 * The inline subset content is written in: `code`, **bold** and
 * [text](href). Parsed into nodes so components can render real elements
 * without `dangerouslySetInnerHTML`.
 */
export type InlineNode =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "bold"; text: string }
  | { type: "link"; text: string; href: string };

const TOKEN = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(input: Inline): InlineNode[] {
  const nodes: InlineNode[] = [];
  let last = 0;
  for (const match of input.matchAll(TOKEN)) {
    const at = match.index;
    if (at > last) nodes.push({ type: "text", text: input.slice(last, at) });
    if (match[1] !== undefined) nodes.push({ type: "code", text: match[1] });
    else if (match[2] !== undefined) {
      nodes.push({ type: "bold", text: match[2] });
    } else nodes.push({ type: "link", text: match[3], href: match[4] });
    last = at + match[0].length;
  }
  if (last < input.length) {
    nodes.push({ type: "text", text: input.slice(last) });
  }
  return nodes;
}

/** The text a reader sees, without markup: for meta descriptions and JSON-LD. */
export function plainInline(input: Inline): string {
  return parseInline(input)
    .map((node) => node.text)
    .join("");
}
