"use client";

import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Moon, Sun } from "lucide-react";
import { useColorMode } from "./providers";
import { type ColorMode, effectiveMode, setColorMode } from "./theme";

/** Light, dark or follow the system: the full choice, for footers and settings. */
export function ThemeToggle() {
  const mode = useColorMode();
  return (
    <SegmentedControl
      label="Colour mode"
      size="sm"
      value={mode}
      onChange={(v) => setColorMode(v as ColorMode)}
    >
      <SegmentedControlItem value="light" label="Light" />
      <SegmentedControlItem value="dark" label="Dark" />
      <SegmentedControlItem value="system" label="System" />
    </SegmentedControl>
  );
}

/**
 * One-button switch between light and dark for the header.
 *
 * Both glyphs are always rendered and CSS shows the one for the mode on
 * screen, so the button is right before hydration too (the stored mode is
 * applied by the inline script in `<head>`, long before React runs).
 */
export function ThemeSwitch() {
  return (
    <IconButton
      label="Switch between light and dark mode"
      tooltip="Switch colour mode"
      variant="ghost"
      icon={
        <>
          <Icon icon={Sun} className="hidden dark:inline-flex" />
          <Icon icon={Moon} className="dark:hidden" />
        </>
      }
      onClick={() =>
        setColorMode(effectiveMode() === "dark" ? "light" : "dark")
      }
    />
  );
}
