/**
 * Server-side image rendering (Node only).
 *
 * The banner engine (`src/lib/banner`) builds a React element with explicit
 * pixel layout; this module turns it into SVG / PNG / WebP with Takumi, a
 * native renderer that draws text as paths and inlines images, which is what
 * GitHub's image proxy requires (no external fonts or images in an SVG).
 */
export { animateHeatmap, type HeatmapSpec } from "./animate-heatmap";
export { avatarDataUri } from "./avatar";
export {
  type RenderOptions,
  renderPng,
  renderSvg,
  renderWebp,
} from "./engine";
export {
  drawableText,
  drawnAsEmoji,
  fontsForText,
  type TextFonts,
} from "./fallback-fonts";
export { type BannerFont, baseCoverage, loadBaseFonts } from "./fonts";
export { prepareText } from "./text";
