"use client";

import type { ReactNode } from "react";
import { useHydrated } from "@/hooks/use-hydrated";

export interface WhenInteractiveProps {
  /** Controls that do nothing without JavaScript (copy, theme swatches). */
  children: ReactNode;
  /**
   * Holds the controls' place in the server HTML, so nothing moves when
   * they appear. Give it the size the controls will have.
   */
  className: string;
}

/**
 * Renders controls only once the page is interactive.
 *
 * A copy button or a theme swatch cannot work without JavaScript, yet each
 * one costs hundreds of bytes of markup: a page with dozens of them would
 * drown its text (the content-to-markup ratio agents and search engines
 * read). So the server HTML holds an empty box of the same size instead.
 * Links and downloads, which work without JavaScript, are never wrapped.
 */
export function WhenInteractive({ children, className }: WhenInteractiveProps) {
  const isHydrated = useHydrated();
  return (
    <div className={className} data-pending={isHydrated ? undefined : ""}>
      {isHydrated ? children : null}
    </div>
  );
}
