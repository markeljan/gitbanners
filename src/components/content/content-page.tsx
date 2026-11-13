import "./content.css";

import { Heading } from "@astryxdesign/core/Heading";
import type { ReactNode } from "react";
import { FAQ_HEADING } from "@/content/faq";
import { longDate } from "@/content/format";
import type { ContentPage, FaqEntry, Section } from "@/content/types";
import { markdownPath } from "@/lib/agent/metadata";
import { BlockView } from "./blocks";
import { Inline } from "./inline";
import { TableOfContents } from "./toc";

/** The FAQ as a section: its anchor id and heading. */
const FAQ_SECTION = { id: "faq", title: FAQ_HEADING } as const;

export interface ContentPageViewProps {
  /** The copy to render. Its Markdown twin is built from the same object. */
  page: ContentPage;
  /**
   * Questions rendered as a last section, each as an h3 with its answer in
   * the HTML (no disclosure widget: the answers must be readable without
   * JavaScript).
   */
  faq?: readonly FaqEntry[];
  /**
   * Show "On this page": a sticky column on wide screens. Default: pages
   * with six or more top-level sections.
   */
  toc?: boolean;
  /** Rendered between the lead and the first section. */
  children?: ReactNode;
  /**
   * Extra content by section id, rendered after that section's blocks: an
   * interactive tool that belongs to one section. HTML only, so put what an
   * agent needs to know in the section's blocks as well.
   */
  slots?: Readonly<Record<string, ReactNode>>;
  /**
   * Make each section heading a link to itself, so a reader can copy the
   * address of a section (`DocsEnhancer` copies it on click).
   */
  headingLinks?: boolean;
  /**
   * Let `children` use the full width of the page, for a tool. The h1, the
   * lead and the sections keep the reading measure.
   */
  wide?: boolean;
}

function SectionView({
  section,
  slot,
  headingLink,
}: {
  section: Section;
  slot?: ReactNode;
  headingLink: boolean;
}) {
  return (
    <>
      <Heading level={section.level ?? 2} id={section.id}>
        {headingLink ? (
          <a className="gb-anchor" href={`#${section.id}`}>
            {section.title}
          </a>
        ) : (
          section.title
        )}
      </Heading>
      {section.blocks.map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks of static copy, never reordered
        <BlockView key={index} block={block} />
      ))}
      {slot}
    </>
  );
}

/**
 * A content page: its h1, lead, sections and optional FAQ, with a table of
 * contents for long pages. A Server Component that renders the page's main
 * content only; the site frame (header, `<main>`, footer) belongs to the
 * layout. The h1 is the first heading it renders and levels never skip, as
 * long as the page's sections do not.
 */
export function ContentPageView({
  page,
  faq,
  toc,
  children,
  slots,
  headingLinks = false,
  wide = false,
}: ContentPageViewProps) {
  const sections: Section[] = faq
    ? [...page.sections, { ...FAQ_SECTION, blocks: [] }]
    : [...page.sections];
  const topLevel = sections.filter((section) => (section.level ?? 2) === 2);
  const showToc = toc ?? topLevel.length >= 6;

  return (
    <div
      className="gb-page"
      data-toc={showToc ? "" : undefined}
      data-wide={wide ? "" : undefined}
    >
      <article className="gb-article">
        <div className="gb-head">
          <Heading level={1} type="display-3" textWrap="balance">
            {page.heading}
          </Heading>
          <p className="gb-lead">
            <Inline text={page.lead} />
          </p>
        </div>
        {showToc ? <TableOfContents sections={sections} /> : null}
        <div className="gb-body">
          {wide && children ? (
            <div className="gb-wide">{children}</div>
          ) : (
            children
          )}
          {page.sections.map((section) => (
            <SectionView
              key={section.id}
              section={section}
              slot={slots?.[section.id]}
              headingLink={headingLinks}
            />
          ))}
          {faq ? (
            <>
              <Heading level={2} id={FAQ_SECTION.id}>
                {FAQ_SECTION.title}
              </Heading>
              {faq.map((entry) => (
                <section key={entry.id} aria-labelledby={entry.id}>
                  <Heading level={3} id={entry.id}>
                    {entry.question}
                  </Heading>
                  <p>
                    <Inline text={entry.answer} />
                  </p>
                </section>
              ))}
            </>
          ) : null}
          <p className="gb-meta">
            Updated{" "}
            <time dateTime={page.updated}>{longDate(page.updated)}</time>
            {". "}
            <a href={markdownPath(page.path)}>Read this page as Markdown</a>.
          </p>
        </div>
      </article>
    </div>
  );
}
