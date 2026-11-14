import type { ReactElement } from "react";
import { render, renderSvg as takumiRenderSvg } from "takumi-js";
import { Renderer } from "takumi-js/node";
import { type BannerFont, loadBaseFonts } from "./fonts";

/**
 * One Renderer per server instance: base fonts are parsed once and stay registered;
 * decoded images and glyphs are cached inside it.
 */
let rendererPromise: Promise<Renderer> | undefined;
export function getRenderer(): Promise<Renderer> {
  rendererPromise ??= (async () => {
    const renderer = new Renderer({
      cacheMaxBytes: 32 * 1024 * 1024, // decoded images / SVG rasters
      fontCacheMaxBytes: 16 * 1024 * 1024, // per-render (fallback) fonts are LRU-evicted past this
    });
    // sequential: registration order is the fallback order
    for (const font of await loadBaseFonts()) await renderer.registerFont(font);
    return renderer;
  })().catch((err) => {
    rendererPromise = undefined;
    throw err;
  });
  return rendererPromise;
}

/** Engine-initiated fetches: only Twemoji SVGs (avatars are passed as data: URIs). */
const IMAGES = {
  timeout: 2500,
  maxBytes: 256 * 1024,
  throwOnError: false,
  allowUrl: (url: string) =>
    url.startsWith("https://cdn.jsdelivr.net/gh/jdecked/twemoji@"),
};

export type RenderOptions = {
  width: number;
  height: number;
  /** extra per-render fonts, e.g. `(await fontsForText(text)).fonts` */
  fonts?: BannerFont[];
  signal?: AbortSignal;
};

export async function renderSvg(
  element: ReactElement,
  { width, height, fonts, signal }: RenderOptions,
): Promise<string> {
  return takumiRenderSvg(element, {
    renderer: await getRenderer(),
    width,
    height,
    fonts,
    emoji: "twemoji",
    images: IMAGES,
    signal,
  });
}

export async function renderPng(
  element: ReactElement,
  {
    width,
    height,
    fonts,
    signal,
    scale = 1,
  }: RenderOptions & { scale?: 1 | 2 | 3 },
): Promise<Uint8Array> {
  return render(element, {
    renderer: await getRenderer(),
    // width/height are OUTPUT pixels; devicePixelRatio scales the CSS px layout
    width: width * scale,
    height: height * scale,
    devicePixelRatio: scale,
    format: "png",
    fonts,
    emoji: "twemoji",
    images: IMAGES,
    signal,
  });
}

export async function renderWebp(
  element: ReactElement,
  {
    width,
    height,
    fonts,
    signal,
    scale = 1,
    quality = 80,
  }: RenderOptions & { scale?: 1 | 2 | 3; quality?: number },
): Promise<Uint8Array> {
  return render(element, {
    renderer: await getRenderer(),
    width: width * scale,
    height: height * scale,
    devicePixelRatio: scale,
    format: "webp",
    quality,
    fonts,
    emoji: "twemoji",
    images: IMAGES,
    signal,
  });
}
