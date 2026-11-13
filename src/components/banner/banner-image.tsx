import Link from "next/link";
import type { EntityKind, ImageFormat } from "@/lib/banner";
import { estimateBannerBox, parseBannerRef } from "./box";

export interface BannerImageProps {
  /**
   * Relative banner URL without extension or origin, as written in content
   * and showcase data: `/vercel/next.js/activity`, `/torvalds?size=x`.
   */
  path: string;
  /** What the image shows. Required: a banner is content, not decoration. */
  alt: string;
  /**
   * What the owner in `path` is, when known. An owner path alone does not
   * say whether it is a user or an organization, and their banners differ in
   * height. Not needed for repositories.
   */
  kind?: EntityKind;
  /** @default "svg" */
  format?: ImageFormat;
  /**
   * The banner's real size when the caller has it (from `buildBanner` or
   * `/api/v1/banner`). Otherwise the box is estimated, see `estimateBannerBox`.
   */
  width?: number;
  height?: number;
  /**
   * Where a click leads. Defaults to the target's page (`/vercel/next.js`);
   * `null` renders the bare image.
   */
  href?: string | null;
  /** Above the fold: load now and with high priority instead of lazily. */
  priority?: boolean;
  /** Class of the outer element (the link, or the image when `href` is null). */
  className?: string;
}

/**
 * A live banner as a plain `<img>`: for server-rendered galleries, showcase
 * rows and anywhere a banner should be in the HTML without JavaScript.
 *
 * The image is lazy and decoded off the main thread, and its box is reserved
 * up front and never changes: the true banner is fitted into it, so nothing
 * on the page moves when it arrives, even if GitHub data made it a few
 * pixels taller or shorter than estimated.
 *
 * Works in Server and Client Components. For a preview that follows typing
 * use `BannerCanvas` instead.
 */
export function BannerImage({
  path,
  alt,
  kind,
  format = "svg",
  width,
  height,
  href,
  priority = false,
  className,
}: BannerImageProps) {
  const ref = parseBannerRef(path);
  if (!ref) return null;
  const box =
    width && height ? { width, height } : estimateBannerBox(ref, kind);
  const image = (
    // biome-ignore lint/performance/noImgElement: a live banner URL, already the optimised image
    <img
      src={ref.image(format)}
      alt={alt}
      width={box.width}
      height={box.height}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className={
        href === null && className
          ? `gb-banner-img ${className}`
          : "gb-banner-img"
      }
      // Fixed, not `auto W / H`: the estimate stays the box after the image loads.
      style={{ aspectRatio: `${box.width} / ${box.height}` }}
    />
  );
  if (href === null) return image;
  return (
    <Link
      href={href ?? ref.page}
      // Galleries hold dozens of these: no prefetch per banner.
      prefetch={false}
      className={className ? `gb-banner-link ${className}` : "gb-banner-link"}
    >
      {image}
    </Link>
  );
}
