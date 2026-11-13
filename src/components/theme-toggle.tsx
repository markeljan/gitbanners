"use client";

import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { useColorMode } from "./providers";
import { type ColorMode, setColorMode } from "./theme";

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
