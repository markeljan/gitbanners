import "./pages.css";

import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import { BannerCard } from "@/components/banner/banner-card";
import { BannerImage } from "@/components/banner/banner-image";
import { DownloadButton } from "@/components/banner/download-button";
import { sizeHint } from "@/components/banner/sizes";
import { ArrowRight } from "@/components/icons";
import { Container } from "@/components/site/page";
import { type ShowcaseItem, showcaseGroup } from "@/content/showcase";
import { type EntityKind, getTheme, SIZES, type SizeId } from "@/lib/banner";
import { site } from "@/lib/site";

/** The words of /gallery. The banners come from `SHOWCASE`. */
export const GALLERY = {
  path: "/gallery",
  title: "GitHub banner gallery: profiles, repositories and organizations",
  description:
    "The best GitHub banners in one place: profile overviews, contribution graphs, stats cards, repository social previews and organization banners, each with a live URL.",
  heading: "Banner gallery",
  lead: `Every banner here is a live image: the URL under it always draws today's numbers from GitHub. Copy one as it is, or open it in the studio and change the preset, size, theme and colours. Swap the name in any URL for your own and the banner is yours.`,
} as const;

interface GroupCopy {
  id: string;
  group: ShowcaseItem["group"];
  kind: EntityKind;
  title: string;
  text: string;
}

const GROUPS: readonly GroupCopy[] = [
  {
    id: "profiles",
    group: "profile",
    kind: "user",
    title: "Profiles",
    text: "Banners for one person. The overview is the all-rounder for a profile README; activity only is the quiet one that sits under a hand-written intro; stats, streak and languages replace the cards people used to get from github-readme-stats; the year in review is made for sharing in December.",
  },
  {
    id: "repositories",
    group: "repository",
    kind: "repo",
    title: "Repositories",
    text: "Banners for the top of a README and for the link people share. The overview carries the description, stars and the language bar, activity shows a year of commits, contributors thanks the people behind the code, and the social preview is sized to upload in the repository settings.",
  },
  {
    id: "organizations",
    group: "organization",
    kind: "org",
    title: "Organizations",
    text: "Banners for a whole team: members, public repositories and the stars they have collected, the most-starred projects, and the combined commit activity of the busiest ones. They fit an organization's profile README and a company header on X or LinkedIn.",
  },
];

const SIZE_IDS: readonly SizeId[] = ["x", "linkedin", "og", "square"];

const THEME_SAMPLES = [
  "github-light",
  "dracula",
  "tokyo-night",
  "catppuccin-latte",
] as const;

function GroupSection({ copy, first }: { copy: GroupCopy; first: boolean }) {
  const items = showcaseGroup(copy.group);
  return (
    <section className="gb-entity-section" aria-labelledby={`${copy.id}-title`}>
      <div className="gb-entity-section-head">
        <Heading level={2} id={`${copy.id}-title`} className="gb-h2">
          {copy.title}
        </Heading>
        <Text as="p" color="secondary">
          {copy.text}
        </Text>
      </div>
      <div className="gb-entity-grid">
        {items.map((item, index) => (
          <div
            key={item.id}
            id={item.id}
            className={item.shape === "card" ? undefined : "gb-gallery-wide"}
          >
            <BannerCard
              path={item.path}
              alt={item.alt}
              title={item.title}
              blurb={item.blurb}
              kind={copy.kind}
              titleAs="h3"
              hasPath
              // The first row is above the fold on a laptop.
              priority={first && index < 2}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * /gallery: the showcase, grouped as profiles, repositories and
 * organizations, then the example profile at every social size and in a
 * few themes. Server-rendered images with reserved boxes; only the copy
 * buttons hydrate.
 */
export function Gallery() {
  const login = site.exampleLogin;
  const target = { kind: "owner", login } as const;
  return (
    <Container className="gb-gallery">
      <div className="gb-gallery-head">
        <Heading level={1} className="gb-display">
          {GALLERY.heading}
        </Heading>
        <Text as="p" color="secondary" className="gb-lead">
          {GALLERY.lead}
        </Text>
      </div>

      {GROUPS.map((copy, index) => (
        <GroupSection key={copy.id} copy={copy} first={index === 0} />
      ))}

      <section className="gb-entity-section" aria-labelledby="sizes-title">
        <div className="gb-entity-section-head">
          <Heading level={2} id="sizes-title" className="gb-h2">
            Sizes
          </Heading>
          <Text as="p" color="secondary">
            Every banner comes in six canvases. README cards follow their
            content; the others are fixed to what each site expects, and keep
            their numbers clear of the spot where X and LinkedIn put your
            profile photo. Add <code className="gb-code-inline">?size=</code> to
            any URL. Here is @{login} at four of them.
          </Text>
        </div>
        <div className="gb-entity-sizes">
          {SIZE_IDS.map((id) => (
            <figure key={id} className="gb-entity-size">
              <BannerImage
                path={`/${login}?size=${id}`}
                alt={`${SIZES[id].name} banner for ${login}`}
                kind="user"
                width={SIZES[id].width}
                height={SIZES[id].height ?? undefined}
              />
              <figcaption>
                <Heading level={3} className="gb-card-title">
                  {SIZES[id].name}, {SIZES[id].width} ×{" "}
                  {SIZES[id].height ?? "auto"}
                </Heading>
                <p className="gb-card-blurb">{sizeHint(id)}</p>
                <div className="gb-card-actions">
                  <DownloadButton
                    target={target}
                    query={`size=${id}`}
                    size="sm"
                    label={`Download ${SIZES[id].name} PNG`}
                  />
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="gb-entity-section" aria-labelledby="themes-title">
        <div className="gb-entity-section-head">
          <Heading level={2} id="themes-title" className="gb-h2">
            Themes
          </Heading>
          <Text as="p" color="secondary">
            The default is GitHub&apos;s own dark theme. Twenty-three more
            follow GitHub&apos;s light and dimmed modes and the editor themes
            people already use, and every colour can be set in the URL. The same
            activity banner in four of them:
          </Text>
        </div>
        <div className="gb-gallery-themes">
          {THEME_SAMPLES.map((id) => {
            const theme = getTheme(id);
            return (
              <BannerCard
                key={id}
                path={`/${login}/activity?theme=${id}`}
                alt={`Contribution graph banner for ${login} in the ${theme.name} theme`}
                title={theme.name}
                blurb={`A ${theme.mode} theme. Add ?theme=${id} to any banner URL.`}
                kind="user"
                titleAs="h3"
              />
            );
          })}
        </div>
        <div>
          <Button
            label="Browse all 24 themes"
            href="/themes"
            endContent={<Icon icon={ArrowRight} size="sm" />}
          />
        </div>
      </section>
    </Container>
  );
}
