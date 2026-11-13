"use client";

import { useSyncExternalStore } from "react";
import useSWR from "swr";
import { z } from "zod";
import { SESSION_HINT_RE } from "@/components/theme";
import { type Entitlements, FREE } from "@/lib/pro/entitlements";
import { fetchJson } from "./api";

const MeSchema = z.object({
  user: z
    .object({
      id: z.number(),
      login: z.string(),
      name: z.string().nullable(),
      avatarUrl: z.string(),
    })
    .nullable(),
  pro: z.boolean(),
  entitlements: z.object({
    plan: z.enum(["free", "pro"]),
    maxSavedBanners: z.number(),
    canHideBrand: z.boolean(),
    canAnimate: z.boolean(),
    canSetDefault: z.boolean(),
    refreshSeconds: z.number(),
  }),
  banners: z.object({ count: z.number(), max: z.number() }),
});

/** Body of `GET /api/me`. */
export type Me = z.infer<typeof MeSchema>;
export type SessionUser = NonNullable<Me["user"]>;

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

async function fetchMe(): Promise<Me> {
  return MeSchema.parse(await fetchJson(ME_KEY));
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
