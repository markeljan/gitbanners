"use client";

import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useBanner } from "@/components/banner/banner-canvas";
import { useSiteOrigin } from "@/components/providers";
import { targetKey } from "@/hooks/targets";
import { type EntityState, useEntity } from "@/hooks/use-entity";
import { rememberRecentTarget } from "@/hooks/use-recent-targets";
import {
  type BannerOptions,
  type BannerTarget,
  type BuiltBanner,
  DEFAULT_THEME_ID,
  diffOptions,
  getPreset,
  resolveOptions,
  serializeOptions,
  targetOf,
} from "@/lib/banner";
import { type BannerLinks, bannerLinks, targetSlug } from "@/lib/embed";
import { SAMPLE_USER } from "@/lib/github/samples";
import type { Entity } from "@/lib/github/schema";

/**
 * The homepage's one piece of interactive state: which banner the visitor is
 * looking at. The hero's input and preset tabs write it, the theme strip
 * further down the page writes it too, and every preview on the page draws
 * from it, so a theme picked at the bottom is the theme of the URL copied at
 * the top.
 */
export interface HomePreview {
  /** Text in the target input. */
  text: string;
  setText: (text: string) => void;
  /**
   * Show a target. `commit` marks a deliberate choice (Enter, a picked
   * suggestion, an example), which is also remembered as a recent target.
   */
  show: (target: BannerTarget, commit: boolean) => void;
  /** Preset on screen: the wanted one, or the kind's default when the kind has no such preset. */
  preset: string;
  setPreset: (preset: string) => void;
  theme: string;
  setTheme: (theme: string) => void;
  /** The entity drawn. Never missing: the page starts on the bundled sample. */
  entity: Entity;
  /** Target of `entity`, with GitHub's capitalisation. */
  target: BannerTarget;
  /** The target asked for, which may still be loading or may not exist. */
  requested: BannerTarget;
  options: BannerOptions;
  banner: BuiltBanner;
  /** Canonical option query of the banner, without "?". */
  query: string;
  links: BannerLinks;
  /** Loading and failure of the requested target. */
  state: EntityState;
  /**
   * False until the visitor changes anything. Until then the hero shows the
   * server-rendered image and no request is made.
   */
  touched: boolean;
}

const HomePreviewContext = createContext<HomePreview | null>(null);

export function useHomePreview(): HomePreview {
  const preview = use(HomePreviewContext);
  if (!preview) {
    throw new Error("useHomePreview() needs <HomePreviewProvider> above it");
  }
  return preview;
}

/** The profile the homepage opens on, drawn from bundled data. */
export const HOME_ENTITY = SAMPLE_USER;
const HOME_TARGET = targetOf(HOME_ENTITY);

function titleOf(entity: Entity): string | null {
  return entity.kind === "repo" ? entity.description : entity.name;
}

function avatarOf(entity: Entity): string {
  return entity.kind === "repo" ? entity.owner.avatarUrl : entity.avatarUrl;
}

export function HomePreviewProvider({ children }: { children: ReactNode }) {
  const origin = useSiteOrigin();
  const [text, setText] = useState("");
  const [requested, setRequested] = useState<BannerTarget>(HOME_TARGET);
  const [committed, setCommitted] = useState<string | null>(null);
  const [wantedPreset, setWantedPreset] = useState<string | null>(null);
  const [theme, setThemeId] = useState<string>(DEFAULT_THEME_ID);
  const [touched, setTouched] = useState(false);

  const state = useEntity(requested, { live: touched });
  const entity = state.entity ?? HOME_ENTITY;
  const kind = entity.kind;
  const preset = getPreset(kind, wantedPreset).id;
  const options = useMemo(
    () => resolveOptions(kind, preset, { theme }),
    [kind, preset, theme],
  );
  const banner = useBanner(entity, options);
  const target = useMemo(() => targetOf(entity), [entity]);
  const query = useMemo(
    () => serializeOptions(diffOptions(kind, options)),
    [kind, options],
  );
  const links = useMemo(
    () => bannerLinks({ target, preset, query, origin }),
    [target, preset, query, origin],
  );

  // A deliberately chosen target is remembered once GitHub has answered, with
  // its real name, kind and avatar (the input could only guess them).
  const isCommittedOnScreen =
    state.isCurrent && committed === targetKey(requested);
  useEffect(() => {
    if (!isCommittedOnScreen) return;
    rememberRecentTarget({
      slug: targetSlug(targetOf(entity)),
      kind: entity.kind,
      title: titleOf(entity),
      avatarUrl: avatarOf(entity),
    });
  }, [isCommittedOnScreen, entity]);

  const value: HomePreview = {
    text,
    setText,
    show: (next, commit) => {
      setRequested(next);
      setTouched(true);
      if (commit) setCommitted(targetKey(next));
    },
    preset,
    setPreset: (next) => {
      setWantedPreset(next);
      setTouched(true);
    },
    theme,
    setTheme: (next) => {
      setThemeId(next);
      setTouched(true);
    },
    entity,
    target,
    requested,
    options,
    banner,
    query,
    links,
    state,
    touched,
  };
  return <HomePreviewContext value={value}>{children}</HomePreviewContext>;
}
