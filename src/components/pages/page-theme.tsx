"use client";

import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { DEFAULT_THEME_ID } from "@/lib/banner";
import { readTheme, themeQuery } from "./theme-query";

interface PageTheme {
  /** Theme of every banner on the page. */
  theme: string;
  /** `theme=…` for option queries, "" for the default theme. */
  query: string;
  setTheme: (theme: string) => void;
}

const PageThemeContext = createContext<PageTheme | null>(null);

export function usePageTheme(): PageTheme {
  const value = use(PageThemeContext);
  if (!value) throw new Error("usePageTheme() needs <PageThemeProvider>");
  return value;
}

/**
 * The theme of a banner page, kept in the address bar as `?theme=` so a
 * link to a themed page opens themed.
 *
 * Read from `window.location` after hydration instead of with
 * `useSearchParams()`: the page is prerendered once for every query string,
 * and this way it needs no Suspense boundary and its HTML holds every banner
 * in the default theme. The canonical URL never carries the parameter.
 */
export function PageThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState(DEFAULT_THEME_ID as string);
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("theme");
    if (asked) setThemeState(readTheme(asked));
  }, []);
  const setTheme = useCallback((next: string) => {
    const id = readTheme(next);
    setThemeState(id);
    const url = new URL(window.location.href);
    if (id === DEFAULT_THEME_ID) url.searchParams.delete("theme");
    else url.searchParams.set("theme", id);
    // Next's router follows history.replaceState: no navigation, no render.
    window.history.replaceState(null, "", url);
  }, []);
  const value = useMemo(
    () => ({ theme, query: themeQuery(theme), setTheme }),
    [theme, setTheme],
  );
  return <PageThemeContext value={value}>{children}</PageThemeContext>;
}
