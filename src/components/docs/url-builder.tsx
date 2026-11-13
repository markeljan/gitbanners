"use client";

import "./docs.css";

import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useState } from "react";
import { BannerImage } from "@/components/banner/banner-image";
import { CopyButton } from "@/components/banner/copy-button";
import { useSiteOrigin } from "@/components/providers";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  type BannerTarget,
  bannerPath,
  DEFAULT_THEME_ID,
  type ImageFormat,
  presetsFor,
  SIZES,
  type SizeId,
  serializeOptions,
  THEMES,
} from "@/lib/banner";
import { parseTargetSlug, targetSlug } from "@/lib/embed";

const SIZE_OPTIONS = Object.values(SIZES).map((size) => ({
  value: size.id,
  label: size.name,
  description:
    size.height === null
      ? `${size.width} px wide`
      : `${size.width} × ${size.height}`,
}));

const THEME_OPTIONS = THEMES.map((theme) => ({
  value: theme.id,
  label: theme.name,
}));

function isSizeId(value: string | undefined): value is SizeId {
  return value !== undefined && Object.hasOwn(SIZES, value);
}

export interface UrlBuilderProps {
  /** What the field starts with: a login or `owner/repo`. */
  initialTarget: string;
}

/**
 * The cheat sheet, live: a target, a preset, a theme, a size and a format
 * make a banner URL, shown with its image. Everything it prints is a
 * relative path the docs above explain; nothing here is fetched except the
 * preview image.
 */
export function UrlBuilder({ initialTarget }: UrlBuilderProps) {
  const origin = useSiteOrigin();
  const [text, setText] = useState(initialTarget);
  const [preset, setPreset] = useState<string | undefined>(undefined);
  const [theme, setTheme] = useState<string | undefined>(DEFAULT_THEME_ID);
  const [size, setSize] = useState<SizeId>("readme");
  const [format, setFormat] = useState<ImageFormat>("svg");

  const parsed = parseTargetSlug(text);
  const fallback = parseTargetSlug(initialTarget);
  const target: BannerTarget | null = parsed ?? fallback;
  const kind = target?.kind === "repo" ? "repo" : "user";
  const presets = presetsFor(kind);
  const chosen =
    presets.find((item) => item.id === preset) ?? presets[0] ?? null;
  const query = serializeOptions({
    theme: theme ?? DEFAULT_THEME_ID,
    // The preset's own size unless another one is picked.
    ...(size === "readme" ? {} : { size }),
  });
  const path = target
    ? bannerPath(target, { preset: chosen?.id, query })
    : null;
  const imagePath = target
    ? bannerPath(target, { preset: chosen?.id, format, query })
    : null;
  const url = imagePath ? `${origin}${imagePath}` : "";
  const preview = useDebouncedValue(path, 300);
  const label = target ? targetSlug(target) : "";

  return (
    <div className="gb-builder">
      <div className="gb-builder-fields">
        <TextInput
          label="User, organization or repository"
          value={text}
          onChange={setText}
          placeholder="vercel or vercel/next.js"
          autoCapitalize="off"
          hasAutoCorrect={false}
          hasSpellCheck={false}
          status={
            parsed || text.trim() === ""
              ? undefined
              : {
                  type: "warning",
                  message: `Not a GitHub name. Showing ${initialTarget}.`,
                }
          }
        />
        <Selector
          label="Preset"
          value={chosen?.id}
          onChange={(next) => setPreset(next)}
          options={presets.map((item) => ({
            value: item.id,
            label: item.name,
            description: item.description,
          }))}
        />
        <Selector
          label="Theme"
          value={theme}
          onChange={setTheme}
          hasSearch
          options={THEME_OPTIONS}
        />
        <Selector
          label="Size"
          value={size}
          onChange={(next) => {
            if (isSizeId(next)) setSize(next);
          }}
          options={SIZE_OPTIONS}
        />
        <SegmentedControl
          label="Format"
          value={format}
          onChange={(next) => setFormat(next === "png" ? "png" : "svg")}
        >
          <SegmentedControlItem value="svg" label="SVG" />
          <SegmentedControlItem value="png" label="PNG" />
        </SegmentedControl>
      </div>
      <div className="gb-builder-result">
        <div className="gb-builder-url">
          <code>{url}</code>
          <CopyButton text={url} label="Copy URL" size="sm" />
        </div>
        {preview ? (
          <BannerImage
            key={preview}
            path={preview}
            alt={`${chosen?.name ?? "Banner"} banner of ${label}`}
            kind={kind === "repo" ? "repo" : undefined}
            href={null}
            className="gb-builder-preview"
          />
        ) : null}
      </div>
    </div>
  );
}
