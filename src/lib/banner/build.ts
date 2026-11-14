"use no memo";

import type { ReactElement, ReactNode } from "react";
import { altText } from "@/lib/banner/alt";
import { resolveCanvas } from "@/lib/banner/canvas";
import { type Ctx, imageResolver, makeRamp } from "@/lib/banner/context";
import { box, type Node, root } from "@/lib/banner/draw";
import { getFont, strongWeight } from "@/lib/banner/fonts";
import { resolveSections } from "@/lib/banner/graph";
import { layoutCard } from "@/lib/banner/layout/card";
import { layoutMessage } from "@/lib/banner/layout/message";
import { layoutPoster } from "@/lib/banner/layout/poster";
import { layoutSocial } from "@/lib/banner/layout/social";
import type { Layout } from "@/lib/banner/layout/types";
import { layoutWrapped } from "@/lib/banner/layout/wrapped";
import { DEFAULT_OPTIONS, normalizeOptions } from "@/lib/banner/options";
import { resolvePalette } from "@/lib/banner/palette";
import { getPreset } from "@/lib/banner/presets";
import type {
  BannerOptions,
  BuiltBanner,
  EntityKind,
  RenderEnv,
  SectionId,
} from "@/lib/banner/types";
import type { Entity } from "@/lib/github/schema";

/**
 * The banner builder: (entity data, resolved options, environment) -> one
 * React element with explicit pixel layout.
 *
 * Pure and isomorphic: the same call runs on the server (where the element is
 * rendered to SVG / PNG) and in the browser (where it is mounted as DOM for
 * the studio's instant preview). Nothing here reads the clock, the network or
 * the DOM; whatever varies comes in through `env`.
 */

/** A message card has no entity; it borrows the user defaults. */
const MESSAGE_KIND: EntityKind = "user";

/**
 * Options as the builder trusts them. Callers normally pass the output of
 * `resolveOptions`, but hand-built or stale options (a saved banner from an
 * older version) must draw too: every field is re-validated and whatever is
 * invalid falls back to "decide automatically".
 */
function trustedOptions(
  kind: EntityKind,
  options: BannerOptions | null | undefined,
): BannerOptions {
  const clean = normalizeOptions(options);
  return {
    ...DEFAULT_OPTIONS,
    ...clean,
    preset: getPreset(kind, options?.preset).id,
    colors: { ...clean.colors },
    hide: clean.hide ?? [],
  };
}

/**
 * Everything sections and layouts need to plan a banner: the canvas, the
 * colours, the type scale and the injected environment. `options` must be
 * resolved already (`buildBanner` re-validates them before it gets here).
 */
export function contextOf(
  entity: Entity,
  options: BannerOptions,
  env: RenderEnv,
): Ctx {
  const canvas = resolveCanvas(options);
  const font = getFont(options.font);
  const now = env?.now instanceof Date ? env.now : new Date(0);
  return {
    entity,
    options,
    canvas,
    palette: resolvePalette(options),
    font,
    ramp: makeRamp(
      canvas.unit,
      canvas.minType,
      strongWeight(font),
      canvas.chrome,
    ),
    hide: new Set(options.hide),
    image: imageResolver(env),
    host: typeof env?.host === "string" ? env.host : "",
    now,
  };
}

function finish(ctx: Ctx, layout: Layout, alt: string): BuiltBanner {
  const { canvas, palette, ramp } = ctx;
  const width = Math.round(layout.width);
  const height = Math.round(layout.height);
  const children: Node[] = [...layout.nodes];
  if (canvas.border) {
    // Drawn last and as its own box: a border on the root would shift every
    // absolutely positioned child by its width.
    children.push(
      box(0, 0, width, height, {
        border: `${ramp.hair}px solid ${palette.colors.border}`,
        borderRadius: canvas.radius,
      }),
    );
  }
  return {
    width,
    height,
    element: root(
      {
        width,
        height,
        background: palette.colors.bg,
        color: palette.colors.text,
        family: ctx.font.family,
        radius: canvas.radius,
      },
      children,
    ),
    alt,
    font: ctx.font,
    theme: palette.theme,
    heatmap: layout.heatmap,
  };
}

/**
 * Posters: banners with a composition of their own. Each one decides whether
 * it applies to this banner and canvas, and answers `null` when it does not.
 */
const POSTERS: readonly ((
  ctx: Ctx,
  sections: readonly SectionId[],
) => Layout | null)[] = [layoutWrapped, layoutSocial];

