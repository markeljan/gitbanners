"use client";

import { useEffect, useState } from "react";

/**
 * `value`, but only after it stopped changing for `delayMs`. A delay of 0 (or
 * less) returns the value as it is, in the same render.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (delayMs <= 0) return;
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return delayMs <= 0 ? value : debounced;
}
