import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import type { ReactNode } from "react";
import type { Block, Section } from "@/content/types";
import { Inline } from "./inline";

/** The first block of a kind in a content section. Missing copy is a build error, not a blank. */
export function blockOf<T extends Block["type"]>(
  section: Section,
  type: T,
): Extract<Block, { type: T }> {
  const block = section.blocks.find((item) => item.type === type);
  if (!block) {
    throw new Error(`Section "${section.id}" has no ${type} block`);
  }
  return block as Extract<Block, { type: T }>;
}

export function blocksOf<T extends Block["type"]>(
  section: Section,
  type: T,
): Extract<Block, { type: T }>[] {
  return section.blocks.filter(
    (item): item is Extract<Block, { type: T }> => item.type === type,
  );
}

export interface HomeSectionProps {
  /** Anchor id from the content: `/#sizes` scrolls here. */
  id: string;
  title: string;
  /** The paragraph under the title, in the inline Markdown subset. */
  lead?: string;
  /**
   * `stack`: title and lead above the content. `split`: title and lead in a
   * column beside the content from 1024px up.
   */
  layout?: "stack" | "split";
  /** Extra content under the lead, inside the heading column. */
  aside?: ReactNode;
  children?: ReactNode;
}

/** One `<h2>` region of the homepage, with the shared rhythm and rule. */
export function HomeSection({
  id,
  title,
  lead,
  layout = "stack",
  aside,
  children,
}: HomeSectionProps) {
  return (
    <section id={id} className="gb-section" aria-labelledby={`${id}-title`}>
      <div
        className={
          layout === "split"
            ? "gb-container gb-section-inner gb-split"
            : "gb-container gb-section-inner"
        }
      >
        <div className="gb-section-head">
          <Heading level={2} id={`${id}-title`} className="gb-h2">
            {title}
          </Heading>
          {lead ? (
            <Text as="p" color="secondary" className="gb-lead">
              <Inline text={lead} />
            </Text>
          ) : null}
          {aside}
        </div>
        {children ? <div className="gb-section-body">{children}</div> : null}
      </div>
    </section>
  );
}

/**
 * A content table. The first column is the row header, which is how both
 * tables on the homepage read ("this URL gives…", "this feature is…").
 */
export function ContentTable({
  block,
  caption,
  variant,
}: {
  block: Extract<Block, { type: "table" }>;
  /** Names the table for assistive technology. Visually hidden. */
  caption: string;
  /** `plans` centres the value columns under their plan names. */
  variant?: "plans";
}) {
  return (
    <div className="gb-table-wrap">
      <table className="gb-table" data-variant={variant}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {block.head.map((cell, at) => (
              <th key={cell || `column-${at}`} scope="col">
                {cell || <span className="sr-only">Feature</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, at) =>
                at === 0 ? (
                  <th key={cell} scope="row">
                    <Inline text={cell} />
                  </th>
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: columns of a static table never reorder
                  <td key={at}>
                    <Inline text={cell} />
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
