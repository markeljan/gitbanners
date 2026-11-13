export type ColorMode = "light" | "dark" | "system";
export const THEME_STORAGE_KEY = "gitbanners:theme";
/** Mode the server renders. The stored choice is applied before first paint. */
export const DEFAULT_MODE: "light" | "dark" = "dark";

/**
 * Cookie that says "a session probably exists". The session cookie itself is
 * HttpOnly; this one is readable so static pages know whether asking
 * `/api/me` is worth a request.
 */
export const SESSION_HINT_RE = /(?:^|; )(?:__Host-)?gb_in=1/;
/** Set on `<html>` before first paint while the session hint cookie exists. */
export const SIGNED_IN_ATTRIBUTE = "data-gb-in";

/**
 * Inline, render-blocking: applies the stored colour mode to `<html>` before
 * first paint, and marks the document as "probably signed in" so the header
 * can reserve the avatar's place instead of flashing the sign-in button.
 */
export const themeInitScript = `(function(){try{var d=document.documentElement,t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark")d.setAttribute("data-theme",t);else if(t==="system")d.removeAttribute("data-theme")}catch(e){}try{if(${SESSION_HINT_RE}.test(document.cookie))document.documentElement.setAttribute(${JSON.stringify(
  SIGNED_IN_ATTRIBUTE,
)},"")}catch(e){}})()`;

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

/** The mode the page is painted in right now: a stored choice, or the OS. */
export function effectiveMode(): "light" | "dark" {
  const attribute = document.documentElement.getAttribute("data-theme");
  if (attribute === "light" || attribute === "dark") return attribute;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}
