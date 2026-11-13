"use no memo";

/**
 * Banner engine: public surface.
 *
 * Pages, the image route, the API and the MCP server import from here and
 * nowhere deeper, so the modules behind it stay free to move.
 */
export { altText } from "@/lib/banner/alt";
export {
  bannerText,
  buildBanner,
  buildMessageBanner,
  collectImages,
} from "@/lib/banner/build";
export { type Canvas, type Rect, resolveCanvas } from "@/lib/banner/canvas";
export { DEMO_NOW, demoEntity, identicon } from "@/lib/banner/demo";
export { DEFAULT_FONT_ID, FONTS, getFont } from "@/lib/banner/fonts";
export { formatCount, formatNumber } from "@/lib/banner/format";
export {
  canonicalQuery,
  DEFAULT_OPTIONS,
  diffOptions,
  HIDE_IDS,
  normalizeHex,
  normalizeOptions,
  OPTION_LIMITS,
  parseOptions,
  QUERY_KEYS,
  type QueryInput,
  type QueryKey,
  resolveOptions,
  SECTION_IDS,
  SIZE_IDS,
  STAT_IDS,
  serializeOptions,
  stripProOptions,
} from "@/lib/banner/options";
export { type Palette, resolvePalette } from "@/lib/banner/palette";
export {
  bannerPath,
  parseBannerPath,
  targetLabel,
  targetOf,
} from "@/lib/banner/path";
export {
  defaultPresetId,
  getPreset,
  OWNER_PRESET_IDS,
  PRESET_DEFAULTS,
  PRESETS,
  type PresetDefaults,
  type PresetKey,
  presetDefaults,
  presetsFor,
} from "@/lib/banner/presets";
export {
  DEFAULT_SIZE_ID,
  fitHeatmap,
  type HeatmapFit,
  SIZE_FACTS,
  SIZES,
  type SizeFacts,
} from "@/lib/banner/sizes";
export {
  DEFAULT_THEME_ID,
  getTheme,
  isThemeId,
  THEME_EXTRAS,
  THEMES,
  type ThemeExtras,
  type ThemeId,
} from "@/lib/banner/themes";
export type * from "@/lib/banner/types";
