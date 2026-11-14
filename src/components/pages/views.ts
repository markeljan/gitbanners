/**
 * Every banner an owner or repository page shows, measured on the server
 * from the real data: the URL, the exact box to reserve and the alt text.
 * Pure: the page passes these plain objects to its client parts, which
 * only swap the theme in the URLs.
 */
import { bannerNow } from "@/components/banner/build";
import {
  type BannerOptions,
  type BannerPreset,
  type BannerTarget,
  bannerPath,
  buildBanner,
  presetsFor,
  resolveOptions,
  SIZES,
  type SizeId,
  targetOf,
} from "@/lib/banner";
import type { Entity } from "@/lib/github/schema";

export interface BannerView {
  presetId: string;
  /** Preset name, e.g. "Top repositories". */
  name: string;
  /** One line on what the preset shows. */
  description: string;
  /** Page of this preset: `/vercel/repos`. */
  page: string;
  /** SVG URL in the default theme, relative: `/vercel/repos.svg`. */
  src: string;
  /** Option query of the image without "?" (`size=x`), "" for none. */
  query: string;
  width: number;
  height: number;
  alt: string;
}

export interface SizeView extends BannerView {
  sizeId: SizeId;
  /** Sentence-case size name, e.g. "X header". */
  sizeName: string;
  sizeDescription: string;
}

function measure(
  entity: Entity,
  options: BannerOptions,
  host: string,
): { width: number; height: number; alt: string } {
  const built = buildBanner(entity, options, {
    // Measuring needs no pictures.
    image: () => "",
    now: bannerNow(entity),
    host,
  });
  return { width: built.width, height: built.height, alt: built.alt };
}

function view(
  entity: Entity,
  target: BannerTarget,
  preset: BannerPreset,
  host: string,
  size: SizeId | null,
): BannerView {
  const query = size ? `size=${size}` : "";
  const options = resolveOptions(entity.kind, preset.id, size ? { size } : {});
  return {
    presetId: preset.id,
    name: preset.name,
    description: preset.description,
    page: bannerPath(target, { preset: preset.id }),
    src: bannerPath(target, { preset: preset.id, format: "svg", query }),
    query,
    ...measure(entity, options, host),
  };
}

/** Every preset of the entity's kind, in picker order. */
export function presetViews(entity: Entity, host: string): BannerView[] {
  const target = targetOf(entity);
  return presetsFor(entity.kind).map((preset) =>
    view(entity, target, preset, host, null),
  );
}

/** The canvases worth offering for a preset, in the order people need them. */
const SIZE_ORDER: Record<Entity["kind"], readonly SizeId[]> = {
  user: ["x", "linkedin", "og", "square"],
  org: ["x", "linkedin", "og", "square"],
  repo: ["social", "og", "x", "square"],
};

/**
 * The selected preset at the fixed social sizes, minus the one it already
 * has (the year in review is drawn at link-preview size to begin with).
 */
export function sizeViews(
  entity: Entity,
  preset: BannerPreset,
  host: string,
): SizeView[] {
  const target = targetOf(entity);
  const own = resolveOptions(entity.kind, preset.id).size;
  return SIZE_ORDER[entity.kind]
    .filter((id) => id !== own)
    .map((id) => ({
      ...view(entity, target, preset, host, id),
      sizeId: id,
      sizeName: SIZES[id].name,
      sizeDescription: SIZES[id].description,
    }));
}
