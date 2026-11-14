import Link from "next/link";
import { isPageHref } from "@/components/site/links";
import { parseInline } from "@/content/inline";

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
