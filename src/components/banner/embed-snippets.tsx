"use client";

import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { useId, useState } from "react";
import { useSiteOrigin } from "@/components/providers";
import type { BannerTarget, ImageFormat } from "@/lib/banner";
import { CopyButton } from "./copy-button";
import { SNIPPET_KINDS, type SnippetKind, snippetsFor } from "./snippets";

export interface EmbedSnippetsProps {
  /** The banner's target, with GitHub's capitalisation (`targetOf(entity)`). */
  target: BannerTarget;
  /** Preset id, or `null` / omitted for the default of the target's kind. */
  preset?: string | null;
  /** Canonical option query without "?" (`serializeOptions(diffOptions(…))`). */
  query?: string;
  /** Alt text of the banner (`buildBanner(…).alt`). */
  alt: string;
  /**
   * `width` attribute for the HTML snippets. Pass the banner's width for
   * fixed canvases; leave it out for README cards, which size themselves.
   */
  width?: number | null;
  /** Tab shown first. @default "markdown" */
  defaultKind?: SnippetKind;
  /** Format shown first. @default "svg" */
  defaultFormat?: ImageFormat;
}

/**
 * Everything needed to put a banner somewhere else: Markdown for a README,
 * plain HTML, a `<picture>` that follows the reader's light or dark GitHub
 * theme, and the bare URL, each with a copy button, as SVG or PNG.
 *
 * All four snippets are in the DOM at once (the inactive ones `hidden`), so
 * the server HTML carries them and switching tabs renders nothing new.
 */
export function EmbedSnippets({
  target,
  preset,
  query,
  alt,
  width,
  defaultKind = "markdown",
  defaultFormat = "svg",
}: EmbedSnippetsProps) {
  const origin = useSiteOrigin();
  const id = useId();
  const [kind, setKind] = useState<SnippetKind>(defaultKind);
  const [format, setFormat] = useState<ImageFormat>(defaultFormat);
  const { snippets } = snippetsFor(
    { target, preset, query, alt, origin, width },
    format,
  );
  const active =
    SNIPPET_KINDS.find((item) => item.id === kind) ?? SNIPPET_KINDS[0];
  return (
    <div className="gb-snippets">
      <div className="gb-snippets-bar">
        <TabList
          role="tablist"
          aria-label="Snippet type"
          value={kind}
          onChange={(next) => setKind(next as SnippetKind)}
          size="sm"
        >
          {SNIPPET_KINDS.map((item) => (
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
          onChange={(next) => setFormat(next as ImageFormat)}
        >
          <SegmentedControlItem value="svg" label="SVG" />
          <SegmentedControlItem value="png" label="PNG" />
        </SegmentedControl>
      </div>
      {SNIPPET_KINDS.map((item) => (
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
