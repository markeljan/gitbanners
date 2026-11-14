import Link from "next/link";
import type { ReactNode } from "react";
import { parseInline } from "@/content/inline";
import type { Inline as InlineText } from "@/content/types";

/** Routes that are not pages: a client-side navigation to them makes no sense. */
const MACHINE = /^\/(?:api|mcp|embed|b|-|\.well-known)(?:\/|$)/;
/** Root documents and Markdown or image versions of pages. */
const FILE = /\.(?:txt|json|xml|md|svg|png|ico|webmanifest)$/i;

/** Whether `href` leads to an HTML page of this site. */
export function isPageHref(href: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  const [path] = href.split(/[?#]/);
  return !MACHINE.test(path) && !FILE.test(path);
}

function Anchor({ href, children }: { href: string; children: ReactNode }) {
  if (isPageHref(href)) return <Link href={href}>{children}</Link>;
  // Fragments, files and machine endpoints of this site, and other sites.
  const external = /^[a-z][a-z0-9+.-]*:/i.test(href);
  return (
    <a href={href} rel={external ? "noopener noreferrer" : undefined}>
      {children}
    </a>
  );
}

/**
 * Inline copy as real elements: `code`, **bold** and [links](/path). Link
 * text may itself hold code or bold. Nothing is injected as HTML.
 */
export function Inline({ text }: { text: InlineText }): ReactNode {
  return parseInline(text).map((node, index) => {
    // Static copy: the nodes of one string are never reordered.
    const key = `${index}:${node.type}`;
    switch (node.type) {
      case "code":
        return <code key={key}>{node.text}</code>;
      case "bold":
        return <strong key={key}>{node.text}</strong>;
      case "link":
        return (
          <Anchor key={key} href={node.href}>
            <Inline text={node.text} />
          </Anchor>
        );
      default:
        return node.text;
    }
  });
}
