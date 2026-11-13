"use no memo";

import { heatRamp, luminance, mix } from "@/lib/banner/color";
import { normalizeHex } from "@/lib/banner/options";
import {
  getTheme,
  isThemeId,
  THEME_EXTRAS,
  type ThemeExtras,
} from "@/lib/banner/themes";
import type {
  BannerOptions,
  BannerTheme,
  ThemeColors,
} from "@/lib/banner/types";

/**
 * Colours a banner is drawn with: the chosen theme, the caller's overrides on
 * top, and the semantic extras sections need. Every value in here has been
 * validated, because the image renderer fails the whole render on one colour
 * it cannot parse.
 */
export interface Palette {
  /** The theme after overrides, as reported in `BuiltBanner.theme`. */
  theme: BannerTheme;
  colors: ThemeColors;
  /** Links, @handles, URLs. */
  link: string;
  success: string;
  warning: string;
  danger: string;
  done: string;
  /** Stroke for heatmap cells, on themes whose empty cell equals the background. */
  heatBorder: string | null;
}

type Heat = ThemeColors["heat"];

const FALLBACK_EXTRAS: ThemeExtras = THEME_EXTRAS["github-dark"];

/**
 * Shortest lower-case hex form (`#fff` for `#ffffff`). The renderer's SVG
 * writer prints fills this way, and the heatmap animation matches cells by
 * their fill text, so cells and `HeatmapGeometry.colors` must use it too.
 */
export function shortHex(color: string): string {
  const hex = color.toLowerCase();
  const short =
    hex.length === 7 &&
    hex[1] === hex[2] &&
    hex[3] === hex[4] &&
    hex[5] === hex[6];
  return short ? `#${hex[1]}${hex[3]}${hex[5]}` : hex;
}

function pickHeat(
  override: Heat | undefined,
  base: BannerTheme,
  mode: "dark" | "light",
  bg: string,
  empty: string,
): Heat {
  const given = Array.isArray(override) ? override.map(normalizeHex) : [];
  if (given.length !== 5 || given.some((color) => color === null)) {
    return base.colors.heat;
  }
  const [a, b, c, d, e] = given as string[];
  // Five equal entries are how the options encode "one colour: build the ramp".
  if (a === b && a === c && a === d && a === e) {
    return heatRamp(mode, bg, empty, a);
  }
  return [a, b, c, d, e];
}

/**
 * Resolves theme and colour overrides to concrete, validated colours.
 * Unknown theme ids fall back to the default theme and invalid overrides are
 * ignored, so the result is always drawable.
 */
export function resolvePalette(
  options: Pick<BannerOptions, "theme" | "colors">,
): Palette {
  const base = getTheme(options.theme);
  const extras = isThemeId(base.id) ? THEME_EXTRAS[base.id] : FALLBACK_EXTRAS;
  const given = options.colors ?? {};
  const pick = (key: keyof Omit<ThemeColors, "heat">) =>
    normalizeHex(given[key]) ?? base.colors[key];

  const bg = pick("bg");
  const surface = pick("surface");
  const recoloured = bg !== base.colors.bg || surface !== base.colors.surface;
  // The theme's own mode is authoritative until the canvas itself is recoloured.
  const mode = recoloured
    ? luminance(bg) > 0.35
      ? "light"
      : "dark"
    : base.mode;
  // Themes ship a hand-picked empty cell. With a custom canvas the surface is
  // the natural empty cell, unless it would vanish into the background.
  const empty = recoloured
    ? surface === bg
      ? mix(bg, pick("text"), 0.1)
      : surface
    : base.colors.heat[0];

  const colors: ThemeColors = {
    bg,
    surface,
    border: pick("border"),
    text: pick("text"),
    muted: pick("muted"),
    accent: pick("accent"),
    heat: pickHeat(given.heat, base, mode, bg, empty),
  };
  return {
    theme: { id: base.id, name: base.name, mode, colors },
    colors,
    link: normalizeHex(given.accent) ?? extras.link,
    success: extras.success,
    warning: extras.warning,
    danger: extras.danger,
    done: extras.done,
    heatBorder: extras.heatBorder ?? null,
  };
}
