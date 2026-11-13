"use client";

import { LayerProvider } from "@astryxdesign/core/Layer";
import { LinkProvider } from "@astryxdesign/core/Link";
import { registerTheme, ThemeContext } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import Link from "next/link";
import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import {
  applyMode,
  type ColorMode,
  DEFAULT_MODE,
  readStoredMode,
} from "./theme";

// Lets no-context consumers (toast fallback viewport) resolve the theme by <html data-astryx-theme>.
registerTheme(neutralTheme);

function subscribe(onChange: () => void) {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => mo.disconnect();
}
function getSnapshot(): ColorMode {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" || t === "dark" ? t : "system";
}
const getServerSnapshot = (): ColorMode => DEFAULT_MODE;

/** Current colour mode, driven by <html data-theme> (the single source of truth). */
export function useColorMode(): ColorMode {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * App-wide providers. We provide Astryx's ThemeContext ourselves instead of
 * mounting <Theme>: <Theme> overwrites <html data-theme> on hydration, which
 * would break the no-flash colour mode on statically prerendered pages.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const mode = useColorMode();
  // Dev only: StrictMode's remount resets <html> attributes to the JSX ones; re-apply the stored mode.
  useLayoutEffect(() => {
    applyMode(readStoredMode());
  }, []);
  const theme = useMemo(() => ({ theme: neutralTheme, mode }), [mode]);
  return (
    <ThemeContext value={theme}>
      <LayerProvider toast={{ position: "bottomEnd" }}>
        <LinkProvider component={Link}>{children}</LinkProvider>
      </LayerProvider>
    </ThemeContext>
  );
}
