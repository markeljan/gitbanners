import type { EntityKind } from "@/lib/banner";
import { BannerCardActions } from "./banner-card-actions";
import { BannerImage } from "./banner-image";

export interface BannerCardProps {
  /**
   * Relative banner URL without extension or origin:
   * `/vercel/next.js/contributors`, `/torvalds?size=x`.
   */
  path: string;
  /** Alt text of the image. */
  alt: string;
  title: string;
  /** One line on what the banner shows and when to use it. */
  blurb?: string;
  /** What the owner in `path` is, when known (see `BannerImage`). */
  kind?: EntityKind;
  /**
   * Element of the title. Pick the heading level that continues the page's
   * outline (a card under an `<h2>` is an `h3`); `p` when the cards are not
   * part of the outline.
   * @default "h3"
   */
  titleAs?: "h2" | "h3" | "h4" | "p";
  /** Print the banner's URL path under the text. @default false */
  hasPath?: boolean;
  /** "Copy image URL" and "Open in studio". @default true */
  hasActions?: boolean;
  /** Above the fold: load the image now instead of lazily. */
  priority?: boolean;
}

/**
 * A banner in a frame with its title, a blurb and the two things people do
 * with a gallery item: copy its URL or open it in the studio. The image links
 * to the target's page.
 *
 * A Server Component by default (the actions are a small client island), so
 * a gallery of cards is plain HTML with lazy images.
 */
export function BannerCard({
  path,
  alt,
  title,
  blurb,
  kind,
  titleAs: Title = "h3",
  hasPath = false,
  hasActions = true,
  priority = false,
}: BannerCardProps) {
  return (
    <article className="gb-card">
      <BannerImage path={path} alt={alt} kind={kind} priority={priority} />
      <div className="gb-card-body">
        <div className="gb-card-text">
          <Title className="gb-card-title">{title}</Title>
          {blurb ? <p className="gb-card-blurb">{blurb}</p> : null}
          {hasPath ? <code className="gb-card-path">{path}</code> : null}
        </div>
        {hasActions ? <BannerCardActions path={path} title={title} /> : null}
      </div>
    </article>
  );
}
