export type ColorMode = "light" | "dark" | "system";
export const THEME_STORAGE_KEY = "gitbanners:theme";
/** Mode the server renders. The stored choice is applied before first paint. */
export const DEFAULT_MODE: "light" | "dark" = "dark";

/** Inline, render-blocking: applies the stored mode to <html> before first paint. */
export const themeInitScript = `(function(){try{var d=document.documentElement,t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark")d.setAttribute("data-theme",t);else if(t==="system")d.removeAttribute("data-theme")}catch(e){}})()`;

export function readStoredMode(): ColorMode {
  try {
    const t = localStorage.getItem(THEME_STORAGE_KEY);
    if (t === "light" || t === "dark" || t === "system") return t;
  } catch {}
  return DEFAULT_MODE;
}

export function applyMode(mode: ColorMode): void {
  const root = document.documentElement;
  const current = root.getAttribute("data-theme");
  if (mode === "system") {
    if (current !== null) root.removeAttribute("data-theme");
  } else if (current !== mode) {
    root.setAttribute("data-theme", mode);
  }
}

export function setColorMode(mode: ColorMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {}
  applyMode(mode);
}
