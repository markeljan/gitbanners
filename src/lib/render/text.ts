import { cloneElement, type ReactElement, type ReactNode } from "react";
import { drawableText, fontsForText } from "./fallback-fonts";
import type { BannerFont } from "./fonts";

function elementText(node: ReactNode, out: string[]): void {
  if (typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const child of node) elementText(child, out);
  } else if (node && typeof node === "object" && "props" in node) {
    elementText(
      (node as ReactElement<{ children?: ReactNode }>).props.children,
      out,
    );
  }
}

/**
 * The same tree with every string passed through `map`. Elements are cloned
 * only where a string below them changed.
 */
function mapElementText(
  node: ReactNode,
  map: (text: string) => string,
): ReactNode {
  if (typeof node === "string") return map(node);
  if (Array.isArray(node)) {
    const children = node.map((child) => mapElementText(child, map));
    return children.every((child, i) => child === node[i]) ? node : children;
  }
  if (node && typeof node === "object" && "props" in node) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    const children = mapElementText(element.props.children, map);
    return children === element.props.children
      ? element
      : cloneElement(element, { children });
  }
  return node;
}

/**
 * Gets an element ready to render: the fallback fonts its text needs, and the
 * element itself with every character no font covers removed. Drawn, such a
 * character would come out as Mona Sans's `.notdef` glyph, the Invertocat.
 * Never rejects for want of a font; the element is returned unchanged when
 * every character can be drawn.
 */
export async function prepareText(
  element: ReactElement,
): Promise<{ element: ReactElement; fonts: BannerFont[] }> {
  const strings: string[] = [];
  elementText(element, strings);
  const { fonts, missing } = await fontsForText(strings.join("\n"));
  if (missing.size === 0) return { element, fonts };
  return {
    element: mapElementText(element, (text) =>
      drawableText(text, missing),
    ) as ReactElement,
    fonts,
  };
}