/** What the year in review falls back to on a canvas too small for the poster. */
const WRAPPED_FALLBACK: readonly SectionId[] = ["header", "stats", "heatmap"];

/**
 * Picks the layout: a poster where one applies, otherwise the general
 * layouts (cards grow with their content, fixed canvases are solved).
 */
function layoutOf(ctx: Ctx, sections: readonly SectionId[]): Layout {
  for (const poster of POSTERS) {
    const layout = poster(ctx, sections);
    if (layout) return layout;
  }
  const general = [
    ...new Set(
      sections.flatMap((id) => (id === "wrapped" ? WRAPPED_FALLBACK : [id])),
    ),
  ];
  return ctx.canvas.height === null
    ? layoutCard(ctx, general)
    : layoutPoster(ctx, general);
}

/**
 * Builds the banner for an entity. Total: any entity that matches the schema
 * and any options at all produce a banner; sections that do not apply to the
 * entity's kind are skipped.
 */
export function buildBanner(
  entity: Entity,
  options: BannerOptions,
  env: RenderEnv,
): BuiltBanner {
  const trusted = trustedOptions(entity.kind, options);
  const ctx = contextOf(entity, trusted, env);
  const sections = resolveSections(
    ctx,
    trusted.sections ?? getPreset(entity.kind, trusted.preset).sections,
  );
  return finish(ctx, layoutOf(ctx, sections), altText(entity, trusted));
}

/**
 * A card that carries a message instead of data, in the requested theme and
 * size: "No GitHub account named {login}", "GitHub is not answering.
 * Retrying soon.". Image routes answer with it (and HTTP 200) so an embedded
 * banner never turns into a broken image.
 */
export function buildMessageBanner(
  message: { title: string; detail?: string | null },
  options: BannerOptions,
  env: RenderEnv,
): BuiltBanner {
  const trusted = trustedOptions(MESSAGE_KIND, options);
  // The card only needs the canvas, colours and type: a stand-in entity keeps
  // the context shape without inventing data.
  const ctx = contextOf(PLACEHOLDER, trusted, env);
  const title = String(message?.title ?? "").trim();
  const detail = String(message?.detail ?? "").trim();
  const layout = layoutMessage(ctx, { title, detail });
  return finish(ctx, layout, [title, detail].filter(Boolean).join(". "));
}

const PLACEHOLDER: Entity = {
  kind: "user",
  login: "",
  id: 0,
  name: null,
  avatarUrl: "",
  bio: null,
  company: null,
  location: null,
  websiteUrl: null,
  twitter: null,
  pronouns: null,
  createdAt: "",
  followers: 0,
  following: 0,
  stats: {
    contributions: 0,
    commits: null,
    pullRequests: null,
    issues: null,
    reviews: null,
    contributedTo: null,
    repositories: 0,
    stars: null,
  },
  calendar: { total: 0, from: "", to: "", days: [] },
  streak: {
    current: 0,
    currentStart: null,
    longest: 0,
    longestStart: null,
    longestEnd: null,
  },
  bestDay: null,
  years: [],
  repos: [],
  languages: [],
  organizations: [],
  wrapped: null,
  complete: true,
  fetchedAt: "",
};

/**
 * Remote images the banner will draw, with the size each is drawn at. The
 * server fetches them first and hands them back as data URIs through
 * `env.image`; inline `data:` sources are not listed.
 */
export function collectImages(
  entity: Entity,
  options: BannerOptions,
  env: Omit<RenderEnv, "image">,
): Array<{ url: string; px: number }> {
  const seen = new Map<string, number>();
  buildBanner(entity, options, {
    ...env,
    image(url, px) {
      seen.set(url, Math.max(seen.get(url) ?? 0, px));
      return "";
    },
  });
  return [...seen].map(([url, px]) => ({ url, px }));
}

function collectText(node: ReactNode, out: string[]): void {
  if (typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
  } else if (node && typeof node === "object" && "props" in node) {
    collectText(
      (node as ReactElement<{ children?: ReactNode }>).props.children,
      out,
    );
  }
}

/**
 * Every string the banner will draw, joined by line breaks: what the
 * fallback-font loader needs to find the scripts Mona Sans cannot draw. It is
 * read off a dry build, so it is exactly the text of the image, nothing more.
 */
export function bannerText(entity: Entity, options: BannerOptions): string {
  const built = buildBanner(entity, options, {
    image: () => "",
    now: new Date(0),
    host: "",
  });
  const out: string[] = [];
  collectText(built.element, out);
  return out.join("\n");
}
