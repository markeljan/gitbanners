"use no memo";

import { OPTION_LIMITS } from "@/lib/banner/options";
import { DEFAULT_SIZE_ID, SIZE_FACTS, SIZES } from "@/lib/banner/sizes";
import type { BannerOptions, SizeId } from "@/lib/banner/types";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The surface a banner is laid out on, after `size`, `width` and `height`
 * have been reconciled.
 */
export interface Canvas {
  width: number;
  /** `null`: the height follows the content. */
  height: number | null;
  /** Padding that content must respect. */
  inset: { top: number; right: number; bottom: number; left: number };
  /** Area other UI covers on the destination (the profile photo on X). */
  safeZone: Rect | null;
  /** Size of small text at this canvas' natural scale, in px. */
  unit: number;
  /** Nothing is set smaller than this unless the content cannot fit otherwise. */
  minType: number;
  /**
   * `card`: README look, rounded and outlined, small type.
   * `poster`: full-bleed image shown scaled down, large type.
   */
  chrome: "card" | "poster";
  radius: number;
  border: boolean;
}

/**
 * Smallest type that survives the destination's own scaling (X shows a
 * 1500 px header at 598 px, link previews at roughly half size), measured in
 * canvas pixels at the size's native width.
 */
const MIN_TYPE: Record<SizeId, number> = {
  readme: 11,
  x: 24,
  linkedin: 24,
  og: 24,
  social: 20,
  square: 28,
};

/** Small text on a README card at 846 px. */
const README_UNIT = 12;
const README_PADDING = 24;
const README_RADIUS = 12;
/** The floor for any text, on any canvas: below it letters stop being letters. */
export const ABSOLUTE_MIN_TYPE = 11;

function clampInt(
  value: number | null | undefined,
  range: { min: number; max: number },
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

function scaleRect(rect: Rect, kx: number, ky: number): Rect {
  return {
    x: Math.round(rect.x * kx),
    y: Math.round(rect.y * ky),
    width: Math.round(rect.width * kx),
    height: Math.round(rect.height * ky),
  };
}

/**
 * Works out the canvas for a set of options. Total: out-of-range numbers are
 * clamped and unknown sizes fall back to the README card.
 *
 * A custom width keeps the proportions of a fixed size (`size=x&width=3000`
 * is a 3000x1000 header with the photo zone scaled along), while on the
 * README size it only makes the card wider or narrower and the height keeps
 * following the content.
 */
export function resolveCanvas(
  options: Pick<
    BannerOptions,
    "size" | "width" | "height" | "radius" | "border"
  >,
): Canvas {
  const id: SizeId = Object.hasOwn(SIZES, options.size)
    ? options.size
    : DEFAULT_SIZE_ID;
  const base = SIZES[id];
  const facts = SIZE_FACTS[id];
  const width = clampInt(options.width, OPTION_LIMITS.width) ?? base.width;
  const kx = width / base.width;
  const customHeight = clampInt(options.height, OPTION_LIMITS.height);
  const height =
    customHeight ??
    (base.height === null ? null : Math.round(base.height * kx));

  const border =
    typeof options.border === "boolean" ? options.border : base.height === null;
  const customRadius = clampInt(options.radius, OPTION_LIMITS.radius);

  if (base.height === null) {
    const padding = Math.round(README_PADDING * Math.max(kx, 0.82));
    // A fixed-height card that is short keeps more of its height for content.
    const vertical =
      height === null ? padding : Math.min(padding, Math.round(height * 0.14));
    return {
      width,
      height,
      inset: { top: vertical, right: padding, bottom: vertical, left: padding },
      safeZone: null,
      unit: Math.max(ABSOLUTE_MIN_TYPE, Math.round(README_UNIT * kx)),
      minType: Math.max(ABSOLUTE_MIN_TYPE, Math.round(MIN_TYPE.readme * kx)),
      chrome: "card",
      radius: customRadius ?? Math.round(README_RADIUS * Math.max(kx, 1)),
      border,
    };
  }

  const ky = (height ?? base.height) / base.height;
  const [top, right, bottom, left] = facts.inset;
  // The photo zone only means something while the canvas keeps the shape the
  // destination crops: a 1500x900 "X header" has no known zone.
  const sameShape = Math.abs(ky / kx - 1) < 0.02;
  const type = Math.max(ABSOLUTE_MIN_TYPE, Math.round(MIN_TYPE[id] * kx));
  return {
    width,
    height,
    inset: {
      top: Math.round(top * ky),
      right: Math.round(right * kx),
      bottom: Math.round(bottom * ky),
      left: Math.round(left * kx),
    },
    safeZone:
      base.safeZone && sameShape ? scaleRect(base.safeZone, kx, ky) : null,
    unit: type,
    minType: type,
    chrome: "poster",
    radius: customRadius ?? 0,
    border,
  };
}
