"use client";

import { Button } from "@astryxdesign/core/Button";
import { useClipboard } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { useToast } from "@astryxdesign/core/Toast";

export interface CopyButtonProps {
  /** What goes on the clipboard. */
  text: string;
  /** What the button says, and its accessible name: "Copy URL". */
  label: string;
  /**
   * Shown in place of the label for two seconds after a copy, and announced
   * to screen readers.
   * @default "Copied"
   */
  copiedLabel?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  /** Only the glyph, with the label as tooltip: for dense rows and cards. */
  isIconOnly?: boolean;
  /** Button width, e.g. "100%" in a stacked layout. */
  width?: number | string;
}

/**
 * Copies a string and confirms it. The button keeps the width of its longer
 * label, so the confirmation never pushes its neighbours around. If the
 * browser refuses the clipboard (no permission, an insecure origin) a toast
 * says so instead of failing silently.
 */
export function CopyButton({
  text,
  label,
  copiedLabel = "Copied",
  variant = "secondary",
  size = "md",
  isIconOnly = false,
  width,
}: CopyButtonProps) {
  const { copy, isCopied } = useClipboard({ announce: copiedLabel });
  const showToast = useToast();
  const onClick = async () => {
    if (await copy(text)) return;
    showToast({
      body: "Copying is blocked in this browser. Select the text and copy it by hand.",
      type: "error",
      uniqueID: "copy-blocked",
    });
  };
  const icon = <Icon icon={isCopied ? "check" : "copy"} />;
  if (isIconOnly) {
    return (
      <IconButton
        label={label}
        tooltip={isCopied ? copiedLabel : label}
        variant={variant}
        size={size}
        icon={icon}
        onClick={onClick}
      />
    );
  }
  return (
    <Button
      label={label}
      variant={variant}
      size={size}
      icon={icon}
      width={width}
      onClick={onClick}
    >
      <span className="gb-swap" data-on={isCopied ? "" : undefined}>
        <span>{label}</span>
        <span aria-hidden="true">{copiedLabel}</span>
      </span>
    </Button>
  );
}
