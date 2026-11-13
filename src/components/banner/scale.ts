/**
 * The numbers behind the live banner preview. Pure, so they are unit tested
 * without a DOM.
 */

/** Sizes GitHub's avatar CDN is asked for, so nearby requests share a cache entry. */
const AVATAR_SIZES = [40, 64, 96, 128, 192, 256, 400, 460] as const;
const AVATAR_HOST = "avatars.githubusercontent.com";

/**
 * Factor that makes a banner `natural` pixels wide exactly fill `available`
 * pixels, never above `maxScale`. 1 while the container has not been measured.
 *
 * A factor within a quarter of a percent of 1 is snapped to 1: at that
 * distance the text would only go soft, and the missing pixel is invisible.
 */
export function fitScale(
  available: number,
  natural: number,
  maxScale = 1,
): number {
  if (!(available > 0) || !(natural > 0)) return 1;
  const scale = Math.min(available / natural, maxScale > 0 ? maxScale : 1);
  return Math.abs(scale - 1) < 0.0025 ? 1 : scale;
}

/**
 * `env.image` for the browser: a remote image URL that is sharp at `px` CSS
 * pixels on a 2x screen. GitHub avatars get a size hint (`s=`), rounded up to
 * a common step; anything else is returned as it is.
 */
export function browserImage(url: string, px: number): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.hostname !== AVATAR_HOST) return url;
  const wanted = Math.max(1, Math.ceil(px * 2));
  const size =
    AVATAR_SIZES.find((step) => step >= wanted) ??
    AVATAR_SIZES[AVATAR_SIZES.length - 1];
  parsed.searchParams.set("s", String(size));
  return parsed.toString();
}

/** A rectangle of the banner canvas as percentages of its box, for overlays. */
export function percentRect(
  rect: { x: number; y: number; width: number; height: number },
  canvas: { width: number; height: number },
): { left: string; top: string; width: string; height: string } {
  const percent = (value: number, of: number) =>
    `${of > 0 ? Math.round((value / of) * 10_000) / 100 : 0}%`;
  return {
    left: percent(rect.x, canvas.width),
    top: percent(rect.y, canvas.height),
    width: percent(rect.width, canvas.width),
    height: percent(rect.height, canvas.height),
  };
}
