"use client";

import { ThemePicker } from "@/components/banner/theme-picker";
import { useHomePreview } from "./preview";
import { PreviewBanner } from "./preview-banner";

/**
 * Every theme as a swatch, next to the banner the page is about. Picking one
 * re-themes that banner here and in the hero, and puts `?theme=` into the
 * URL the hero copies.
 */
export function ThemesPlayground() {
  const { theme, setTheme } = useHomePreview();
  return (
    <div className="gb-themes">
      <div className="gb-themes-preview">
        <PreviewBanner />
      </div>
      <ThemePicker variant="strip" value={theme} onChange={setTheme} />
    </div>
  );
}
