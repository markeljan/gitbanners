"use client";

import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
import { Text } from "@astryxdesign/core/Text";
import { SIZE_IDS, SIZES, type SizeId } from "@/lib/banner";
import { sizeDimensions, sizeHint, sizeRatio } from "./sizes";

export interface SizePickerProps {
  value: SizeId;
  onChange: (size: SizeId) => void;
  /** The group label. */
  label?: string;
  /** Print the upload note of the selected size under the list. @default true */
  hasHint?: boolean;
  size?: "sm" | "md";
}

/** The canvas in miniature: its true proportions inside a 40 by 24 box. */
function glyphBox(ratio: number): { width: number; height: number } {
  const width = Math.min(40, 24 * ratio);
  return { width: Math.round(width), height: Math.round(width / ratio) };
}

function isSizeId(value: string): value is SizeId {
  return Object.hasOwn(SIZES, value);
}

/**
 * Chooses a banner canvas. Each size is listed with its pixel dimensions
 * and a glyph of its real proportions, and the selected one explains what
 * its destination needs: a live URL or an upload, the file limits, and the
 * area the site covers with a profile photo.
 */
export function SizePicker({
  value,
  onChange,
  label = "Banner size",
  hasHint = true,
  size = "md",
}: SizePickerProps) {
  return (
    <div className="gb-size-picker">
      <RadioList
        label={label}
        value={value}
        size={size}
        onChange={(next) => {
          if (isSizeId(next)) onChange(next);
        }}
      >
        {SIZE_IDS.map((id) => (
          <RadioListItem
            key={id}
            value={id}
            label={SIZES[id].name}
            description={`${sizeDimensions(id)} px`}
            endContent={
              <span
                className="gb-ratio-glyph"
                style={glyphBox(sizeRatio(id))}
                aria-hidden="true"
              />
            }
          />
        ))}
      </RadioList>
      {hasHint ? (
        <Text as="p" type="supporting" color="secondary" aria-live="polite">
          {sizeHint(value)}
        </Text>
      ) : null}
    </div>
  );
}
