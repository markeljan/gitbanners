"use client";

import {
  type CSSProperties,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSiteHost } from "@/components/providers";
import {
  type BannerOptions,
  type BuiltBanner,
  resolveCanvas,
  SIZES,
} from "@/lib/banner";
import type { Entity } from "@/lib/github/schema";
import { buildBrowserBanner } from "./build";
import { fitScale, percentRect } from "./scale";

/**
 * The banner for an entity and options, built for the browser and memoised.
 * Use it when the page needs the banner's `width`, `height` or `alt` as well
 * as the picture, and hand the result to `<BannerCanvas banner>` so it is
 * built once.
 *
 * Keep `options` referentially stable between renders (derive it from state
 * with `resolveOptions` inside `useMemo`), or every render builds again.
 */
export function useBanner(
  entity: Entity,
  options: BannerOptions,
  now?: Date,
): BuiltBanner {
  const host = useSiteHost();
  return useMemo(
    () => buildBrowserBanner(entity, options, host, now),
    [entity, options, host, now],
  );
}

export interface BannerCanvasProps {
  /** The GitHub data to draw. */
  entity: Entity;
  /** Fully resolved options: the result of `resolveOptions(kind, preset, overrides)`. */
  options: BannerOptions;
  /**
   * The banner already built from this `entity` and `options` (see
   * `useBanner`). Without it the canvas builds its own.
   */
  banner?: BuiltBanner;
  /**
   * Clock for streaks and relative labels. Defaults to the moment the entity
   * was fetched, which is the same on the server and in the browser; never
   * pass `new Date()` from a component that is server rendered.
   */
  now?: Date;
  /**
   * Largest magnification. 1 (default) shows the banner at most at its own
   * size, which is how GitHub shows a README image; pass a larger number to
   * let small cards fill a wide stage.
   */
  maxScale?: number;
  /**
   * Draw the area the destination covers (the profile photo on X and
   * LinkedIn) as a dashed overlay with its label. Nothing is drawn for sizes
   * without such an area.
   */
  safeZone?: boolean;
  /**
   * What sits behind the banner. `plain` and `checker` add a padded stage,
   * which makes rounded corners and light banners readable on any page.
   * @default "none"
   */
  backdrop?: "none" | "plain" | "checker";
  className?: string;
}

/**
 * A live banner mounted as real DOM: the very element the server turns into
 * SVG and PNG, so the preview cannot disagree with the image.
 *
 * The box reserves the banner's exact aspect ratio at the container's width
 * (nothing moves when it appears), and the banner inside is scaled with a CSS
 * transform, so text stays vector-sharp at any width. The scale is a pure
 * CSS expression on first paint and a measured number once a ResizeObserver
 * has run. To assistive technology the whole canvas is one image named by
 * the banner's alt text.
 *
 * The typefaces load on demand; call `preloadBannerFonts()` a moment before
 * the first canvas mounts to avoid a beat without text.
 */
export function BannerCanvas({
  entity,
  options,
  banner,
  now,
  maxScale = 1,
  safeZone = false,
  backdrop = "none",
  className,
}: BannerCanvasProps) {
  const host = useSiteHost();
  const built = useMemo(
    () => banner ?? buildBrowserBanner(entity, options, host, now),
    [banner, entity, options, host, now],
  );

  const box = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setAvailable(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const style: Record<string, string | number> = {
    aspectRatio: `${built.width} / ${built.height}`,
    "--gb-banner-width": `${built.width}px`,
  };
  if (Number.isFinite(maxScale)) style.maxWidth = built.width * maxScale;
  if (available !== null) {
    style["--gb-banner-scale"] = fitScale(available, built.width, maxScale);
  }

  const zone = safeZone ? resolveCanvas(options).safeZone : null;
  const zoneLabel = SIZES[options.size]?.safeZone?.label ?? "Covered area";

  const canvas = (
    <div
      ref={box}
      role="img"
      aria-label={built.alt}
      className={
        backdrop === "none" ? join("gb-canvas", className) : "gb-canvas"
      }
      style={style as CSSProperties}
    >
      <div className="gb-canvas-layer">{built.element}</div>
      {zone ? (
        <div
          className="gb-safe-zone"
          style={
            {
              ...percentRect(zone, built),
              "--gb-zone-ink": built.theme.colors.text,
              "--gb-zone-paper": built.theme.colors.bg,
            } as CSSProperties
          }
        >
          <span className="gb-safe-zone-label">{zoneLabel}</span>
        </div>
      ) : null}
    </div>
  );
  if (backdrop === "none") return canvas;
  return (
    <div className={join("gb-stage", `gb-stage-${backdrop}`, className)}>
      {canvas}
    </div>
  );
}

function join(...classes: (string | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
