import Link from "next/link";
import { parseInline } from "@/content/inline";

/**
 * True for a site-relative link to a page. Files and machine endpoints
 * (`/openapi.json`, `/llms.txt`, `/mcp`, `/api/…`) are not pages: they get a
 * plain anchor, because there is nothing for the router to prefetch or render.
 */
export function isPageHref(href: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  const [path] = href.split(/[?#]/);
  if (/^\/(?:api|mcp|embed)(?:\/|$)/.test(path)) return false;
  return !/\.[a-z0-9]+$/i.test(path);
}

/**
 * Renders the inline Markdown subset page copy is written in (`code`,
 * **bold**, [links](/path)) as real elements.
 */
export function Inline({ text }: { text: string }) {
  return parseInline(text).map((node, at) => {
    // The nodes of one piece of copy never reorder: position is identity.
    const key = `${at}:${node.type}`;
    switch (node.type) {
      case "code":
        return (
          <code key={key} className="gb-code-inline">
            {node.text}
          </code>
        );
      case "bold":
        return <strong key={key}>{node.text}</strong>;
      case "link":
        if (isPageHref(node.href)) {
          return (
            <Link key={key} href={node.href} className="gb-link">
              {node.text}
            </Link>
          );
        }
        return (
          <a
            key={key}
            href={node.href}
            className="gb-link"
            {...(node.href.startsWith("/")
              ? null
              : { target: "_blank", rel: "noreferrer" })}
          >
            {node.text}
          </a>
        );
      default:
        return node.text;
    }
  });
}
