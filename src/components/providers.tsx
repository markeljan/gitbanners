"use client";

import { LayerProvider } from "@astryxdesign/core/Layer";
import { LinkProvider } from "@astryxdesign/core/Link";
import { registerTheme, ThemeContext } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import {
  createContext,
  use,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { ProRepoLink } from "@/lib/pro/repo";
import { AppLink } from "./app-link";
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

const SiteOriginContext = createContext<string | null>(null);

/**
 * The canonical origin (`site.url`) as the SERVER resolved it, without a
 * trailing slash.
 *
 * Client components must print URLs through this hook instead of importing
 * `site.url`: on the server the origin comes from server-only environment
 * variables (the deployment's production domain, the dev server's port), so
 * the browser's copy of that module can resolve to something else and the
 * page would hydrate with different text.
 */
export function useSiteOrigin(): string {
  const origin = use(SiteOriginContext);
  if (origin === null) {
    throw new Error("useSiteOrigin() needs <Providers origin> above it");
  }
  return origin;
}

/** Host of the canonical origin, e.g. "gitbanners.vercel.app". */
export function useSiteHost(): string {
  return new URL(useSiteOrigin()).host;
}

/**
 * What this deployment offers around accounts, decided on the server from
 * its configuration at build time and handed to Client Components, which
 * cannot read server environment variables themselves.
 */
export interface AccountConfig {
  /**
   * Whether "Sign in with GitHub" can work here (`githubSignInAvailable()`).
   * When it cannot, no sign-in control is shown: it would only end on an
   * error.
   */
  signInAvailable: boolean;
  /** The repository whose star unlocks Pro, the one the server checks. */
  proRepo: ProRepoLink;
}

const AccountConfigContext = createContext<AccountConfig | null>(null);

function useAccountConfig(): AccountConfig {
  const config = use(AccountConfigContext);
  if (config === null) {
    throw new Error("Account settings need <Providers account> above them");
  }
  return config;
}

/** False when this deployment cannot sign anyone in. */
export function useSignInAvailable(): boolean {
  return useAccountConfig().signInAvailable;
}

/**
 * The repository to star for Pro. Client Components name it through this
 * hook, never through `site.repo`: the server may check another repository
 * (`PRO_REPO`), and only the server can read that setting.
 */
export function useProRepo(): ProRepoLink {
  return useAccountConfig().proRepo;
}

export interface ProvidersProps {
  /** `site.url`, passed from the root layout (a Server Component). */
  origin: string;
  /** Account settings of the deployment, from the root layout. */
  account: AccountConfig;
  children: React.ReactNode;
}

/**
 * App-wide providers. We provide Astryx's ThemeContext ourselves instead of
 * mounting <Theme>: <Theme> overwrites <html data-theme> on hydration, which
 * would break the no-flash colour mode on statically prerendered pages.
 */
export function Providers({ origin, account, children }: ProvidersProps) {
  const mode = useColorMode();
  // Dev only: StrictMode's remount resets <html> attributes to the JSX ones; re-apply the stored mode.
  useLayoutEffect(() => {
    applyMode(readStoredMode());
  }, []);
  const theme = useMemo(() => ({ theme: neutralTheme, mode }), [mode]);
  return (
    <SiteOriginContext value={origin.replace(/\/+$/, "")}>
      <AccountConfigContext value={account}>
        <ThemeContext value={theme}>
          <LayerProvider toast={{ position: "bottomEnd" }}>
            <LinkProvider component={AppLink}>{children}</LinkProvider>
          </LayerProvider>
        </ThemeContext>
      </AccountConfigContext>
    </SiteOriginContext>
  );
}
