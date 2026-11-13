"use client";

import { useSearchParams } from "next/navigation";
import {
  createContext,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWR, { useSWRConfig } from "swr";
import { buildBrowserBanner } from "@/components/banner/build";
import { preloadBannerFonts } from "@/components/banner/fonts";
import { browserImage } from "@/components/banner/scale";
import { useSiteHost } from "@/components/providers";
import { fetchJson } from "@/hooks/api";
import {
  type EntityFailure,
  type EntityState,
  useEntity,
} from "@/hooks/use-entity";
import { type UseMeResult, useMe } from "@/hooks/use-me";
import {
  type BannerOptions,
  type BannerTarget,
  type BuiltBanner,
  buildMessageBanner,
  type EntityKind,
  parseOptions,
  targetOf,
} from "@/lib/banner";
import { targetSlug } from "@/lib/embed";
import { SAMPLE_USER } from "@/lib/github/samples";
import { type Entity, EntitySchema } from "@/lib/github/schema";
import { loadBanner, type SavedBanner } from "./saved";
import {
  bannerQuery,
  type ColorField,
  parseStudioSearch,
  presetFor,
  publicQuery,
  resetOptions,
  resolveStudio,
  type StudioState,
  sameSearch,
  studioSearch,
  withColor,
  withOptions,
  withPreset,
  withTarget,
} from "./state";

/** The profile the studio opens on: bundled, so the first banner costs nothing. */
const SAMPLE_TARGET = targetOf(SAMPLE_USER);
/** Pause after the last change before the address bar follows. */
const URL_THROTTLE_MS = 250;
/** Changes of one control closer together than this are one undo step. */
const COALESCE_MS = 800;
const MAX_UNDO = 100;

interface History {
  past: StudioState[];
  present: StudioState;
  future: StudioState[];
}

/** A problem with what is on screen, said next to the canvas. */
export interface StudioNotice {
  tone: "error" | "warning";
  title: string;
  description: string;
  /** Asking again can help. */
  canRetry: boolean;
}

export interface Studio {
  state: StudioState;
  /** Kind of the entity on screen. */
  kind: EntityKind;
  /** The entity drawn: the requested one, or the last that loaded. */
  entity: Entity | null;
  /** Target of the entity on screen, with GitHub's capitalisation. */
  target: BannerTarget;
  /** The target asked for: `state.target`, or the sample profile. */
  requested: BannerTarget;
  preset: string;
  options: BannerOptions;
  banner: BuiltBanner;
  /** Canonical option query of the banner, Pro options included. */
  query: string;
  /** Option query for public links: Pro options left out. */
  linkQuery: string;
  /** The current studio address, path and query. */
  href: string;
  /** Something new is loading: the banner on screen is the previous one. */
  isPending: boolean;
  notice: StudioNotice | null;
  retry: () => void;
  entityState: EntityState;

  /** Text in the target field. */
  text: string;
  setText: (text: string) => void;
  /**
   * Show a target. `commit` (Enter, a picked suggestion) makes a new
   * history entry; a live preview while typing replaces the current one.
   */
  setTarget: (target: BannerTarget, commit?: boolean) => void;
  setPreset: (preset: string) => void;
  /** `group` merges rapid changes of one control into one undo step. */
  setOptions: (patch: Partial<BannerOptions>, group?: string) => void;
  setColor: (field: ColorField, hex: string | null) => void;
  reset: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  me: UseMeResult;
  saved: {
    banner: SavedBanner | null;
    isLoading: boolean;
    /** `GET /api/banners/{id}` failed: the code of the problem. */
    failure: string | null;
  };
  /** After a save: edit that banner from now on. */
  adoptSaved: (banner: SavedBanner) => void;
  /** Stop editing the saved banner; keep everything else. */
  detachSaved: () => void;
}

const StudioContext = createContext<Studio | null>(null);
export const StudioProvider = StudioContext.Provider;

export function useStudioContext(): Studio {
  const studio = use(StudioContext);
  if (!studio) throw new Error("useStudioContext() needs <StudioProvider>");
  return studio;
}

async function fetchEntity(url: string): Promise<Entity> {
  const parsed = EntitySchema.safeParse(await fetchJson(url));
  if (!parsed.success) throw new Error("Unexpected entity body");
  return parsed.data;
}

/**
 * The entity of one calendar year. Only a user's banner has a year; the
 * last 12 months come from `useEntity`.
 */
function useYearEntity(login: string | null, year: number | null) {
  const url =
    login && year
      ? `/api/v1/owners/${encodeURIComponent(login.toLowerCase())}?year=${year}`
      : null;
  return useSWR(url, fetchEntity, {
    dedupingInterval: 60_000,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
  });
}

function failureNotice(
  failure: EntityFailure,
  asked: string,
  shown: string | null,
  isRepo: boolean,
): StudioNotice {
  switch (failure) {
    case "not_found":
      return {
        tone: "error",
        title: isRepo
          ? `No public repository named ${asked}`
          : `No GitHub account named ${asked}`,
        description: isRepo
          ? "Check the spelling. Private repositories cannot be shown."
          : "Check the spelling, or try owner/repo for a repository.",
        canRetry: false,
      };
    case "invalid":
      return {
        tone: "error",
        title: `${asked} is not a GitHub username or owner/repo`,
        description: "Type a username, or owner/repo for a repository.",
        canRetry: false,
      };
    default:
      return {
        tone: "warning",
        title: "GitHub is slow to answer right now",
        description: shown
          ? `Still showing ${shown}. Try again in a moment.`
          : "Try again in a moment.",
        canRetry: true,
      };
  }
}

function savedState(banner: SavedBanner): StudioState {
  return {
    target: banner.target,
    preset: banner.preset,
    overrides: parseOptions(new URLSearchParams(banner.query)),
    bannerId: banner.id,
  };
}

/**
 * Everything the studio shows and every way to change it.
 *
 * The state lives in React and is mirrored into the address bar (replaced,
 * throttled; a new target is a new history entry), so controls repaint in
 * the same frame and the address never lags far behind. Back and forward,
 * and links into the studio, are read back from the address.
 */
export function useStudio(): Studio {
  const host = useSiteHost();
  const params = useSearchParams();
  const urlSearch = params.toString();
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    present: parseStudioSearch(urlSearch),
    future: [],
  }));
  const state = history.present;
  const [text, setText] = useState(() =>
    state.target ? targetSlug(state.target) : "",
  );

  // ── Data ────────────────────────────────────────────────────────────────
  const requested = state.target ?? SAMPLE_TARGET;
  const entityState = useEntity(requested, { live: state.target !== null });
  const base = entityState.entity;
  const baseKind: EntityKind =
    base?.kind ?? (requested.kind === "repo" ? "repo" : "user");
  // While another target loads, its kind is known for repositories only.
  const kind: EntityKind =
    requested.kind === "repo"
      ? "repo"
      : baseKind === "repo"
        ? "user"
        : baseKind;
  const options = useMemo(() => resolveStudio(kind, state), [kind, state]);
  const preset = presetFor(kind, state);

  const yearLogin =
    kind === "user" && entityState.isCurrent && requested.kind === "owner"
      ? requested.login
      : null;
  const yearEntity = useYearEntity(yearLogin, options.year);
  const hasYear = yearLogin !== null && options.year !== null;
  const entity =
    hasYear && yearEntity.data && base && yearEntity.data.kind === base.kind
      ? yearEntity.data
      : base;
  const isYearPending =
    hasYear && yearEntity.data === undefined && !yearEntity.error;

  const target = useMemo(
    () => (entity ? targetOf(entity) : requested),
    [entity, requested],
  );
  const asked = targetSlug(requested);
  const shown = entity ? targetSlug(targetOf(entity)) : null;

  let notice: StudioNotice | null = null;
  if (entityState.failure && state.target) {
    notice = failureNotice(
      entityState.failure,
      asked,
      entityState.isCurrent ? null : shown,
      requested.kind === "repo",
    );
  } else if (hasYear && yearEntity.error) {
    notice = {
      tone: "warning",
      title: `The ${options.year} calendar did not load`,
      description: "Showing the last 12 months instead. Try again in a moment.",
      canRetry: true,
    };
  }

  const banner = useMemo(() => {
    if (entity) return buildBrowserBanner(entity, options, host);
    const env = { image: browserImage, now: new Date(0), host };
    const failure = entityState.failure;
    const title =
      failure === "not_found"
        ? requested.kind === "repo"
          ? `No public repository named ${asked}`
          : `No GitHub account named ${asked}`
        : failure
          ? "GitHub is not answering"
          : `Loading ${asked}`;
    return buildMessageBanner({ title }, options, env);
  }, [entity, options, host, entityState.failure, requested.kind, asked]);

  const isPending =
    entityState.isLoading ||
    (!entityState.isCurrent && entityState.failure === null) ||
    isYearPending;

  // The typeface of the banner, before it is needed.
  useEffect(() => {
    void preloadBannerFonts(options.font);
  }, [options.font]);

  // ── Account and the saved banner being edited ───────────────────────────
  const me = useMe();
  const { mutate } = useSWRConfig();
  const savedKey =
    state.bannerId && me.status === "signed-in"
      ? `/api/banners/${state.bannerId}`
      : null;
  const savedId = state.bannerId;
  const saved = useSWR(
    savedKey,
    () => (savedId ? loadBanner(savedId) : Promise.reject(new Error("none"))),
    {
      // A saved banner only changes when this page saves it.
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    },
  );

  // ── Changes and undo ────────────────────────────────────────────────────
  const lastGroup = useRef<{ group: string; at: number } | null>(null);
  const pushNext = useRef(false);
  // True while the current history entry belongs to a target shown as a
  // live preview while typing: further previews and the final choice
  // replace it instead of piling up entries.
  const entryIsPreview = useRef(false);

  const commit = (
    change: (current: StudioState) => StudioState,
    group?: string,
    push = false,
  ) => {
    const next = change(history.present);
    if (next === history.present) return;
    const now = Date.now();
    const previous = lastGroup.current;
    const merge =
      group !== undefined &&
      previous?.group === group &&
      now - previous.at < COALESCE_MS;
    lastGroup.current = group ? { group, at: now } : null;
    if (push) pushNext.current = true;
    setHistory({
      past: merge
        ? history.past
        : [...history.past, history.present].slice(-MAX_UNDO),
      present: next,
      future: [],
    });
  };

  // Saved banner opened by id alone: its options become the studio's.
  const loaded = saved.data;
  const appliedSaved = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded || appliedSaved.current === loaded.id) return;
    appliedSaved.current = loaded.id;
    setHistory((current) => {
      // Options in the address are newer than the stored ones: unsaved edits.
      if (current.present.target !== null) return current;
      return { ...current, present: savedState(loaded) };
    });
    setText((current) => current || targetSlug(loaded.target));
  }, [loaded]);

  // ── The address bar ─────────────────────────────────────────────────────
  const search = studioSearch(kind, state);
  const href = search ? `/studio?${search}` : "/studio";
  const lastWritten = useRef(urlSearch);
  const pending = useRef<{
    timer: ReturnType<typeof setTimeout>;
    url: string;
  } | null>(null);
  const external = useRef(false);

  useEffect(() => {
    const onPop = () => {
      external.current = true;
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = null;
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = null;
    };
  }, []);

  useEffect(() => {
    if (sameSearch(search, window.location.search)) {
      lastWritten.current = search;
      return;
    }
    const url = `${window.location.pathname}${search ? `?${search}` : ""}`;
    lastWritten.current = search;
    if (pushNext.current) {
      pushNext.current = false;
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = null;
      window.history.pushState(null, "", url);
      return;
    }
    if (pending.current) {
      pending.current.url = url;
      return;
    }
    const entry = {
      url,
      timer: setTimeout(() => {
        pending.current = null;
        window.history.replaceState(null, "", entry.url);
      }, URL_THROTTLE_MS),
    };
    pending.current = entry;
  }, [search]);

  // Back, forward, or a link to the studio: the address leads.
  useEffect(() => {
    const isOurs =
      !external.current && sameSearch(urlSearch, lastWritten.current);
    external.current = false;
    if (isOurs) return;
    const next = parseStudioSearch(urlSearch);
    lastWritten.current = urlSearch;
    entryIsPreview.current = false;
    // The browser's history owns navigation; undo covers edits made since.
    setHistory({ past: [], present: next, future: [] });
    setText(next.target ? targetSlug(next.target) : "");
  }, [urlSearch]);

  const undo = () => {
    const previous = history.past.at(-1);
    if (!previous) return;
    lastGroup.current = null;
    setHistory({
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future],
    });
    setText(previous.target ? targetSlug(previous.target) : "");
  };
  const redo = () => {
    const next = history.future[0];
    if (!next) return;
    lastGroup.current = null;
    setHistory({
      past: [...history.past, history.present],
      present: next,
      future: history.future.slice(1),
    });
    setText(next.target ? targetSlug(next.target) : "");
  };

  return {
    state,
    kind,
    entity,
    target,
    requested,
    preset,
    options,
    banner,
    query: bannerQuery(kind, state),
    linkQuery: publicQuery(kind, state),
    href,
    isPending,
    notice,
    retry: () => {
      entityState.retry();
      void yearEntity.mutate();
    },
    entityState,
    text,
    setText,
    setTarget: (next, isCommit = true) => {
      const changed = withTarget(history.present, next) !== history.present;
      if (changed) {
        commit(
          (current) => withTarget(current, next),
          isCommit ? undefined : "target",
          !entryIsPreview.current,
        );
      }
      entryIsPreview.current = !isCommit && (changed || entryIsPreview.current);
    },
    setPreset: (next) => commit((current) => withPreset(kind, current, next)),
    setOptions: (patch, group) =>
      commit((current) => withOptions(kind, current, patch), group),
    setColor: (field, hex) =>
      commit(
        (current) => withColor(kind, current, field, hex),
        `color:${field}`,
      ),
    reset: () => commit(resetOptions),
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    me,
    saved: {
      banner: saved.data ?? null,
      isLoading: savedKey !== null && saved.isLoading,
      failure:
        saved.error && typeof saved.error === "object" && "code" in saved.error
          ? String(saved.error.code)
          : saved.error
            ? "unavailable"
            : null,
    },
    adoptSaved: (next) => {
      appliedSaved.current = next.id;
      // The answer is the banner: no need to ask for it again.
      void mutate(`/api/banners/${next.id}`, next, { revalidate: false });
      commit((current) => ({ ...current, bannerId: next.id }));
    },
    detachSaved: () => commit((current) => ({ ...current, bannerId: null })),
  };
}
