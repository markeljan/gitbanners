import type { BannerTheme } from "@/lib/banner";

/** Themes whose name or id contains every word of `search`. */
export function filterThemes(
  themes: readonly BannerTheme[],
  search: string,
): BannerTheme[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return themes.filter((theme) => {
    const haystack = `${theme.name} ${theme.id}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * CSS custom properties that draw a theme in miniature: canvas, border,
 * text, accent and the five contribution levels as equal bands. The theme's
 * own colours are data, not chrome, so raw values are right here.
 */
export function swatchVariables(theme: BannerTheme): Record<string, string> {
  const { bg, border, text, accent, heat } = theme.colors;
  const band = 100 / heat.length;
  return {
    "--gb-sw-bg": bg,
    "--gb-sw-border": border,
    "--gb-sw-text": text,
    "--gb-sw-accent": accent,
    "--gb-sw-heat": `linear-gradient(90deg, ${heat
      .map((color, at) => `${color} ${at * band}% ${(at + 1) * band}%`)
      .join(", ")})`,
  };
}
