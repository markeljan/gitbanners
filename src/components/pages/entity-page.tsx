import "./pages.css";

import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import Link from "next/link";
import { sizeHint } from "@/components/banner/sizes";
import { JsonLd } from "@/components/content/json-ld";
import { Container } from "@/components/site/page";
import { entityJsonLd } from "@/lib/agent/jsonld";
import { markdownPath } from "@/lib/agent/metadata";
import { bannerPath, resolveOptions, targetOf } from "@/lib/banner";
import { studioPath } from "@/lib/embed";
import type { Entity } from "@/lib/github/schema";
import { site } from "@/lib/site";
import {
  displayName,
  entityLabel,
  githubUrl,
  kindLabel,
  pageDescription,
  pageTitle,
  summary,
} from "./copy";
import { Facts } from "./facts";
import type { LoadedPage } from "./load";
import { OwnerHint } from "./owner-hint";
import { PageThemeProvider } from "./page-theme";
import {
  CopyImageUrl,
  DownloadSize,
  MainActions,
  MainBanner,
  Snippets,
  ThemedImage,
  ThemeRow,
} from "./themed";
import { presetViews, sizeViews } from "./views";

function avatarOf(entity: Entity): string {
  return entity.kind === "repo" ? entity.owner.avatarUrl : entity.avatarUrl;
}

function ownerLoginOf(entity: Entity): string {
  return entity.kind === "repo" ? entity.owner.login : entity.login;
}

/** Home › vercel › next.js, as links. The same trail is in the JSON-LD. */
function Breadcrumbs({ entity }: { entity: Entity }) {
  const owner = ownerLoginOf(entity);
  return (
    <nav aria-label="Breadcrumb" className="gb-crumbs">
      <ol>
        <li>
          <Link href="/" className="gb-link">
            {site.name}
          </Link>
        </li>
        {entity.kind === "repo" ? (
          <>
            <li>
              <Link
                href={bannerPath({ kind: "owner", login: owner })}
                prefetch={false}
                className="gb-link"
              >
                {owner}
              </Link>
            </li>
            <li aria-current="page">{entity.name}</li>
          </>
        ) : (
          <li aria-current="page">{entity.login}</li>
        )}
      </ol>
    </nav>
  );
}

