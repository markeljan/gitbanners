"use client";

import { useEffect, useState } from "react";
import { BannerCanvas } from "@/components/banner/banner-canvas";
import { preloadBannerFonts } from "@/components/banner/fonts";
import { bannerPath } from "@/lib/banner";
import { HOME_ENTITY, useHomePreview } from "./preview";

/**
 * The image the server renders for the first paint: the homepage profile as
 * a plain `<img>`, which costs a few hundred bytes of HTML where the DOM
 * banner would cost tens of thousands.
 */
const POSTER_SRC = bannerPath(
  { kind: "owner", login: HOME_ENTITY.login },
  { format: "svg" },
);

export interface PreviewBannerProps {
  /**
   * The hero's copy: its image loads first, and the DOM canvas is prepared
   * in the background so the first keystroke shows it without a beat.
   */
  priority?: boolean;
}

/**
 * The banner the homepage is about, wherever it appears on the page.
 *
 * Until the visitor changes something it is the server-rendered image.
 * After that it is the DOM canvas, which follows typing, presets and themes
 * instantly. Both fill the same box, so the switch moves nothing; with
 * `priority` the canvas is even mounted invisibly underneath once the
 * browser is idle and the banner fonts have arrived.
 */
export function PreviewBanner({ priority = false }: PreviewBannerProps) {
  const { entity, options, banner, touched } = useHomePreview();
  const [isCanvasWarm, setCanvasWarm] = useState(false);
  const [hasPosterFailed, setPosterFailed] = useState(false);
  useEffect(() => {
    if (!priority) return;
    let alive = true;
    const warm = () => {
      void preloadBannerFonts().then(() => {
        if (alive) setCanvasWarm(true);
      });
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(warm, { timeout: 2500 });
      return () => {
        alive = false;
        window.cancelIdleCallback(handle);
      };
    }
    const timer = setTimeout(warm, 600);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [priority]);

  const isLive = touched || hasPosterFailed;
  return (
    <div
      className="gb-preview"
      style={{
        aspectRatio: `${banner.width} / ${banner.height}`,
        maxWidth: banner.width,
      }}
    >
      {isLive || isCanvasWarm ? (
        <BannerCanvas
          entity={entity}
          options={options}
          banner={banner}
          className={isLive ? undefined : "invisible"}
        />
      ) : null}
      {isLive ? null : (
        // biome-ignore lint/performance/noImgElement: the live banner URL is the product, and already an optimised image
        <img
          className="gb-preview-poster"
          src={POSTER_SRC}
          alt={banner.alt}
          width={banner.width}
          height={banner.height}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding="async"
          onError={() => setPosterFailed(true)}
        />
      )}
    </div>
  );
}
