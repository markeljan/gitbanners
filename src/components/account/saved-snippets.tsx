"use client";

import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { useId, useState } from "react";
import { CopyButton } from "@/components/banner/copy-button";
import { useSiteOrigin } from "@/components/providers";
import { type SavedBanner, savedSnippets } from "./saved-banners";

const KINDS = [
  { id: "markdown", label: "Markdown", copy: "Copy Markdown" },
  { id: "html", label: "HTML", copy: "Copy HTML" },
  { id: "url", label: "URL", copy: "Copy URL" },
] as const;

type Kind = (typeof KINDS)[number]["id"];

export interface SavedSnippetsProps {
  banner: Pick<SavedBanner, "id" | "target" | "preset">;
}

/**
 * Embed snippets of a saved banner, built around its own `/b/{id}.svg` or
 * `.png` address: Markdown, HTML and the bare URL, each with a copy button.
 * The same layout as `EmbedSnippets`, without its light and dark variant
 * (a saved banner's theme is part of the saved record).
 *
 * Every snippet is in the server HTML; the inactive ones are `hidden`.
 */
export function SavedSnippets({ banner }: SavedSnippetsProps) {
  const origin = useSiteOrigin();
  const id = useId();
  const [kind, setKind] = useState<Kind>("markdown");
  const [format, setFormat] = useState<"svg" | "png">("svg");
  const snippets = savedSnippets(banner, origin, format);
  const active = KINDS.find((item) => item.id === kind) ?? KINDS[0];
  return (
    <div className="gb-snippets">
      <div className="gb-snippets-bar">
        <TabList
          role="tablist"
          aria-label="Snippet type"
          value={kind}
          onChange={(next) => setKind(next as Kind)}
          size="sm"
        >
          {KINDS.map((item) => (
            <Tab
              key={item.id}
              value={item.id}
              label={item.label}
              panelId={`${id}-${item.id}`}
            />
          ))}
        </TabList>
        <SegmentedControl
          label="Image format"
          size="sm"
          value={format}
          onChange={(next) => setFormat(next === "png" ? "png" : "svg")}
        >
          <SegmentedControlItem value="svg" label="SVG" />
          <SegmentedControlItem value="png" label="PNG" />
        </SegmentedControl>
      </div>
      {KINDS.map((item) => (
        <pre
          key={item.id}
          id={`${id}-${item.id}`}
          role="tabpanel"
          aria-label={item.label}
          hidden={item.id !== kind}
          className="gb-code"
        >
          <code>{snippets[item.id]}</code>
        </pre>
      ))}
      <div className="gb-snippet-actions">
        <CopyButton text={snippets[kind]} label={active.copy} size="sm" />
      </div>
    </div>
  );
}
