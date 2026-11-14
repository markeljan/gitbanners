"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { ExternalLink } from "lucide-react";
import { type CSSProperties, useState } from "react";
import { BannerCanvas } from "@/components/banner/banner-canvas";
import { bannerPath, SIZES } from "@/lib/banner";
import { targetSlug } from "@/lib/embed";
import { SAMPLE_USER } from "@/lib/github/samples";
import { useStudioContext } from "./use-studio";

type Zoom = "fit" | "actual";
type Backdrop = "page" | "light" | "dark" | "checker";

const BACKDROPS: readonly { value: Backdrop; label: string }[] = [
  { value: "page", label: "Page" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "checker", label: "Checks" },
];

/** How the canvas is looked at. Not part of the banner, so not in the URL. */
export interface StageSettings {
  zoom: Zoom;
  setZoom: (zoom: Zoom) => void;
  backdrop: Backdrop;
  setBackdrop: (backdrop: Backdrop) => void;
  hasSafeZone: boolean;
  setSafeZone: (on: boolean) => void;
}

export function useStageSettings(): StageSettings {
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [backdrop, setBackdrop] = useState<Backdrop>("page");
  const [hasSafeZone, setSafeZone] = useState(true);
  return { zoom, setZoom, backdrop, setBackdrop, hasSafeZone, setSafeZone };
}

/** The destination's covered area applies to its own canvas only. */
function useZone() {
  const { options } = useStudioContext();
  const zone = SIZES[options.size]?.safeZone ?? null;
  const isCustom = options.width !== null || options.height !== null;
  return isCustom ? null : zone;
}

/**
 * Above the canvas: zoom, backdrop, the covered area, the true pixel size
 * and the server's own image for comparison.
 */
export function StageBar({ settings }: { settings: StageSettings }) {
  const { banner, target, preset, linkQuery } = useStudioContext();
  const zone = useZone();
  const live = bannerPath(target, { preset, format: "png", query: linkQuery });
  return (
    <div className="gb-stage-bar">
      <SegmentedControl
        label="Zoom"
        size="sm"
        value={settings.zoom}
        onChange={(next) => settings.setZoom(next as Zoom)}
      >
        <SegmentedControlItem value="fit" label="Fit" />
        <SegmentedControlItem value="actual" label="100%" />
      </SegmentedControl>
      <SegmentedControl
        label="Backdrop"
        size="sm"
        value={settings.backdrop}
        onChange={(next) => settings.setBackdrop(next as Backdrop)}
      >
        {BACKDROPS.map((item) => (
          <SegmentedControlItem
            key={item.value}
            value={item.value}
            label={item.label}
          />
        ))}
      </SegmentedControl>
      {zone ? (
        <Switch
          label="Covered area"
          size="sm"
          value={settings.hasSafeZone}
          onChange={settings.setSafeZone}
        />
      ) : null}
      <span className="gb-stage-size">
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {`${banner.width} × ${banner.height} px`}
        </Text>
      </span>
      <Button
        label="Open live image"
        href={live}
        as="a"
        target="_blank"
        rel="noopener"
        size="sm"
        variant="ghost"
        endContent={<Icon icon={ExternalLink} size="sm" />}
      />
    </div>
  );
}

/** What is wrong with the target on screen, right above the canvas. */
export function StageNotice() {
  const { notice, retry } = useStudioContext();
  if (!notice) return null;
  return (
    <Banner
      status={notice.tone}
      title={notice.title}
      description={notice.description}
      container="card"
      endContent={
        notice.canRetry ? (
          <Button label="Try again" size="sm" onClick={retry} />
        ) : undefined
      }
    />
  );
}

/**
 * The banner as live DOM: the very element the server renders. While a new
 * target loads the previous banner stays, dimmed.
 */
export function StageView({ settings }: { settings: StageSettings }) {
  const studio = useStudioContext();
  const { banner, options, entity } = studio;
  const zone = useZone();
  const showZone = zone !== null && settings.hasSafeZone;
  const scheme =
    settings.backdrop === "light"
      ? " scheme-light"
      : settings.backdrop === "dark"
        ? " scheme-dark"
        : "";
  return (
    <div
      className={`gb-stage-view${scheme}`}
      data-zoom={settings.zoom}
      data-backdrop={settings.backdrop}
      // Light and dark re-declare the app's tokens in that mode here.
      data-astryx-theme={scheme ? "neutral" : undefined}
      style={
        {
          "--gb-ratio": banner.width / banner.height,
        } as CSSProperties
      }
    >
      <div
        className="gb-stage-frame"
        data-pending={studio.isPending || undefined}
        aria-busy={studio.isPending}
        style={settings.zoom === "actual" ? { width: banner.width } : undefined}
      >
        <BannerCanvas
          entity={entity ?? SAMPLE_USER}
          options={options}
          banner={banner}
          safeZone={showZone}
        />
      </div>
      <output className="sr-only" aria-live="polite">
        {studio.isPending ? `Loading ${targetSlug(studio.requested)}` : ""}
      </output>
    </div>
  );
}

/** The sentence under the canvas that explains the dashed area. */
export function StageZoneNote({ settings }: { settings: StageSettings }) {
  const { options } = useStudioContext();
  const zone = useZone();
  if (!zone || !settings.hasSafeZone) return null;
  const where = SIZES[options.size].name.replace(/ (header|banner)$/i, "");
  return (
    <Text as="p" type="supporting" color="secondary">
      {`Your ${zone.label.toLowerCase()} covers the dashed area on ${where}. Keep it clear of anything that matters.`}
    </Text>
  );
}
