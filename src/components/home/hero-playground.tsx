"use client";

import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { ArrowRight } from "lucide-react";
import { useId } from "react";
import { NoPrefetchLink } from "@/components/app-link";
import { CopyButton } from "@/components/banner/copy-button";
import { DownloadButton } from "@/components/banner/download-button";
import { PresetPicker } from "@/components/banner/preset-picker";
import { TargetInput } from "@/components/banner/target-input";
import { useSiteHost } from "@/components/providers";
import { sameTarget } from "@/hooks/targets";
import {
  bannerSnippets,
  parseTargetSlug,
  studioPath,
  targetSlug,
} from "@/lib/embed";
import { useHomePreview } from "./preview";
import { PreviewBanner } from "./preview-banner";

/** Examples under the input: a user, a repository, an organization, a repository. */
const EXAMPLES = ["torvalds", "vercel/next.js", "vercel", "facebook/react"];

/**
 * One line under the input. Normally it offers examples; when the requested
 * target cannot be shown it says why, in the same place and at the same
 * height, so nothing below it moves.
 */
function HintLine() {
  const { state, requested, target, text, setText, show } = useHomePreview();
  const asked = targetSlug(requested);
  // The message is about what is in the field. Once the visitor types
  // something else it has done its job, even before a new answer arrives.
  const typed = parseTargetSlug(text);
  const failure =
    state.failure && typed && sameTarget(typed, requested)
      ? state.failure
      : null;
  if (failure) {
    const message =
      failure === "not_found"
        ? requested.kind === "repo"
          ? `No public repository named ${asked}. Check the spelling: private repositories cannot be shown.`
          : `No GitHub account named ${asked}. Check the spelling, or try owner/repo.`
        : failure === "invalid"
          ? `${asked} is not a GitHub username or owner/repo.`
          : `GitHub is slow to answer right now. Still showing ${targetSlug(target)}.`;
    return (
      <output className="gb-hint" data-tone="problem">
        <Icon icon="warning" size="sm" />
        <span>{message}</span>
        {failure === "not_found" || failure === "invalid" ? null : (
          <Button
            label="Try again"
            variant="ghost"
            size="sm"
            onClick={state.retry}
          />
        )}
      </output>
    );
  }
  return (
    <div className="gb-hint">
      <span>Try</span>
      {EXAMPLES.map((slug) => (
        <button
          key={slug}
          type="button"
          className="gb-chip"
          onClick={() => {
            const next = parseTargetSlug(slug);
            if (!next) return;
            setText(slug);
            show(next, true);
          }}
        >
          {slug}
        </button>
      ))}
    </div>
  );
}

/**
 * The interactive half of the hero: the target input, the banner that
 * follows it, preset tabs and the actions on the banner's URL.
 */
export function HeroPlayground() {
  const host = useSiteHost();
  const panelId = useId();
  const preview = useHomePreview();
  const { entity, target, preset, query, links, banner, state } = preview;
  const snippets = bannerSnippets(links, banner.alt);
  const isBusy = state.isLoading;

  return (
    <div className="gb-playground">
      <TargetInput
        value={preview.text}
        onValueChange={preview.setText}
        onCommit={(next) => preview.show(next, true)}
        onPreview={(next) => preview.show(next, false)}
        size="lg"
        prefix={`${host}/`}
        hasShortcut
      />
      <HintLine />
      <div className="gb-frame">
        <div className="gb-frame-tabs">
          <PresetPicker
            kind={entity.kind}
            value={preset}
            onChange={preview.setPreset}
            panelId={panelId}
          />
        </div>
        <div
          id={panelId}
          role="tabpanel"
          aria-label="Banner preview"
          aria-busy={isBusy}
          className="gb-frame-stage"
        >
          <PreviewBanner priority />
        </div>
        <div className="gb-frame-footer">
          <code className="gb-url">
            {links.svg.replace(/^https?:\/\//, "")}
          </code>
          <div className="gb-frame-actions">
            <CopyButton text={links.svg} label="Copy URL" variant="primary" />
            <CopyButton text={snippets.markdown} label="Copy Markdown" />
            <DownloadButton target={target} preset={preset} query={query} />
            <Button
              label="Open in studio"
              href={studioPath({ target, preset, query })}
              // The address follows every keystroke: prefetching it would too.
              as={NoPrefetchLink}
              variant="ghost"
              endContent={<Icon icon={ArrowRight} size="sm" />}
            />
          </div>
        </div>
      </div>
      <output className="sr-only" aria-live="polite">
        {isBusy
          ? `Loading ${targetSlug(preview.requested)}`
          : preview.touched && state.isCurrent
            ? `Showing ${banner.alt}`
            : ""}
      </output>
    </div>
  );
}
