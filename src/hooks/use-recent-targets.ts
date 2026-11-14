"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";

/**
 * The targets a visitor looked at last, kept in local storage and offered
 * when the target input is empty. Nothing here leaves the browser.
 */

const RecentTargetSchema = z.object({
  /** `login` or `owner/name`, with GitHub's capitalisation. */
  slug: z.string().min(1).max(141),
  kind: z.enum(["user", "org", "repo"]),
  /** Display name or repository description. */
  title: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});

export type RecentTarget = z.infer<typeof RecentTargetSchema>;

export const RECENT_TARGETS_KEY = "gitbanners:recent-targets";
export const MAX_RECENT_TARGETS = 5;
const CHANGE_EVENT = "gitbanners:recent-targets";
const EMPTY: readonly RecentTarget[] = [];

/** Reads the stored list. Anything unreadable or of another shape is dropped. */
export function parseRecentTargets(raw: string | null): RecentTarget[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const targets: RecentTarget[] = [];
  for (const item of value) {
    const parsed = RecentTargetSchema.safeParse(item);
    if (parsed.success) targets.push(parsed.data);
  }
  return targets.slice(0, MAX_RECENT_TARGETS);
}

/** `target` first, without its older copy, capped at the maximum. */
export function addRecentTarget(
  list: readonly RecentTarget[],
  target: RecentTarget,
): RecentTarget[] {
  const slug = target.slug.toLowerCase();
  return [
    target,
    ...list.filter((item) => item.slug.toLowerCase() !== slug),
  ].slice(0, MAX_RECENT_TARGETS);
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(RECENT_TARGETS_KEY);
  } catch {
    return null;
  }
}

// useSyncExternalStore needs the same array back until the storage changes.
let snapshotRaw: string | null = null;
let snapshot: readonly RecentTarget[] = EMPTY;

function getSnapshot(): readonly RecentTarget[] {
  const raw = readRaw();
  if (raw !== snapshotRaw) {
    snapshotRaw = raw;
    snapshot = parseRecentTargets(raw);
  }
  return snapshot;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** Puts a target at the top of the recent list. */
export function rememberRecentTarget(target: RecentTarget): void {
  try {
    const next = addRecentTarget(parseRecentTargets(readRaw()), target);
    window.localStorage.setItem(RECENT_TARGETS_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Private mode or a full quota: recents are a convenience, not a feature.
  }
}

/**
 * Recent targets, newest first. Empty on the server and during hydration;
 * the stored list appears right after.
 */
export function useRecentTargets(): readonly RecentTarget[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
