import "server-only";

import type { ReactElement, ReactNode } from "react";
import {
  type BannerOptions,
  type BannerTarget,
  type BuiltBanner,
  buildBanner,
  buildMessageBanner,
  collectImages,
  type ImageFormat,
  OPTION_LIMITS,
  resolveCanvas,
  resolveOptions,
  stripProOptions,
  targetLabel,
} from "@/lib/banner";
import { getEntity } from "@/lib/github/cached";
import { isValidYear } from "@/lib/github/calendar";
import { isGitHubError } from "@/lib/github/errors";
import { isStatisticsPending } from "@/lib/github/normalize";
import type { Entity } from "@/lib/github/schema";
import { hasGitHubToken } from "@/lib/github/token";
import { site } from "@/lib/site";
import { animateHeatmap } from "./animate-heatmap";
import { avatarDataUri } from "./avatar";
import { renderPng, renderSvg } from "./engine";
import { fallbackFontsFor } from "./fallback-fonts";

/**
 * The one way a banner image is produced on the server:
 *
 *   target + options -> GitHub data (cached) -> element -> SVG / PNG
 *
 * `renderBanner` never throws and never answers with an empty body. Whatever
 * goes wrong (unknown login, GitHub down, a renderer failure) the caller gets
 * a drawable image plus a `state` to pick cache headers from, because an
 * embedded banner that fails must not turn into a broken image icon.
 */

export type BannerState =
  /** Drawn from complete data. */
  | "ok"
  /** Drawn, but GitHub was still computing part of it: refresh soon. */
  | "provisional"
  /** No such account or public repository. */
  | "not_found"
  /** GitHub is throttling us or down and no earlier copy exists. */
  | "unavailable"
  /** The renderer itself failed. */
  | "error";

export interface BannerRequest {
  target: BannerTarget;
  /** Preset from the URL path or a saved banner, if any. */
  preset: string | null;
  /** Options parsed from the query string or a saved banner. */
  overrides: Partial<BannerOptions>;
  format: ImageFormat;
  /** Honour Pro-only options (no brand mark, animation). */
  pro?: boolean;
  /** PNG pixel density. Ignored for SVG. */
  scale?: 1 | 2 | 3;
  signal?: AbortSignal;
}

export interface RenderedBanner {
  body: string | Uint8Array;
  contentType: string;
  /** Layout size in CSS pixels (a PNG holds `scale` times as many). */
  width: number;
  height: number;
  alt: string;
  state: BannerState;
  /** The entity drawn, with GitHub's own capitalisation. */
  entity: Entity | null;
  /** Options the banner was drawn with (`null` for the last-resort card). */
  options: BannerOptions | null;
  animated: boolean;
}

export const CONTENT_TYPES: Record<ImageFormat, string> = {
  svg: "image/svg+xml; charset=utf-8",
  png: "image/png",
};

const BRAND_HOST = new URL(site.url).host;
/** Avatars are embedded at twice their drawn size so they stay sharp. */
const AVATAR_DENSITY = 2;
const AVATAR_MAX_PX = 460;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Gives the SVG an accessible name: `role`, `aria-label` and a `<title>`. */
function labelSvg(svg: string, alt: string): string {
  if (!alt || !svg.startsWith("<svg")) return svg;
  const label = escapeXml(alt.replace(/\s+/g, " ").trim().slice(0, 500));
  const end = svg.indexOf(">");
  if (end === -1) return svg;
  return `<svg role="img" aria-label="${label}"${svg.slice(4, end + 1)}<title>${label}</title>${svg.slice(end + 1)}`;
}

function elementText(node: ReactNode, out: string[]): void {
  if (typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const child of node) elementText(child, out);
  } else if (node && typeof node === "object" && "props" in node) {
    elementText(
      (node as ReactElement<{ children?: ReactNode }>).props.children,
      out,
    );
  }
}

