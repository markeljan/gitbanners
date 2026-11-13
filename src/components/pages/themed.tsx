"use client";

import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { NoPrefetchLink } from "@/components/app-link";
import { CopyButton } from "@/components/banner/copy-button";
import { DownloadButton } from "@/components/banner/download-button";
import { EmbedSnippets } from "@/components/banner/embed-snippets";
import { preloadBannerFonts } from "@/components/banner/fonts";
import { ThemePicker } from "@/components/banner/theme-picker";
import { ArrowUpRight } from "@/components/icons";
import { useSiteOrigin } from "@/components/providers";
import { useEntity } from "@/hooks/use-entity";
import {
  type BannerTarget,
  DEFAULT_THEME_ID,
  type EntityKind,
  resolveOptions,
} from "@/lib/banner";
import { studioPath } from "@/lib/embed";
import { usePageTheme } from "./page-theme";
import { joinQuery, withTheme } from "./theme-query";
import type { BannerView } from "./views";

// The live canvas is only needed once the visitor picks a theme: its code
// (the whole banner engine) stays out of the page's first download.
const BannerCanvas = dynamic(
  () => import("@/components/banner/banner-canvas").then((m) => m.BannerCanvas),
  { ssr: false },
);

interface ImageProps {
  view: BannerView;
  /** Load now with high priority: the banner the page is about. */
  priority?: boolean;
}

/** A banner of the page as an `<img>` in the page theme, in a fixed box. */
export function ThemedImage({ view, priority = false }: ImageProps) {
  const { theme } = usePageTheme();
  return (
    // biome-ignore lint/performance/noImgElement: a live banner URL, already the optimised image
    <img
      src={withTheme(view.src, theme)}
      alt={view.alt}
      width={view.width}
      height={view.height}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className="gb-banner-img"
      style={{ aspectRatio: `${view.width} / ${view.height}` }}
    />
  );
}

export interface MainBannerProps {
  target: BannerTarget;
  kind: EntityKind;
  view: BannerView;
}

/**
 * The banner the page is about. The server HTML holds it as an image (a few
 * hundred bytes, where the DOM banner would be tens of thousands). When the
 * visitor picks a theme and the data and typefaces are in, it becomes the
 * live canvas, so every later theme is drawn in the same frame. Until then,
 * and whenever the data cannot be had, the themed image stands in.
 */
export function MainBanner({ target, kind, view }: MainBannerProps) {
  const { theme } = usePageTheme();
  const isThemed = theme !== DEFAULT_THEME_ID;
  const state = useEntity(isThemed ? target : null, { live: isThemed });
  const [hasFonts, setHasFonts] = useState(false);
  useEffect(() => {
    if (!isThemed) return;
    let alive = true;
    void preloadBannerFonts().then(() => {
      if (alive) setHasFonts(true);
    });
    return () => {
      alive = false;
    };
  }, [isThemed]);
  const options = useMemo(
    () => resolveOptions(kind, view.presetId, { theme }),
    [kind, view.presetId, theme],
  );
  // A preview of an owner lacks the numbers the image has: only the full
  // answer (or the bundled sample) may replace the image.
  const entity =
    state.isCurrent && (state.stage === "full" || state.stage === "sample")
      ? state.entity
      : null;
  const isLive = isThemed && hasFonts && entity !== null;
  return (
    <div
      className="gb-entity-banner"
      style={{
        aspectRatio: `${view.width} / ${view.height}`,
        maxWidth: view.width,
      }}
    >
      {isLive && entity ? (
        <BannerCanvas entity={entity} options={options} />
      ) : (
        <ThemedImage view={view} priority />
      )}
    </div>
  );
}

/** Every theme as a swatch; picking one re-themes every banner on the page. */
export function ThemeRow() {
  const { theme, setTheme } = usePageTheme();
  return (
    <ThemePicker
      variant="strip"
      value={theme}
      onChange={setTheme}
      label="Theme of the banners on this page"
    />
  );
}

export interface BannerActionsProps {
  target: BannerTarget;
  view: BannerView;
}

/** Copy, download and open the main banner, in the page theme. */
export function MainActions({ target, view }: BannerActionsProps) {
  const origin = useSiteOrigin();
  const { theme, query } = usePageTheme();
  return (
    <div className="gb-entity-actions">
      <Button
        label="Open in studio"
        variant="primary"
        href={studioPath({ target, preset: view.presetId, query })}
        as={NoPrefetchLink}
        icon={<Icon icon={ArrowUpRight} />}
      />
      <CopyButton
        text={`${origin}${withTheme(view.src, theme)}`}
        label="Copy image URL"
        copiedLabel="URL copied"
      />
      <DownloadButton
        target={target}
        preset={view.presetId}
        query={query}
        format="png"
      />
      <DownloadButton
        target={target}
        preset={view.presetId}
        query={query}
        format="svg"
        variant="ghost"
      />
    </div>
  );
}

export interface SnippetsProps {
  target: BannerTarget;
  view: BannerView;
  /** Width attribute for fixed canvases; `null` for README cards. */
  width: number | null;
}

/** Markdown, HTML, `<picture>` and URL of the main banner, in the page theme. */
export function Snippets({ target, view, width }: SnippetsProps) {
  const { query } = usePageTheme();
  return (
    <EmbedSnippets
      target={target}
      preset={view.presetId}
      query={query}
      alt={view.alt}
      width={width}
    />
  );
}

/** Copy URL of another preset's banner, in the page theme. */
export function CopyImageUrl({
  view,
  label,
}: {
  view: BannerView;
  label: string;
}) {
  const origin = useSiteOrigin();
  const { theme } = usePageTheme();
  return (
    <CopyButton
      text={`${origin}${withTheme(view.src, theme)}`}
      label={label}
      copiedLabel="URL copied"
      size="sm"
    />
  );
}

/** Download a size variant as PNG, in the page theme. */
export function DownloadSize({
  target,
  view,
}: {
  target: BannerTarget;
  view: BannerView;
}) {
  const { query } = usePageTheme();
  return (
    <DownloadButton
      target={target}
      preset={view.presetId}
      query={joinQuery(view.query, query)}
      format="png"
      size="sm"
      label={`Download ${view.width} × ${view.height} PNG`}
    />
  );
}
