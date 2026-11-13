"use client";

import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Text } from "@astryxdesign/core/Text";
import { type EntityKind, getPreset, presetsFor } from "@/lib/banner";

export interface PresetPickerProps {
  /**
   * What the banner is about. Users, repositories and organizations each
   * have their own presets, so the picker follows the entity on screen.
   */
  kind: EntityKind;
  /** Selected preset id. An id the kind does not have shows its default. */
  value: string;
  onChange: (preset: string) => void;
  /**
   * `tabs`: a strip above a preview, where each preset is a view of the same
   * banner. `list`: a radio list with every description, for a settings
   * panel.
   * @default "tabs"
   */
  variant?: "tabs" | "list";
  /**
   * `tabs` only: id of the element that shows the banner. Ties each tab to
   * it for assistive technology; give that element `role="tabpanel"`.
   */
  panelId?: string;
  /** `tabs` only: print the selected preset's description under the strip. */
  hasDescription?: boolean;
  /** `list` only: the group label. */
  label?: string;
  size?: "sm" | "md";
}

/** Chooses one of the presets of an entity kind. */
export function PresetPicker({
  kind,
  value,
  onChange,
  variant = "tabs",
  panelId,
  hasDescription = false,
  label = "Banner preset",
  size = "md",
}: PresetPickerProps) {
  const presets = presetsFor(kind);
  const selected = getPreset(kind, value);
  if (variant === "list") {
    return (
      <RadioList
        label={label}
        value={selected.id}
        onChange={onChange}
        size={size}
      >
        {presets.map((preset) => (
          <RadioListItem
            key={preset.id}
            value={preset.id}
            label={preset.name}
            description={preset.description}
          />
        ))}
      </RadioList>
    );
  }
  return (
    <>
      <TabList
        role="tablist"
        aria-label={label}
        value={selected.id}
        onChange={onChange}
        size={size}
      >
        {presets.map((preset) => (
          <Tab
            key={preset.id}
            value={preset.id}
            label={preset.name}
            panelId={panelId}
          />
        ))}
      </TabList>
      {hasDescription ? (
        <Text as="p" type="supporting" color="secondary">
          {selected.description}
        </Text>
      ) : null}
    </>
  );
}
