"use client";

import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { type CSSProperties, type KeyboardEvent, useId, useState } from "react";
import { type BannerTheme, getTheme, THEMES } from "@/lib/banner";
import { moveActive } from "./target-options";
import { filterThemes, swatchVariables } from "./theme-swatch";

export interface ThemePickerProps {
  /** Selected theme id. An unknown id selects the default theme. */
  value: string;
  onChange: (theme: string) => void;
  /**
   * `grid`: dark and light themes under their own labels, with a search
   * field: the full picker for a studio or settings panel. `strip`: every
   * theme in one wrapping row, nothing else.
   * @default "grid"
   */
  variant?: "grid" | "strip";
  /** `grid` only: show the search field. @default true */
  hasSearch?: boolean;
  /** Accessible name of the group. */
  label?: string;
}

/**
 * Chooses a banner theme from swatches that show each theme's real canvas,
 * text, accent and contribution ramp.
 *
 * One radio group to the keyboard: Tab reaches the selected swatch, the
 * arrow keys move to the next one and select it (so a preview follows the
 * arrows), Home and End jump to the ends.
 */
export function ThemePicker({
  value,
  onChange,
  variant = "grid",
  hasSearch = true,
  label = "Banner theme",
}: ThemePickerProps) {
  const groupId = useId();
  const [search, setSearch] = useState("");
  const selected = getTheme(value).id;
  const isGrid = variant === "grid";
  const visible = isGrid && hasSearch ? filterThemes(THEMES, search) : THEMES;
  // The swatch Tab lands on: the selected one, or the first when a search hides it.
  const tabStop = visible.some((theme) => theme.id === selected)
    ? selected
    : visible[0]?.id;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = visible.findIndex((theme) => theme.id === selected);
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = moveActive(at, visible.length, 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = moveActive(at, visible.length, -1);
    } else if (event.key === "Home") {
      next = visible.length > 0 ? 0 : -1;
    } else if (event.key === "End") {
      next = visible.length - 1;
    } else {
      return;
    }
    const theme = visible[next];
    if (!theme) return;
    event.preventDefault();
    onChange(theme.id);
    document.getElementById(`${groupId}-${theme.id}`)?.focus();
  };

  const swatch = (theme: BannerTheme) => (
    // biome-ignore lint/a11y/useSemanticElements: a swatch draws the theme; a native radio cannot
    <button
      key={theme.id}
      id={`${groupId}-${theme.id}`}
      type="button"
      role="radio"
      aria-checked={theme.id === selected}
      tabIndex={theme.id === tabStop ? 0 : -1}
      className="gb-swatch"
      style={swatchVariables(theme) as CSSProperties}
      onClick={() => onChange(theme.id)}
    >
      <span className="gb-swatch-chip" aria-hidden="true">
        <b>Aa</b>
        <i />
      </span>
      {theme.name}
    </button>
  );

  const groups = isGrid
    ? (["dark", "light"] as const)
        .map((mode) => ({
          mode,
          themes: visible.filter((theme) => theme.mode === mode),
        }))
        .filter((group) => group.themes.length > 0)
    : [];

  return (
    <div className="gb-theme-picker">
      {isGrid && hasSearch ? (
        <TextInput
          label="Search themes"
          isLabelHidden
          type="search"
          placeholder="Search themes"
          startIcon="search"
          value={search}
          onChange={setSearch}
          hasClear
          width="100%"
        />
      ) : null}
      <div
        role="radiogroup"
        aria-label={label}
        className={isGrid ? "gb-swatch-groups" : "gb-swatches"}
        onKeyDown={onKeyDown}
      >
        {isGrid
          ? groups.map((group) => (
              <div key={group.mode}>
                <Text as="p" type="label" color="secondary">
                  {group.mode === "dark" ? "Dark" : "Light"}
                </Text>
                <div className="gb-swatches">{group.themes.map(swatch)}</div>
              </div>
            ))
          : visible.map(swatch)}
      </div>
      {visible.length === 0 ? (
        <Text as="p" color="secondary">
          No theme matches that search.
        </Text>
      ) : null}
    </div>
  );
}
