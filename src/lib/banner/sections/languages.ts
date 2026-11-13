"use no memo";

import {
  type Block,
  boxOf,
  type Ctx,
  textLineHeight,
} from "@/lib/banner/context";
import { box, compact, type Node, textLine } from "@/lib/banner/draw";
import { normalizeHex } from "@/lib/banner/options";
import { plainText } from "@/lib/banner/text";
import type { LanguageShare } from "@/lib/github/schema";

/**
 * Language mix: one stacked bar and a legend. Colours are GitHub Linguist's
 * and come with the data; the theme never recolours them.
 */

export interface LanguagesSpec {
  width: number;
  /** Most languages to name; the rest is summed up as "Other". */
  count: number | null;
}

interface Share {
  name: string;
  color: string;
  percent: number;
}

const DEFAULT_COUNT = 6;

function sharesOf(ctx: Ctx, count: number): Share[] {
  const { entity, palette } = ctx;
  const source: readonly LanguageShare[] = Array.isArray(entity.languages)
    ? entity.languages
    : [];
  const valid = source
    .filter((item) => item && Number.isFinite(item.percent) && item.percent > 0)
    .map((item) => ({
      name: plainText(item.name) || "Unknown",
      color: normalizeHex(item.color) ?? palette.colors.muted,
      percent: Math.min(100, item.percent),
    }));
  const named = valid.slice(0, count);
  const rest = valid.slice(count).reduce((sum, item) => sum + item.percent, 0);
  if (rest > 0.05) {
    named.push({ name: "Other", color: palette.colors.border, percent: rest });
  }
  return named;
}

function percentLabel(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  return `${rounded.toFixed(1).replace(/\.0$/, "")}%`;
}

/** Whole-pixel segment widths that add up to exactly `width`. */
function segmentWidths(
  shares: readonly Share[],
  width: number,
  gap: number,
): number[] {
  const usable = Math.max(0, width - gap * (shares.length - 1));
  const total = shares.reduce((sum, share) => sum + share.percent, 0) || 1;
  const widths = shares.map((share) =>
    Math.max(1, Math.floor((share.percent / total) * usable)),
  );
  // Hand the pixels lost to rounding to the largest segment.
  const lost = usable - widths.reduce((sum, value) => sum + value, 0);
  const largest = widths.indexOf(Math.max(...widths));
  if (largest >= 0) widths[largest] = Math.max(1, widths[largest] + lost);
  return widths;
}

/**
 * Stand-ins while a user's languages are still loading: the bar and as many
 * legend entries as were asked for keep their place, so the banner does not
 * jump when the data arrives.
 */
function placeholders(ctx: Ctx, count: number): Share[] {
  const color = ctx.palette.colors.surface;
  return Array.from({ length: count }, (_, index) => ({
    name: "",
    color,
    percent: Math.max(4, 44 - index * 9),
  }));
}

/**
 * Plans the bar and its legend. Returns `null` when there is no language
 * data (and none is on its way).
 */
export function planLanguages(ctx: Ctx, spec: LanguagesSpec): Block | null {
  const { ramp, palette, entity } = ctx;
  const count = Math.max(1, spec.count ?? DEFAULT_COUNT);
  const known = sharesOf(ctx, count);
  const pending =
    known.length === 0 && entity.kind === "user" && entity.complete === false;
  const shares = pending ? placeholders(ctx, count) : known;
  if (shares.length === 0 || spec.width <= 0) return null;

  const bar = Math.max(4, Math.round(ramp.small * 0.67));
  const barGap = Math.max(2, ramp.hair * 2);
  const widths = segmentWidths(shares, spec.width, barGap);

  const size = ramp.small;
  const line = textLineHeight(size);
  const dot = Math.round(size * 0.85);
  const dotGap = Math.round(size * 0.5);
  const spacing = Math.round(size * 0.4);
  const items = shares.map((share) => {
    // A placeholder has no text, but takes the room of a typical entry.
    const percent = pending ? "" : percentLabel(share.percent);
    const name = pending ? size * 5 : boxOf(ctx, share.name, size, ramp.strong);
    const value = pending ? size * 3 : boxOf(ctx, percent, size);
    return {
      share,
      percent,
      name,
      value,
      width: dot + dotGap + name + spacing + value,
    };
  });
  const widest = Math.max(...items.map((item) => item.width));
  const fits = Math.max(
    1,
    Math.min(items.length, Math.floor(spec.width / (widest + size * 2))),
  );
  // Balanced rows (3 + 3, not 5 + 1): no orphan in the last one.
  const rows = Math.ceil(items.length / fits);
  const columns = Math.ceil(items.length / rows);
  const pitch = Math.floor(spec.width / columns);
  const legendTop = bar + Math.round(size * 1.2);
  const rowGap = Math.round(size * 0.5);

  const at = (x: number, y: number): Node[] => {
    const nodes: (Node | null)[] = [];
    let cursor = x;
    shares.forEach((share, index) => {
      const first = index === 0;
      const last = index === shares.length - 1;
      nodes.push(
        box(cursor, y, widths[index], bar, {
          backgroundColor: share.color,
          borderTopLeftRadius: first ? bar / 2 : 0,
          borderBottomLeftRadius: first ? bar / 2 : 0,
          borderTopRightRadius: last ? bar / 2 : 0,
          borderBottomRightRadius: last ? bar / 2 : 0,
        }),
      );
      cursor += widths[index] + barGap;
    });
    items.forEach((item, index) => {
      const left = x + (index % columns) * pitch;
      const top = y + legendTop + Math.floor(index / columns) * (line + rowGap);
      const room = pitch - size - dot - dotGap;
      const name = Math.max(
        0,
        Math.min(item.name, room - spacing - item.value),
      );
      const stub = Math.max(2, Math.round(size * 0.55));
      nodes.push(
        box(left, top + Math.round((line - dot) / 2), dot, dot, {
          borderRadius: dot / 2,
          backgroundColor: item.share.color,
        }),
        pending
          ? box(
              left + dot + dotGap,
              top + Math.round((line - stub) / 2),
              name,
              stub,
              { borderRadius: stub / 2, backgroundColor: item.share.color },
            )
          : null,
        textLine({
          x: left + dot + dotGap,
          y: top,
          width: name,
          text: item.share.name,
          size,
          line,
          weight: ramp.strong,
          color: palette.colors.text,
        }),
        textLine({
          x: left + dot + dotGap + name + spacing,
          y: top,
          width: item.value,
          text: item.percent,
          size,
          line,
          color: palette.colors.muted,
        }),
      );
    });
    return compact(nodes);
  };

  return {
    width: spec.width,
    height: legendTop + rows * line + (rows - 1) * rowGap,
    at,
  };
}
