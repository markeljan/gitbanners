"use client";

import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { ArrowRight } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { BannerCanvas } from "@/components/banner/banner-canvas";
import { CopyButton } from "@/components/banner/copy-button";
import { DownloadButton } from "@/components/banner/download-button";
import { preloadBannerFonts } from "@/components/banner/fonts";
import { PresetPicker } from "@/components/banner/preset-picker";
import { TargetInput } from "@/components/banner/target-input";
import { useSiteHost } from "@/components/providers";
import { bannerPath } from "@/lib/banner";
import {
  bannerSnippets,
  parseTargetSlug,
  studioPath,
  targetSlug,
} from "@/lib/embed";
import { HOME_ENTITY, useHomePreview } from "./preview";

/** Examples under the input: a user, a repository, an organization, a repository. */
const EXAMPLES = ["torvalds", "vercel/next.js", "vercel", "facebook/react"];

/**
 * The image the server renders for the first paint: the homepage profile as
 * a plain `<img>`, which costs a few hundred bytes of HTML where the DOM
 * banner would cost tens of thousands.
 */
const POSTER_SRC = bannerPath(
  { kind: "owner", login: HOME_ENTITY.login },
  { format: "svg" },
);

/**
 * One line under the input. Normally it offers examples; when the requested
 * target cannot be shown it says why, in the same place and at the same
 * height, so nothing below it moves.
 */
function HintLine() {
  const { state, requested, target, setText, show } = useHomePreview();
  const asked = targetSlug(requested);
  const failure = state.failure;
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
 * The banner itself. Until the visitor changes something it is the
 * server-rendered image; the DOM canvas is mounted invisibly underneath once
 * the browser is idle and the banner fonts have arrived, so the first
 * keystroke only has to flip which of the two is visible.
 */
function HeroBanner() {
  const { entity, options, banner, touched } = useHomePreview();
  const [isCanvasWarm, setCanvasWarm] = useState(false);
  const [hasPosterFailed, setPosterFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const warm = () => {
      void preloadBannerFonts().then(() => {
        if (alive) setCanvasWarm(true);
      });
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(warm, { timeout: 2500 });
      return () => {
        alive = false;
        window.cancelIdleCallback(handle);
      };
    }
    const timer = setTimeout(warm, 600);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  const isLive = touched || hasPosterFailed;
  return (
    <div
      className="gb-hero-banner"
      style={{
        aspectRatio: `${banner.width} / ${banner.height}`,
        maxWidth: banner.width,
      }}
    >
      {isLive || isCanvasWarm ? (
        <BannerCanvas
          entity={entity}
          options={options}
          banner={banner}
          className={isLive ? undefined : "invisible"}
        />
      ) : null}
      {isLive ? null : (
        // biome-ignore lint/performance/noImgElement: the live banner URL is the product, and already an optimised image
        <img
          className="gb-hero-poster"
          src={POSTER_SRC}
          alt={banner.alt}
          width={banner.width}
          height={banner.height}
          fetchPriority="high"
          decoding="async"
          onError={() => setPosterFailed(true)}
        />
      )}
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
          <HeroBanner />
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
