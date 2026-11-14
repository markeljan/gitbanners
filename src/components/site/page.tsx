import type { ReactNode } from "react";

/**
 * Page layout conventions. Every page is rendered inside the root layout's
 * `<main id="main">`, below the sticky header and above the footer, and
 * builds its body from these two pieces so gutters and widths line up across
 * the site:
 *
 * ```tsx
 * export default function Page() {
 *   return (
 *     <Container className="py-12">
 *       <Heading level={1}>Pricing</Heading>
 *       …
 *     </Container>
 *   );
 * }
 * ```
 *
 * - The page's `<h1>` is the first heading in the document (the header and
 *   footer render none). Heading levels never skip.
 * - Anchors need no offset of their own: `html` has a `scroll-padding-top`
 *   that clears the sticky header.
 */
export interface ContainerProps {
  /**
   * `page` (default): 72rem, for layouts with columns, galleries and tools.
   * `prose`: 44rem, for long-form text such as docs and legal pages.
   */
  width?: "page" | "prose";
  /** Element to render. Use `section` for a region with a heading. */
  as?: "div" | "section" | "article";
  id?: string;
  className?: string;
  /** Names a `section` for assistive technology: the id of its heading. */
  "aria-labelledby"?: string;
  children: ReactNode;
}

/** Centred column with the site's gutters (16px, 24px from 640px up). */
export function Container({
  width = "page",
  as: Tag = "div",
  className,
  children,
  ...rest
}: ContainerProps) {
  const classes = ["gb-container"];
  if (width === "prose") classes.push("gb-container-narrow");
  if (className) classes.push(className);
  return (
    <Tag className={classes.join(" ")} {...rest}>
      {children}
    </Tag>
  );
}
