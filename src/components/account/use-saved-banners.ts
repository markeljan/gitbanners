"use client";

import useSWR, { useSWRConfig } from "swr";
import { fetchJson } from "@/hooks/api";
import { ME_KEY } from "@/hooks/use-me";
import { sendJson as send } from "./request";
import {
  markDefault,
  parseBannerBody,
  parseBannerList,
  removeBanner,
  renameBanner,
  replaceBanner,
  type SavedBanner,
} from "./saved-banners";

export const BANNERS_KEY = "/api/banners";

async function fetchBanners(): Promise<SavedBanner[]> {
  return parseBannerList(await fetchJson(BANNERS_KEY));
}

export interface UseSavedBannersResult {
  /** `undefined` until the first answer. */
  banners: SavedBanner[] | undefined;
  /** Why the list could not be loaded. */
  error: unknown;
  /** The first load is in flight. */
  isLoading: boolean;
  /** Load the list again. */
  reload: () => void;
  /** Each mutation applies at once and rolls back if the server refuses. */
  rename: (id: string, name: string) => Promise<void>;
  setDefault: (id: string, isDefault: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const MUTATION = {
  rollbackOnError: true,
  populateCache: true,
  // Keep the order the visitor is looking at; the next focus refreshes it.
  revalidate: false,
} as const;

/**
 * The signed-in user's saved banners, with optimistic rename, default and
 * delete. Pass `enabled: false` until the session is known: nothing is asked
 * for anonymous visitors.
 *
 * Mutations reject with the server's `ApiProblem` after the list has been
 * rolled back, so the caller only has to say what went wrong.
 */
export function useSavedBanners(enabled: boolean): UseSavedBannersResult {
  const { mutate: mutateKey } = useSWRConfig();
  const { data, error, isLoading, mutate } = useSWR(
    enabled ? BANNERS_KEY : null,
    fetchBanners,
    { shouldRetryOnError: false, dedupingInterval: 5000 },
  );

  const rename = async (id: string, name: string) => {
    await mutate(
      async (current = []) => {
        const banner = parseBannerBody(
          await send(`${BANNERS_KEY}/${id}`, "PATCH", { name }),
        );
        return replaceBanner(current, banner);
      },
      {
        ...MUTATION,
        optimisticData: (current = []) => renameBanner(current, id, name),
      },
    );
  };

  const setDefault = async (id: string, isDefault: boolean) => {
    await mutate(
      async (current = []) => {
        const banner = parseBannerBody(
          await send(`${BANNERS_KEY}/${id}`, "PATCH", { isDefault }),
        );
        return replaceBanner(
          markDefault(current, isDefault ? id : null),
          banner,
        );
      },
      {
        ...MUTATION,
        optimisticData: (current = []) =>
          markDefault(current, isDefault ? id : null),
      },
    );
  };

  const remove = async (id: string) => {
    try {
      await mutate(
        async (current = []) => {
          await send(`${BANNERS_KEY}/${id}`, "DELETE");
          return removeBanner(current, id);
        },
        {
          ...MUTATION,
          optimisticData: (current = []) => removeBanner(current, id),
        },
      );
    } finally {
      // The usage line counts banners; ask again whatever happened.
      void mutateKey(ME_KEY);
    }
  };

  return {
    banners: data,
    error,
    isLoading,
    reload: () => {
      void mutate();
    },
    rename,
    setDefault,
    remove,
  };
}
