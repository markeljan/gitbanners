import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import { BannerCard } from "@/components/banner/banner-card";
import { BannerImage } from "@/components/banner/banner-image";
import { ArrowRight } from "@/components/icons";
import { FAQ } from "@/content/faq";
import { home } from "@/content/home";
import { plainInline } from "@/content/inline";
import { type ShowcaseItem, showcaseGroup } from "@/content/showcase";
import type { Section } from "@/content/types";
import type { EntityKind, SizeId } from "@/lib/banner";
import { site } from "@/lib/site";
import { Inline } from "./inline";
import { ReadmeSnippets } from "./readme-snippets";
import { blockOf, blocksOf, ContentTable, HomeSection } from "./section";
import { ThemesPlayground } from "./themes-playground";

/**
 * The homepage below the hero. Every section takes its words from
 * `src/content/home.ts` (the Markdown version of the page is rendered from
 * the same object) and adds the pictures and controls.
 */

function section(id: string): Section {
  const found = home.sections.find((item) => item.id === id);
  if (!found) throw new Error(`Homepage copy has no section "${id}"`);
  return found;
}

function lead(id: string): string {
  return blockOf(section(id), "p").text;
}

function ActionLink({ href, label }: { href: string; label: string }) {
  return (
    <div>
      <Button
        label={label}
        href={href}
        endContent={<Icon icon={ArrowRight} size="sm" />}
      />
    </div>
  );
}

/** "One URL that stays current": the URL grammar as a table. */
export function UrlPatterns() {
  const copy = section("one-url");
  return (
    <HomeSection
      id={copy.id}
      title={copy.title}
      lead={lead(copy.id)}
      layout="split"
    >
      <ContentTable
        block={blockOf(copy, "table")}
        caption="Banner URL patterns"
      />
    </HomeSection>
  );
}

const GROUPS: readonly {
  id: string;
  group: ShowcaseItem["group"];
  kind: EntityKind;
}[] = [
  { id: "profiles", group: "profile", kind: "user" },
  { id: "repositories", group: "repository", kind: "repo" },
  { id: "organizations", group: "organization", kind: "org" },
];

/** "Banners for people, projects and teams": the showcase, group by group. */
export function Showcase() {
  const copy = section("banners");
  return (
    <HomeSection
      id={copy.id}
      title={copy.title}
      lead={lead(copy.id)}
      aside={<ActionLink href="/gallery" label="Open the gallery" />}
    >
      {GROUPS.map(({ id, group, kind }) => {
        const part = section(id);
        return (
          <section
            key={id}
            id={id}
            className="gb-showcase"
            aria-labelledby={`${id}-title`}
          >
            <div className="gb-showcase-head">
              <Heading level={3} id={`${id}-title`} className="gb-h3">
                {part.title}
              </Heading>
              <Text as="p" color="secondary">
                <Inline text={lead(id)} />
              </Text>
            </div>
            <div className="gb-showcase-grid">
              {showcaseGroup(group).map((item) => (
                <BannerCard
                  key={item.id}
                  path={item.path}
                  alt={item.alt}
                  title={item.title}
                  blurb={item.blurb}
                  kind={kind}
                  titleAs="h4"
                  hasPath
                  hasActions={false}
                />
              ))}
            </div>
          </section>
        );
      })}
    </HomeSection>
  );
}

/** Pairs whose aspect ratios add up to about the same, so each row is one height. */
const SIZE_ROWS: readonly (readonly SizeId[])[] = [
  ["readme", "og"],
  ["x", "social"],
  ["linkedin", "square"],
];