function Header({ entity }: { entity: Entity }) {
  const status = [
    kindLabel(entity),
    entity.kind === "org" && entity.isVerified ? "verified" : null,
    entity.kind === "repo" && entity.isArchived ? "archived" : null,
    entity.kind === "repo" && entity.isFork ? "fork" : null,
  ]
    .filter(Boolean)
    .join(", ");
  const website =
    entity.kind === "repo" ? entity.homepageUrl : entity.websiteUrl;
  return (
    <header className="gb-entity-head">
      {/* biome-ignore lint/performance/noImgElement: GitHub's avatar CDN already resizes */}
      <img
        src={avatarOf(entity)}
        alt=""
        width={64}
        height={64}
        className="gb-entity-avatar"
        data-kind={entity.kind === "user" ? "user" : "org"}
      />
      <div className="gb-entity-intro">
        <Text type="label" color="secondary" as="p">
          {status} on GitHub
        </Text>
        <Heading level={1} className="gb-display gb-entity-title">
          {entity.kind === "repo" ? (
            entity.fullName
          ) : (
            <>
              {displayName(entity)}
              {entity.name?.trim() ? (
                <span className="gb-entity-login"> @{entity.login}</span>
              ) : null}
            </>
          )}
        </Heading>
        {entity.kind !== "repo" &&
        (entity.kind === "org" ? entity.description : entity.bio) ? (
          <Text as="p" color="secondary" className="gb-entity-bio">
            {entity.kind === "org" ? entity.description : entity.bio}
          </Text>
        ) : null}
        {entity.kind === "repo" && entity.description ? (
          <Text as="p" color="secondary" className="gb-entity-bio">
            {entity.description}
          </Text>
        ) : null}
        <p className="gb-lead gb-entity-summary">{summary(entity)}</p>
        <ul className="gb-entity-links">
          <li>
            <a href={githubUrl(entity)} className="gb-link" rel="noopener">
              {entity.kind === "repo"
                ? "Repository on GitHub"
                : "Profile on GitHub"}
            </a>
          </li>
          {entity.kind === "repo" ? (
            <li>
              <Link
                href={bannerPath({ kind: "owner", login: entity.owner.login })}
                prefetch={false}
                className="gb-link"
              >
                Banners for {entity.owner.login}
              </Link>
            </li>
          ) : null}
          {website ? (
            <li>
              <a href={website} className="gb-link" rel="nofollow noopener">
                {website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </a>
            </li>
          ) : null}
        </ul>
      </div>
    </header>
  );
}

/**
 * The page of a GitHub user, organization or repository: the banner of the
 * selected preset with everything needed to use it, every other preset, the
 * selected one at the social sizes, and the facts behind them.
 *
 * A Server Component; the theme row, the copy buttons and the snippets are
 * client islands that share the page theme. Every banner is in the server
 * HTML as an image in the default theme, with its exact box reserved.
 */
export function EntityPage({ page }: { page: LoadedPage }) {
  const { entity, preset, path } = page;
  const target = targetOf(entity);
  const host = new URL(site.url).host;
  const views = presetViews(entity, host);
  const main = views.find((view) => view.presetId === preset.id) ?? views[0];
  const others = views.filter((view) => view.presetId !== preset.id);
  const sizes = sizeViews(entity, preset, host);
  const isReadme = resolveOptions(entity.kind, preset.id).size === "readme";
  const label = entityLabel(entity);
  const jsonLd = entityJsonLd(entity, {
    title: pageTitle(entity, preset),
    description: pageDescription(entity, preset),
    preset: preset.id,
  });

  return (
    <PageThemeProvider>
      <JsonLd data={jsonLd} />
      <Container className="gb-entity">
        <Breadcrumbs entity={entity} />
        <Header entity={entity} />
        <OwnerHint
          login={ownerLoginOf(entity)}
          studio={studioPath({ target, preset: preset.id })}
        />

        <section className="gb-entity-section" aria-labelledby="banner-title">
          <div className="gb-entity-section-head">
            <Heading level={2} id="banner-title" className="gb-h2">
              {preset.name} banner
            </Heading>
            <Text as="p" color="secondary">
              {main.description} Embed it by URL and it stays current: the image
              follows {displayName(entity)} on GitHub.
            </Text>
          </div>
          <MainBanner target={target} kind={entity.kind} view={main} />
          <div className="gb-entity-tools">
            <div className="gb-entity-themes">
              <Text as="p" type="label">
                Theme
              </Text>
              <ThemeRow />
            </div>
            <MainActions target={target} view={main} />
            <Snippets
              target={target}
              view={main}
              width={isReadme ? null : main.width}
            />
          </div>
        </section>

        <section className="gb-entity-section" aria-labelledby="presets-title">
          <div className="gb-entity-section-head">
            <Heading level={2} id="presets-title" className="gb-h2">
              Every banner for {label}
            </Heading>
            <Text as="p" color="secondary">
              The same data, arranged {others.length} other ways. Each one has
              its own page and its own image URL.
            </Text>
          </div>
          <div className="gb-entity-grid">
            {others.map((view) => (
              <article key={view.presetId} className="gb-card">
                <Link
                  href={view.page}
                  prefetch={false}
                  className="gb-banner-link"
                  aria-label={`${view.name} banner page`}
                >
                  <ThemedImage view={view} />
                </Link>
                <div className="gb-card-body">
                  <div className="gb-card-text">
                    <Heading level={3} className="gb-card-title">
                      <Link
                        href={view.page}
                        prefetch={false}
                        className="gb-link"
                      >
                        {view.name}
                      </Link>
                    </Heading>
                    <p className="gb-card-blurb">{view.description}</p>
                    <code className="gb-card-path">{view.src}</code>
                  </div>
                  <div className="gb-card-actions">
                    <CopyImageUrl view={view} label="Copy URL" />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="gb-entity-section" aria-labelledby="sizes-title">
          <div className="gb-entity-section-head">
            <Heading level={2} id="sizes-title" className="gb-h2">
              {preset.name} banner in other sizes
            </Heading>
            <Text as="p" color="secondary">
              Headers on X and LinkedIn and a repository's social preview are
              uploads, not links: download a fresh PNG whenever you want them to
              catch up. Link previews take the PNG URL as it is.
            </Text>
          </div>
          <div className="gb-entity-sizes">
            {sizes.map((view) => (
              <figure key={view.sizeId} className="gb-entity-size">
                <ThemedImage view={view} />
                <figcaption>
                  <Heading level={3} className="gb-card-title">
                    {view.sizeName}, {view.width} × {view.height}
                  </Heading>
                  <p className="gb-card-blurb">{sizeHint(view.sizeId)}</p>
                  <div className="gb-card-actions">
                    <DownloadSize target={target} view={view} />
                    <CopyImageUrl view={view} label="Copy URL" />
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="gb-entity-section" aria-labelledby="facts-title">
          <div className="gb-entity-section-head">
            <Heading level={2} id="facts-title" className="gb-h2">
              {entity.kind === "repo"
                ? `About ${entity.fullName}`
                : `About ${label} on GitHub`}
            </Heading>
          </div>
          <Facts entity={entity} />
          <p className="gb-entity-note">
            <a href={markdownPath(path)} className="gb-link">
              Read this page as Markdown
            </a>
            , or get the data as{" "}
            <a
              href={
                entity.kind === "repo"
                  ? `${site.api.basePath}/repos/${entity.fullName}`
                  : `${site.api.basePath}/owners/${entity.login}`
              }
              className="gb-link"
            >
              JSON
            </a>
            .
          </p>
        </section>
      </Container>
    </PageThemeProvider>
  );
}
