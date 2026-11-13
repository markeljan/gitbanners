"use client";

import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { Token } from "@astryxdesign/core/Token";
import {
  ArrowUpRight,
  ExternalLink,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  isOwnProfile,
  nameProblem,
  presetName,
  type SavedBanner,
  savedBannerAlt,
  savedImageSrc,
  savedPaths,
  savedSnippets,
  targetText,
} from "@/components/account/saved-banners";
import { NoPrefetchLink } from "@/components/app-link";
import { CopyButton } from "@/components/banner/copy-button";
import { useSiteOrigin } from "@/components/providers";

export interface SavedBannerCardProps {
  banner: SavedBanner;
  /** The signed-in login: decides whether the profile default is offered. */
  login: string;
  /** The plan allows choosing the profile default (Pro). */
  canSetDefault: boolean;
  /** Load the image now: the first row of the grid. */
  priority?: boolean;
  /** Each resolves when done; failures are reported by the caller. */
  onRename: (name: string) => Promise<void>;
  onSetDefault: (isDefault: boolean) => Promise<void>;
  /** Ask for confirmation; the caller owns the dialog. */
  onDelete: () => void;
}

/**
 * One saved banner on the dashboard: the live image, its name (renamed in
 * place), what it shows, and the things people do with it.
 */
export function SavedBannerCard({
  banner,
  login,
  canSetDefault,
  priority = false,
  onRename,
  onSetDefault,
  onDelete,
}: SavedBannerCardProps) {
  const origin = useSiteOrigin();
  const host = new URL(origin).host;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(banner.name);
  const [touched, setTouched] = useState(false);
  const paths = savedPaths(banner.id);
  const snippets = savedSnippets(banner, origin);
  const own = isOwnProfile(banner, login);
  const problem = nameProblem(draft);

  const startEditing = () => {
    setDraft(banner.name);
    setTouched(false);
    setEditing(true);
  };
  const save = () => {
    setTouched(true);
    if (problem) return;
    setEditing(false);
    const name = draft.trim();
    if (name !== banner.name) void onRename(name);
  };

  const defaultItem = !own
    ? []
    : banner.isDefault
      ? [
          {
            label: "Stop using as profile default",
            description: `${host}/${login}.svg goes back to the standard banner`,
            icon: PinOff,
            onClick: () => void onSetDefault(false),
          },
        ]
      : [
          {
            label: "Use as profile default",
            description: canSetDefault
              ? `Serve this banner at ${host}/${login}.svg`
              : "Pro: star the repository to unlock",
            icon: Pin,
            isDisabled: !canSetDefault,
            onClick: () => void onSetDefault(true),
          },
        ];

  return (
    <article className="gb-saved" aria-labelledby={`${banner.id}-name`}>
      <Link
        href={paths.page}
        prefetch={false}
        className="gb-saved-frame"
        aria-label={`Open the page of ${banner.name}`}
      >
        {/* biome-ignore lint/performance/noImgElement: a live banner URL, already the optimised image */}
        <img
          src={savedImageSrc(banner)}
          alt={savedBannerAlt(banner)}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
        />
      </Link>
      <div className="gb-saved-body">
        {editing ? (
          <form
            className="gb-saved-rename"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <TextInput
              label="Banner name"
              value={draft}
              onChange={(value) => setDraft(value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditing(false);
              }}
              hasAutoFocus
              size="sm"
              autoComplete="off"
              status={
                touched && problem
                  ? { type: "error", message: problem }
                  : undefined
              }
            />
            <div className="gb-saved-rename-actions">
              <Button label="Save name" type="submit" size="sm" />
              <Button
                label="Cancel"
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
              />
            </div>
          </form>
        ) : (
          <div className="gb-saved-title">
            <Heading
              level={3}
              id={`${banner.id}-name`}
              className="gb-saved-name"
              maxLines={1}
            >
              {banner.name}
            </Heading>
            {banner.isDefault ? (
              <Token
                label="Profile default"
                size="sm"
                icon={<Icon icon={Pin} />}
              />
            ) : null}
          </div>
        )}
        <Text type="supporting" color="secondary" as="p">
          {targetText(banner.target)} · {presetName(banner)} · Updated{" "}
          <Timestamp
            value={banner.updatedAt}
            format="relative"
            hasTooltip={false}
          />
        </Text>
        {banner.isDefault ? (
          <Text type="supporting" color="secondary" as="p">
            Served at {host}/{login}.svg
          </Text>
        ) : null}
        <div className="gb-saved-actions">
          <CopyButton
            text={snippets.url}
            label="Copy URL"
            copiedLabel="URL copied"
            variant="ghost"
            size="sm"
          />
          <CopyButton
            text={snippets.markdown}
            label="Copy Markdown"
            variant="ghost"
            size="sm"
          />
          <span className="gb-saved-actions-end">
            <IconButton
              label={`Open ${banner.name} in the studio`}
              tooltip="Open in studio"
              variant="ghost"
              size="sm"
              href={`/studio?banner=${banner.id}`}
              as={NoPrefetchLink}
              icon={<Icon icon={ArrowUpRight} />}
            />
            <MoreMenu
              label={`More actions for ${banner.name}`}
              size="sm"
              alignment="end"
              items={[
                { label: "Rename", icon: Pencil, onClick: startEditing },
                ...defaultItem,
                {
                  label: "Open public page",
                  icon: ExternalLink,
                  href: paths.page,
                },
                { type: "divider" },
                {
                  label: "Delete banner",
                  icon: Trash2,
                  variant: "destructive",
                  onClick: onDelete,
                },
              ]}
            />
          </span>
        </div>
      </div>
    </article>
  );
}
