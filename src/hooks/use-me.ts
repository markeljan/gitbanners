"use client";

import { useSyncExternalStore } from "react";
import useSWR from "swr";
import { SESSION_HINT_RE } from "@/components/theme";
import { type Entitlements, FREE } from "@/lib/pro/entitlements";
import { fetchJson } from "./api";

/** A signed-in user as `/api/me` reports them. */
export interface SessionUser {
  /** GitHub's numeric id. The account store keeps it as a string. */
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string;
}

/** Body of `GET /api/me`. */
export interface Me {
  user: SessionUser | null;
  pro: boolean;
  entitlements: Entitlements;
  banners: { count: number; max: number };
}

export const ME_KEY = "/api/me";

/** True when the readable session hint cookie is set in `cookie`. */
export function hasSessionHint(cookie: string): boolean {
  return SESSION_HINT_RE.test(cookie);
}

// Cookies have no change event worth relying on, and they only change on
// full navigations here (sign-in and sign-out both leave the page).
const subscribe = () => () => {};
const clientHint = () => hasSessionHint(document.cookie);
const serverHint = () => false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseUser(value: unknown): SessionUser | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !(typeof value.id === "string" || typeof value.id === "number") ||
    typeof value.login !== "string" ||
    !(value.name === null || typeof value.name === "string") ||
    typeof value.avatarUrl !== "string"
  ) {
    throw new TypeError("Unexpected user in the /api/me body");
  }
  return {
    id: String(value.id),
    login: value.login,
    name: value.name,
    avatarUrl: value.avatarUrl,
  };
}

function parseEntitlements(value: unknown): Entitlements {
  if (
    !isRecord(value) ||
    !(value.plan === "free" || value.plan === "pro") ||
    !isCount(value.maxSavedBanners) ||
    typeof value.canHideBrand !== "boolean" ||
    typeof value.canAnimate !== "boolean" ||
    typeof value.canSetDefault !== "boolean" ||
    !isCount(value.refreshSeconds)
  ) {
    throw new TypeError("Unexpected entitlements in the /api/me body");
  }
  return {
    plan: value.plan,
    maxSavedBanners: value.maxSavedBanners,
    canHideBrand: value.canHideBrand,
    canAnimate: value.canAnimate,
    canSetDefault: value.canSetDefault,
    refreshSeconds: value.refreshSeconds,
  };
}

/**
 * Validates a `/api/me` body. Throws when it is not one.
 *
 * Written by hand, not with a schema library: this hook is part of the site
 * header and so of every page, and a few type checks are not worth making
 * every page download a validator.
 */
export function parseMe(body: unknown): Me {
  if (!isRecord(body) || typeof body.pro !== "boolean") {
    throw new TypeError("Unexpected /api/me body");
  }
  const banners = body.banners;
  if (!isRecord(banners) || !isCount(banners.count) || !isCount(banners.max)) {
    throw new TypeError("Unexpected banner counts in the /api/me body");
  }
  return {
    user: parseUser(body.user),
    pro: body.pro,
    entitlements: parseEntitlements(body.entitlements),
    banners: { count: banners.count, max: banners.max },
  };
}

async function fetchMe(): Promise<Me> {
  return parseMe(await fetchJson(ME_KEY));
}

export interface UseMeResult {
  /**
   * `anonymous`: nobody is signed in (also the server render and the first
   * client render, always). `loading`: the hint cookie exists and `/api/me`
   * has not answered yet. `signed-in`: `user` is set.
   */
  status: "anonymous" | "loading" | "signed-in";
  user: SessionUser | null;
  /** Signed in and has starred the repository. */
  pro: boolean;
  /** Limits of the plan. The free plan until the session is known. */
  entitlements: Entitlements;
  /** Saved banners in use and allowed. */
  banners: { count: number; max: number };
  /** Ask `/api/me` again, for example after saving a banner. */
  refresh: () => void;
}

/**
 * Who is signed in, for Client Components on static pages.
 *
 * Costs nothing for anonymous visitors: `/api/me` is only requested when the
 * `gb_in` hint cookie exists. The first render always reports `anonymous`,
 * so it matches the server HTML; signed-in UI appears right after hydration.
 */
export function useMe(): UseMeResult {
  const hinted = useSyncExternalStore(subscribe, clientHint, serverHint);
  const { data, error, mutate } = useSWR(hinted ? ME_KEY : null, fetchMe, {
    dedupingInterval: 10_000,
    shouldRetryOnError: false,
  });
  const user = data?.user ?? null;
  const status =
    user !== null
      ? "signed-in"
      : hinted && data === undefined && error === undefined
        ? "loading"
        : "anonymous";
  return {
    status,
    user,
    pro: data?.pro ?? false,
    entitlements: data?.entitlements ?? FREE,
    banners: data?.banners ?? { count: 0, max: FREE.maxSavedBanners },
    refresh: () => {
      void mutate();
    },
  };
}
