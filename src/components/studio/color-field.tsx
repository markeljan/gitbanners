"use client";

import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { TextInput } from "@astryxdesign/core/TextInput";
import { RotateCcw } from "lucide-react";
import { type CSSProperties, useId, useState } from "react";
import { normalizeHex } from "@/lib/banner";

export interface ColorFieldProps {
  /** Field label: "Background". */
  label: string;
  /** Colour as drawn, `#rrggbb`. */
  value: string;
  /** The value is an override, not the theme's own. */
  isOverridden: boolean;
  /** A valid colour, or `null` to go back to the theme's. */
  onChange: (hex: string | null) => void;
  description?: string;
}

/**
 * One banner colour: a native colour well, a hex field that takes `#abc`,
 * `abc` and `#aabbcc`, and a reset to the theme's value. An overridden
 * field says so next to its label.
 *
 * The hex field keeps what is typed until it is a colour, so a half-typed
 * value never jumps back; each complete value repaints at once.
 */
export function ColorField({
  label,
  value,
  isOverridden,
  onChange,
  description,
}: ColorFieldProps) {
  const wellId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value;
  const isInvalid = draft !== null && normalizeHex(draft) === null;

  const type = (next: string) => {
    const hex = normalizeHex(next);
    // A complete colour is applied while the text stays as typed.
    if (hex && next.replace("#", "").length >= 3) onChange(hex);
    setDraft(next);
  };

  return (
    <div className="gb-color-field" data-overridden={isOverridden || undefined}>
      <label className="gb-color-well" htmlFor={wellId}>
        <span className="sr-only">{`Pick ${label.toLowerCase()}`}</span>
        <input
          id={wellId}
          type="color"
          value={value}
          onChange={(event) => {
            setDraft(null);
            onChange(normalizeHex(event.target.value));
          }}
        />
        <span
          aria-hidden="true"
          className="gb-color-chip"
          // The fill is the banner colour itself: user data, not UI chrome.
          style={{ "--gb-chip": value } as CSSProperties}
        />
      </label>
      <TextInput
        label={label}
        description={description}
        value={text}
        onChange={type}
        onBlur={() => setDraft(null)}
        onEnter={() => setDraft(null)}
        placeholder={value}
        size="sm"
        width="100%"
        autoCapitalize="off"
        autoComplete="off"
        hasSpellCheck={false}
        hasAutoCorrect={false}
        status={
          isInvalid
            ? { type: "error", message: "Use a hex colour such as #2f81f7" }
            : undefined
        }
      />
      {isOverridden ? <span className="gb-color-mark">Custom</span> : null}
      <IconButton
        label={`Reset ${label.toLowerCase()} to the theme's colour`}
        tooltip="Reset to theme"
        variant="ghost"
        size="sm"
        icon={<Icon icon={RotateCcw} />}
        isDisabled={!isOverridden}
        onClick={() => {
          setDraft(null);
          onChange(null);
        }}
      />
    </div>
  );
}
