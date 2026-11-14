/**
 * The page theme as URL text. Pure and isomorphic: the server prints
 * default-theme URLs, the browser re-themes the same URLs.
 */
import { canonicalQuery, DEFAULT_THEME_ID, isThemeId } from "@/lib/banner";

/** A theme id from a query value, or the default for anything else. */
export function readTheme(value: string | null | undefined): string {
  return value && isThemeId(value) ? value : DEFAULT_THEME_ID;
}

/** The option query for a theme: "" for the default, `theme=dracula` otherwise. */
export function themeQuery(theme: string): string {
  return theme === DEFAULT_THEME_ID ? "" : canonicalQuery(`theme=${theme}`);
}

/**
 * Adds two option queries in canonical order, so a themed URL is the very
 * URL every other part of the site prints for that banner (one cache entry).
 */
export function joinQuery(a: string, b: string): string {
  const both = [a, b].filter(Boolean).join("&");
  return both ? canonicalQuery(both) : "";
}

/**
 * A relative banner URL (`/vercel/repos.svg`, `/vercel.svg?size=x`) in a
 * theme. The default theme leaves the URL as it is.
 */
export function withTheme(src: string, theme: string): string {
  const extra = themeQuery(theme);
  if (!extra) return src;
  const at = src.indexOf("?");
  const path = at === -1 ? src : src.slice(0, at);
  const query = joinQuery(at === -1 ? "" : src.slice(at + 1), extra);
  return query ? `${path}?${query}` : path;
}
