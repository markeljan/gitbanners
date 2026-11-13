"use no memo";

import type { BannerFont, FontId } from "@/lib/banner/types";

/**
 * Typefaces a banner can be set in. `family` is the exact name registered
 * with the image renderer (`src/lib/render/fonts.ts`) and with the browser
 * through `@font-face`, so the DOM preview and the image use the same glyphs.
 */
export const FONTS: Record<FontId, BannerFont> = {
  mona: { id: "mona", name: "Mona Sans", family: "Mona Sans" },
  mono: { id: "mono", name: "Mona Sans Mono", family: "Mona Sans Mono" },
};

export const DEFAULT_FONT_ID: FontId = "mona";

/** Unknown ids fall back to Mona Sans, so a typo in a URL never breaks an embedded image. */
export function getFont(id: string | null | undefined): BannerFont {
  return id === "mono" ? FONTS.mono : FONTS.mona;
}

/**
 * Weight used for names and numbers. Mona Sans Mono ships 400 and 500 only;
 * asking for 600 would make every engine synthesise its own fake bold.
 */
export function strongWeight(font: BannerFont): 500 | 600 {
  return font.id === "mono" ? 500 : 600;
}
