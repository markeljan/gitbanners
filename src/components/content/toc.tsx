import type { Section } from "@/content/types";

interface TocEntry {
  section: Section;
  children: Section[];
}

/** Level-2 sections with the level-3 sections that follow each of them. */
function outline(sections: readonly Section[]): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const section of sections) {
    const parent = entries.at(-1);
    if ((section.level ?? 2) === 3 && parent) parent.children.push(section);
    else entries.push({ section, children: [] });
  }
  return entries;
}

/**
 * "On this page": a sticky column beside the text on wide screens, a box of
 * the top-level sections above it on narrow ones (see `content.css`). The
 * label is not a heading, so the page's heading order stays h1, h2, h3.
 */
export function TableOfContents({
  sections,
}: {
  sections: readonly Section[];
}) {
  return (
    <nav className="gb-toc" aria-label="On this page">
      <p className="gb-toc-label">On this page</p>
      <ul>
        {outline(sections).map(({ section, children }) => (
          <li key={section.id}>
            <a href={`#${section.id}`}>{section.title}</a>
            {children.length > 0 ? (
              <ul>
                {children.map((child) => (
                  <li key={child.id}>
                    <a href={`#${child.id}`}>{child.title}</a>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </nav>
  );
}
