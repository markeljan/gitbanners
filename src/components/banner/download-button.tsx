import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Download } from "@/components/icons";
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

export interface DownloadButtonProps {
  target: BannerTarget;
  /** Preset id, or `null` / omitted for the default of the target's kind. */
  preset?: string | null;
  /** Canonical option query without "?" (`serializeOptions(diffOptions(…))`). */
  query?: string;
  /** PNG for uploads (X, LinkedIn, social preview), SVG for everything else. */
  format?: ImageFormat;
  /** Visible text. Defaults to "Download PNG" / "Download SVG". */
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  width?: number | string;
}

/**
 * Saves the banner as a file. A plain link to the image URL with
 * `?download=1`, so it works without JavaScript and the browser names the
 * file itself. Works in Server and Client Components.
 */
export function DownloadButton({
  target,
  preset,
  query,
  format = "png",
  label = format === "png" ? "Download PNG" : "Download SVG",
  variant = "secondary",
  size = "md",
  width,
}: DownloadButtonProps) {
  return (
    <Button
      label={label}
      href={downloadHref(target, { preset, query, format })}
      // A file, not a page: the router must neither prefetch nor render it.
      as="a"
      variant={variant}
      size={size}
      width={width}
      icon={<Icon icon={Download} />}
    />
  );
}
