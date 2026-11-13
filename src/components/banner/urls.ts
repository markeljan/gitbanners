import { type BannerTarget, bannerPath, type ImageFormat } from "@/lib/banner";

/**
 * Relative URL that makes the browser save a banner instead of showing it
 * (`?download=1`). Relative on purpose: the file comes from the deployment
 * the visitor is on.
 */
export function downloadHref(
  target: BannerTarget,
  options: {
    preset?: string | null;
    query?: string;
    format?: ImageFormat;
  } = {},
): string {
  const query = (options.query ?? "").replace(/^\?/, "");
  return bannerPath(target, {
    preset: options.preset,
    format: options.format ?? "png",
    query: query ? `${query}&download=1` : "download=1",
  });
}