/** A README-sized card with one line of text, for when Takumi itself fails. */
function lastResortSvg(message: string): string {
  const text = escapeXml(message);
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${text}" width="846" height="120" viewBox="0 0 846 120"><title>${text}</title><rect width="846" height="120" rx="12" fill="#0d1117"/><rect x=".5" y=".5" width="845" height="119" rx="11.5" fill="none" stroke="#3d444d"/><text x="32" y="67" fill="#9198a1" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="16">${text}</text></svg>`;
}

/** 1x1 transparent PNG: the only PNG we can make without the renderer. */
const BLANK_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (char) => char.charCodeAt(0),
);

interface Loaded {
  entity: Entity | null;
  state: BannerState;
}

async function loadEntity(
  target: BannerTarget,
  year: number | null,
): Promise<Loaded> {
  try {
    const entity = await getEntity(target, year);
    if (!entity) return { entity: null, state: "not_found" };
    const pending =
      isStatisticsPending(entity) ||
      // A user whose slow path failed is drawn without totals: try again soon.
      (entity.kind === "user" && !entity.complete && hasGitHubToken());
    return { entity, state: pending ? "provisional" : "ok" };
  } catch (error) {
    if (!isGitHubError(error)) {
      console.error("[banner] data error", error);
    }
    return { entity: null, state: "unavailable" };
  }
}

function messageFor(
  target: BannerTarget,
  state: BannerState,
): { title: string; detail: string } {
  if (state === "not_found") {
    return target.kind === "owner"
      ? {
          title: `@${target.login} is not on GitHub`,
          detail: "Check the spelling of the username or organization.",
        }
      : {
          title: `${targetLabel(target)} was not found`,
          detail: "The repository is private, was renamed or does not exist.",
        };
  }
  return {
    title: "GitHub is not answering right now",
    detail: "This banner refreshes on its own in a moment.",
  };
}

/**
 * PNG pixel density. README cards are shown at their layout width on high-
 * density screens, so they default to 2x; the fixed social sizes are uploaded
 * as files and must keep their exact pixel dimensions. The result never
 * exceeds the renderer's pixel budget.
 */
function pngScale(
  built: BuiltBanner,
  options: BannerOptions | null,
  asked: 1 | 2 | 3 | undefined,
): 1 | 2 | 3 {
  const automatic = options !== null && resolveCanvas(options).height === null;
  let scale: 1 | 2 | 3 = asked ?? (automatic ? 2 : 1);
  while (
    scale > 1 &&
    built.width * built.height * scale * scale > OPTION_LIMITS.pixels
  ) {
    scale = (scale - 1) as 1 | 2;
  }
  return scale;
}

interface DrawRequest {
  format: ImageFormat;
  scale?: 1 | 2 | 3;
  signal?: AbortSignal;
}

async function draw(
  built: BuiltBanner,
  request: DrawRequest,
  options: BannerOptions | null,
  animate: boolean,
): Promise<{ body: string | Uint8Array; animated: boolean }> {
  const strings: string[] = [];
  elementText(built.element, strings);
  const fonts = await fallbackFontsFor(strings.join("\n"));
  const size = { width: built.width, height: built.height, fonts };

  if (request.format === "png") {
    const body = await renderPng(built.element, {
      ...size,
      scale: pngScale(built, options, request.scale),
      signal: request.signal,
    });
    return { body, animated: false };
  }

  let svg = await renderSvg(built.element, { ...size, signal: request.signal });
  let animated = false;
  if (animate && built.heatmap) {
    const result = animateHeatmap(svg, {
      cell: built.heatmap.cell,
      radius: built.heatmap.radius,
      gap: built.heatmap.gap,
      colors: built.heatmap.colors,
      expected: built.heatmap.cells,
    });
    svg = result.svg;
    animated = result.engine !== "none";
  }
  return { body: labelSvg(svg, built.alt), animated };
}

