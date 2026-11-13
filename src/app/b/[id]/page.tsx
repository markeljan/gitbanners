import "./saved-page.css";

import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import { Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  presetName,
  savedBannerAlt,
  savedImageSrc,
  savedPaths,
  targetText,
} from "@/components/account/saved-banners";
import { SavedSnippets } from "@/components/account/saved-snippets";
import { estimateBannerBox } from "@/components/banner/box";
import { ArrowUpRight, Download } from "@/components/icons";
import { Container } from "@/components/site/page";
import {
  bannerPath,
  getTheme,
  parseOptions,
  resolveOptions,
  SIZES,
} from "@/lib/banner";
import { studioPath } from "@/lib/embed";
import { site } from "@/lib/site";
import { loadSavedBanner, type PublicBanner } from "./load";

// Real 404 on the first request for an id that does not exist, and ISR for
// the ones that do (see the Next.js notes on `ensureStatic`).
export const ensureStatic = "navigation";
export const instant = false;

export async function generateStaticParams() {
  // A placeholder the id check refuses before any store access, so the build
  // needs no database. Real ids are rendered on their first request.
  return [{ id: "_" }];
}

/** What the banner shows, in words: preset, target, theme and size. */
function describe(banner: PublicBanner) {
  const options = resolveOptions(
    banner.target.kind === "repo" ? "repo" : "user",
    banner.preset,
    parseOptions(new URLSearchParams(banner.query)),
  );
  return {
    preset: presetName(banner),
    target: targetText(banner.target),
    theme: getTheme(options.theme).name,
    size: SIZES[options.size].name,
  };
}

export async function generateMetadata({
  params,
}: PageProps<"/b/[id]">): Promise<Metadata> {
  const { id } = await params;
  const banner = await loadSavedBanner(id);
  if (!banner) notFound();
  const facts = describe(banner);
  const paths = savedPaths(banner.id);
  const description = `${facts.preset} banner for ${facts.target}, saved on ${site.name}. A live image that follows the GitHub data, as SVG or PNG.`;
  const alt = savedBannerAlt(banner);
  return {
    title: banner.name,
    description,
    alternates: { canonical: paths.page },
    // A saved banner is someone's copy of a public banner page: the target's
    // own page is the one search engines should know.
    robots: { index: false, follow: true },
    openGraph: {
      type: "website",
      siteName: site.name,
      url: paths.page,
      title: `${banner.name} · ${site.name}`,
      description,
      images: [{ url: paths.png, alt }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${banner.name} · ${site.name}`,
      description,
      images: [{ url: paths.png, alt }],
    },
  };
}

/**
 * `/b/{id}`: the public page of a saved banner. No sign-in needed; the
 * images themselves are `/b/{id}.svg` and `.png` (rewritten to the image
 * route in next.config.ts, so they never reach this page).
 */
export default async function SavedBannerPage({
  params,
}: PageProps<"/b/[id]">) {
  const { id } = await params;
  const banner = await loadSavedBanner(id);
  if (!banner) notFound();
  const facts = describe(banner);
  const paths = savedPaths(banner.id);
  const box = estimateBannerBox({
    target: banner.target,
    preset: banner.preset,
    query: banner.query,
  });
  const targetPage = bannerPath(banner.target);
  return (
    <Container className="gb-saved-page">
      <header className="gb-saved-page-head">
        <Text type="supporting" color="secondary">
          Saved banner · updated{" "}
          <Timestamp
            value={banner.updatedAt}
            format="date"
            hasTooltip={false}
          />
        </Text>
        <Heading level={1}>{banner.name}</Heading>
        <Text color="secondary" as="p">
          {facts.preset} banner for{" "}
          <Link href={targetPage}>{facts.target}</Link>, in the {facts.theme}{" "}
          theme at {facts.size} size. It is drawn from live GitHub data, so it
          stays current wherever it is embedded.
        </Text>
      </header>

      <div className="gb-saved-page-image">
        {/* biome-ignore lint/performance/noImgElement: a live banner URL, already the optimised image */}
        <img
          src={savedImageSrc(banner)}
          alt={savedBannerAlt(banner)}
          width={box.width}
          height={box.height}
          fetchPriority="high"
          decoding="async"
          style={{
            aspectRatio: `${box.width} / ${box.height}`,
            maxWidth: box.width,
          }}
        />
      </div>

      <div className="gb-saved-page-cols">
        <section
          aria-labelledby="embed-heading"
          className="gb-saved-page-section"
        >
          <Heading level={2} id="embed-heading">
            Embed this banner
          </Heading>
          <Text color="secondary" as="p">
            Paste it into a README, a website or anywhere that shows images. The
            link keeps working when its owner changes the banner.
          </Text>
          <SavedSnippets banner={banner} />
        </section>
        <section
          aria-labelledby="more-heading"
          className="gb-saved-page-section"
        >
          <Heading level={2} id="more-heading">
            More from this banner
          </Heading>
          <div className="gb-saved-page-links">
            <Button
              label={`All banners for ${facts.target}`}
              href={targetPage}
              width="100%"
            />
            <Button
              label="Make your own in the studio"
              href={studioPath({
                target: banner.target,
                preset: banner.preset,
                query: banner.query,
              })}
              icon={<Icon icon={ArrowUpRight} />}
              width="100%"
            />
            <Button
              label="Download PNG"
              href={`${paths.png}?download=1`}
              as="a"
              variant="ghost"
              icon={<Icon icon={Download} />}
              width="100%"
            />
          </div>
        </section>
      </div>
    </Container>
  );
}
