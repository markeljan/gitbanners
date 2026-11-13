import type { FontId } from "@/lib/banner";

/** `document.fonts.load()` descriptors for each banner typeface. */
const FACES: Record<FontId, readonly string[]> = {
  mona: [
    '400 16px "Mona Sans"',
    '500 16px "Mona Sans"',
    '600 16px "Mona Sans"',
  ],
  mono: ['400 16px "Mona Sans Mono"', '500 16px "Mona Sans Mono"'],
};

const requested = new Map<FontId, Promise<void>>();

/**
 * Downloads a banner typeface ahead of the first DOM preview. The faces are
 * declared with `font-display: block` (the preview must match the rendered
 * image glyph for glyph), so a preview mounted before they arrive would show
 * no text for a moment. Call this when a preview is likely: on idle after
 * load, or when the target input gets focus. Safe to call repeatedly.
 */
export function preloadBannerFonts(font: FontId = "mona"): Promise<void> {
  const pending = requested.get(font);
  if (pending) return pending;
  const ready =
    typeof document === "undefined" || !document.fonts
      ? Promise.resolve()
      : Promise.all(FACES[font].map((face) => document.fonts.load(face)))
          .then(() => {})
          // A failed download falls back to the browser's own late swap.
          .catch(() => {});
  requested.set(font, ready);
  return ready;
}