/**
 * Renders one banner. Total: resolves with an image in every case.
 *
 * Options that need Pro are dropped unless `request.pro` is set; an invalid
 * `year` is ignored rather than reported, like every other option.
 */
export async function renderBanner(
  request: BannerRequest,
): Promise<RenderedBanner> {
  const now = new Date();
  const overrides: Partial<BannerOptions> = request.pro
    ? { ...request.overrides }
    : stripProOptions({ ...request.overrides });
  if (
    overrides.year != null &&
    (request.target.kind !== "owner" || !isValidYear(overrides.year, now))
  ) {
    overrides.year = null;
  }

  const { entity, state } = await loadEntity(
    request.target,
    overrides.year ?? null,
  );

  try {
    if (!entity) {
      const options = resolveOptions("user", null, overrides);
      const built = buildMessageBanner(
        messageFor(request.target, state),
        options,
        { image: () => "", now, host: BRAND_HOST },
      );
      const { body } = await draw(built, request, options, false);
      return {
        body,
        contentType: CONTENT_TYPES[request.format],
        width: built.width,
        height: built.height,
        alt: built.alt,
        state,
        entity: null,
        options,
        animated: false,
      };
    }

    const options = resolveOptions(entity.kind, request.preset, overrides);
    const env = { now, host: BRAND_HOST };
    const density =
      request.format === "png"
        ? Math.max(AVATAR_DENSITY, request.scale ?? 1)
        : AVATAR_DENSITY;
    const wanted = collectImages(entity, options, env);
    const fetched = await Promise.all(
      wanted.map(({ url, px }) =>
        avatarDataUri(url, Math.min(AVATAR_MAX_PX, Math.ceil(px * density))),
      ),
    );
    const images = new Map<string, string>();
    wanted.forEach(({ url }, index) => {
      const data = fetched[index];
      if (data) images.set(url, data);
    });

    const built = buildBanner(entity, options, {
      ...env,
      image: (url) => images.get(url) ?? "",
    });
    const { body, animated } = await draw(
      built,
      request,
      options,
      options.animate,
    );
    return {
      body,
      contentType: CONTENT_TYPES[request.format],
      width: built.width,
      height: built.height,
      alt: built.alt,
      state,
      entity,
      options,
      animated,
    };
  } catch (error) {
    console.error("[banner] render error", error);
    return lastResort(request.format, entity);
  }
}

function lastResort(
  format: ImageFormat,
  entity: Entity | null = null,
): RenderedBanner {
  const message = "This banner could not be drawn. It will retry shortly.";
  return {
    body: format === "png" ? BLANK_PNG : lastResortSvg(message),
    contentType: CONTENT_TYPES[format],
    width: format === "png" ? 1 : 846,
    height: format === "png" ? 1 : 120,
    alt: message,
    state: "error",
    entity,
    options: null,
    animated: false,
  };
}

export interface MessageRequest extends DrawRequest {
  message: { title: string; detail?: string | null };
  /** What the card stands for; picks the cache lifetime. */
  state: Exclude<BannerState, "ok" | "provisional">;
  /** Size and theme to draw the card in. */
  overrides?: Partial<BannerOptions>;
}

/** A card that carries a message instead of data. Total, like `renderBanner`. */
export async function renderMessage(
  request: MessageRequest,
): Promise<RenderedBanner> {
  try {
    const options = resolveOptions(
      "user",
      null,
      stripProOptions({ ...request.overrides }),
    );
    const built = buildMessageBanner(request.message, options, {
      image: () => "",
      now: new Date(),
      host: BRAND_HOST,
    });
    const { body } = await draw(built, request, options, false);
    return {
      body,
      contentType: CONTENT_TYPES[request.format],
      width: built.width,
      height: built.height,
      alt: built.alt,
      state: request.state,
      entity: null,
      options,
      animated: false,
    };
  } catch (error) {
    console.error("[banner] render error", error);
    return lastResort(request.format);
  }
}
