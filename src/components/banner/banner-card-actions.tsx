"use client";

import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { ArrowUpRight } from "lucide-react";
import { useSiteOrigin } from "@/components/providers";
import { studioPath } from "@/lib/embed";
import { parseBannerRef } from "./box";
import { CopyButton } from "./copy-button";

/** The action cluster of a `BannerCard`. */
export function BannerCardActions({
  path,
  title,
}: {
  path: string;
  title: string;
}) {
  const origin = useSiteOrigin();
  const ref = parseBannerRef(path);
  if (!ref) return null;
  return (
    <div className="gb-card-actions">
      <CopyButton
        text={`${origin}${ref.image("svg")}`}
        label={`Copy image URL of ${title}`}
        copiedLabel="URL copied"
        variant="ghost"
        size="sm"
        isIconOnly
      />
      <IconButton
        label={`Open ${title} in the studio`}
        tooltip="Open in studio"
        variant="ghost"
        size="sm"
        href={studioPath({
          target: ref.target,
          preset: ref.preset,
          query: ref.query,
        })}
        icon={<Icon icon={ArrowUpRight} />}
      />
    </div>
  );
}
