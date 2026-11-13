"use client";

import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { type CSSProperties, useState } from "react";
import { NoPrefetchLink } from "@/components/app-link";
import { CopyButton } from "@/components/banner/copy-button";
import { filterThemes } from "@/components/banner/theme-swatch";
import { ArrowUpRight } from "@/components/icons";
import { type BannerTheme, THEMES } from "@/lib/banner";
import { studioPath } from "@/lib/embed";
import { WhenInteractive } from "./hydrated";

export interface ThemesBrowserProps {
  /** Login of the banner every theme is shown on. */
  login: string;
  /** Box of that banner (`/{login}/activity`), so nothing moves as images load. */
  width: number;
  height: number;
}

const COLOR_LABELS = [
  ["bg", "Background"],
  ["surface", "Surface"],
  ["border", "Border"],
  ["text", "Text"],
  ["muted", "Muted"],
  ["accent", "Accent"],
] as const;

function ThemeCard({
  theme,
  login,
  width,
  height,
}: { theme: BannerTheme } & ThemesBrowserProps) {
  const target = { kind: "owner", login } as const;
  const parameter = `?theme=${theme.id}`;
  return (
    <article id={theme.id} className="gb-card gb-theme-card">
      <a href={`/${login}/activity${parameter}`} className="gb-banner-link">
        {/* biome-ignore lint/performance/noImgElement: a live banner URL, already the optimised image */}
        <img
          src={`/${login}/activity.svg${parameter}`}
          alt={`Contribution graph banner for ${login} in the ${theme.name} theme`}
          width={width}
          height={height}
          loading="lazy"
          decoding="async"
          className="gb-banner-img"
          style={{ aspectRatio: `${width} / ${height}` }}
        />
      </a>
      <div className="gb-card-body">
        <div className="gb-card-text">
          <Heading level={3} className="gb-card-title">
            {theme.name}
          </Heading>
          <p className="gb-card-blurb">
            <code className="gb-code-inline">{theme.id}</code>, a {theme.mode}{" "}
            theme.
          </p>
          <ul
            className="gb-theme-swatches"
            aria-label={`${theme.name} colours`}
          >
            {COLOR_LABELS.map(([key, label]) => (
              <li key={key}>
                <span
                  className="gb-theme-dot"
                  style={{ "--gb-dot": theme.colors[key] } as CSSProperties}
                  aria-hidden="true"
                />
                {label} <code>{theme.colors[key]}</code>
              </li>
            ))}
            <li>
              Graph{" "}
              {theme.colors.heat.map((color, level) => (
                <span
                  key={`${theme.id}-${level}`}
                  className="gb-theme-dot"
                  style={{ "--gb-dot": color } as CSSProperties}
                  aria-hidden="true"
                />
              ))}{" "}
              <code>{theme.colors.heat.join(" ")}</code>
            </li>
          </ul>
        </div>
        <WhenInteractive className="gb-pending-icons">
          <CopyButton
            text={parameter}
            label={`Copy ${parameter}`}
            copiedLabel="Copied"
            variant="ghost"
            size="sm"
            isIconOnly
          />
          <IconButton
            label={`Open ${theme.name} in the studio`}
            tooltip="Open in studio"
            variant="ghost"
            size="sm"
            href={studioPath({ target, query: `theme=${theme.id}` })}
            as={NoPrefetchLink}
            icon={<Icon icon={ArrowUpRight} />}
          />
        </WhenInteractive>
      </div>
    </article>
  );
}

/**
 * Every theme on a real banner, dark and light apart, with a filter by
 * name. All of it is in the server HTML (the filter only hides cards), so
 * `/themes#dracula` lands on its card without JavaScript.
 */
export function ThemesBrowser(props: ThemesBrowserProps) {
  const [search, setSearch] = useState("");
  const visible = filterThemes(THEMES, search);
  const groups = (["dark", "light"] as const).map((mode) => ({
    mode,
    themes: visible.filter((theme) => theme.mode === mode),
    total: THEMES.filter((theme) => theme.mode === mode).length,
  }));
  return (
    <>
      <div className="gb-theme-filter">
        <TextInput
          label="Filter themes by name"
          type="search"
          placeholder="dracula, nord, light…"
          startIcon="search"
          value={search}
          onChange={setSearch}
          hasClear
          width="100%"
        />
      </div>
      {visible.length === 0 ? (
        <Text as="p" color="secondary" aria-live="polite">
          No theme matches that name. Every colour can still be set by hand, see
          below.
        </Text>
      ) : null}
      {groups.map((group) =>
        group.themes.length === 0 ? null : (
          <section
            key={group.mode}
            className="gb-entity-section"
            aria-labelledby={`${group.mode}-themes`}
          >
            <div className="gb-entity-section-head">
              <Heading level={2} id={`${group.mode}-themes`} className="gb-h2">
                {group.mode === "dark" ? "Dark themes" : "Light themes"}
              </Heading>
              <Text as="p" color="secondary">
                {group.mode === "dark"
                  ? `${group.total} themes for dark pages, among them GitHub's own dark, dimmed and high-contrast modes, the seasonal graphs, and the editor palettes developers live in.`
                  : `${group.total} themes for light pages: GitHub's light modes and the light editor palettes. Pair one with a dark theme in a <picture> element to follow the reader's mode.`}
              </Text>
            </div>
            <div className="gb-theme-list">
              {group.themes.map((theme) => (
                <ThemeCard key={theme.id} theme={theme} {...props} />
              ))}
            </div>
          </section>
        ),
      )}
    </>
  );
}