/** "Sized for where you post": the example profile at every size, in true proportion. */
export function Sizes() {
  const copy = section("sizes");
  const rows = blockOf(copy, "table").rows;
  // Each content row ends in its parameter, e.g. `size=x`.
  const captionOf = (id: SizeId) => {
    const row = rows.find((cells) => cells[2]?.includes(`size=${id}`));
    if (!row) throw new Error(`Homepage copy has no size row for "${id}"`);
    return { name: row[0], pixels: row[1], parameter: row[2] };
  };
  return (
    <HomeSection id={copy.id} title={copy.title} lead={lead(copy.id)}>
      <div className="gb-sizes">
        {SIZE_ROWS.map((row) => (
          <div key={row.join("-")} className="gb-size-row">
            {row.map((id) => {
              const caption = captionOf(id);
              const path =
                id === "readme"
                  ? `/${site.exampleLogin}`
                  : `/${site.exampleLogin}?size=${id}`;
              return (
                <SizeFigure
                  key={id}
                  path={path}
                  name={caption.name}
                  pixels={caption.pixels}
                  parameter={caption.parameter}
                />
              );
            })}
          </div>
        ))}
      </div>
    </HomeSection>
  );
}

function SizeFigure({
  path,
  name,
  pixels,
  parameter,
}: {
  path: string;
  name: string;
  pixels: string;
  parameter: string;
}) {
  return (
    <figure className="gb-size" data-size={plainInline(parameter)}>
      <BannerImage
        path={path}
        alt={`${name} banner for ${site.exampleLogin}`}
        kind="user"
      />
      <figcaption>
        <b>{name}</b>
        <span>{pixels}</span>
        <Inline text={parameter} />
      </figcaption>
    </figure>
  );
}

/** "Themes that match GitHub and your editor": swatches that re-theme the page's banner. */
export function Themes() {
  const copy = section("themes");
  return (
    <HomeSection id={copy.id} title={copy.title} lead={lead(copy.id)}>
      <ThemesPlayground />
      {blocksOf(copy, "code").map((block) => (
        <pre key={block.code} className="gb-code gb-themes-code">
          <code>{block.code}</code>
        </pre>
      ))}
    </HomeSection>
  );
}

/** "Paste it into your README": the snippets of the banner in the hero. */
export function Readme() {
  const copy = section("readme");
  return (
    <HomeSection
      id={copy.id}
      title={copy.title}
      lead={lead(copy.id)}
      layout="split"
    >
      <ReadmeSnippets />
    </HomeSection>
  );
}

/** "Replace the cards that stopped loading": a pointer to the README doctor. */
export function Migrate() {
  const copy = section("migrate");
  return (
    <HomeSection
      id={copy.id}
      title={copy.title}
      lead={lead(copy.id)}
      aside={<ActionLink href="/docs/migrate" label="Open the README doctor" />}
    />
  );
}

/** "Free for public data. Pro for a star.": the plan table. */
export function Pricing() {
  const copy = section("pricing");
  return (
    <HomeSection
      id={copy.id}
      title={copy.title}
      lead={lead(copy.id)}
      layout="split"
    >
      <ContentTable
        block={blockOf(copy, "table")}
        caption="Free and Pro compared"
        variant="plans"
      />
    </HomeSection>
  );
}

/** "Works for agents": what machines can read here. */
export function Agents() {
  const copy = section("agents");
  return (
    <HomeSection
      id={copy.id}
      title={copy.title}
      lead={lead(copy.id)}
      layout="split"
    >
      <ul className="gb-rows">
        {blockOf(copy, "list").items.map((item) => (
          <li key={item}>
            <Inline text={item} />
          </li>
        ))}
      </ul>
    </HomeSection>
  );
}

/** "Questions": every answer in the HTML, nothing folded away. */
export function Faq() {
  return (
    <HomeSection id="faq" title="Questions">
      <div className="gb-faq">
        {FAQ.map((entry) => (
          <div key={entry.id} id={entry.id}>
            <Heading level={3} className="gb-h3">
              {entry.question}
            </Heading>
            <Text as="p" color="secondary">
              <Inline text={entry.answer} />
            </Text>
          </div>
        ))}
      </div>
    </HomeSection>
  );
}
