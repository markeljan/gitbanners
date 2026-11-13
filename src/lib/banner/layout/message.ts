"use no memo";

import { ABSOLUTE_MIN_TYPE } from "@/lib/banner/canvas";
import {
  boxOf,
  type Ctx,
  finePrint,
  textLineHeight,
  titleLine,
  withRamp,
} from "@/lib/banner/context";
import { compact, textBlock, textLine } from "@/lib/banner/draw";
import type { Layout } from "@/lib/banner/layout/types";
import { hostOf, planBrand } from "@/lib/banner/sections/footer";

/**
 * A card with a message and nothing else: unknown account, GitHub not
 * answering. Calm on purpose: it sits in someone's README until the next
 * refresh, so it states the fact in the banner's own theme and does not shout.
 */

interface Metrics {
  ctx: Ctx;
  titleSize: number;
  titleHeight: number;
  detailSize: number;
  detailLine: number;
  gap: number;
  /** Lines kept for the detail; 0 leaves it out. */
  lines: number;
  /** Height of title and detail together. */
  content: number;
}

function measure(ctx: Ctx, withDetail: boolean): Metrics {
  const { ramp } = ctx;
  const card = ctx.canvas.chrome === "card";
  const titleSize = card ? ramp.body + 2 : ramp.title;
  const titleHeight = card ? textLineHeight(titleSize) : titleLine(titleSize);
  const detailSize = card ? ramp.small + 1 : ramp.body;
  const detailLine = textLineHeight(detailSize);
  const gap = withDetail ? Math.round(ramp.small / 3) : 0;
  const lines = withDetail ? 2 : 0;
  return {
    ctx,
    titleSize,
    titleHeight,
    detailSize,
    detailLine,
    gap,
    lines,
    content: titleHeight + gap + lines * detailLine,
  };
}

/**
 * The largest type at which the message fits `available`: first with its
 * detail, then without. A fixed canvas can be as low as 120 px.
 */
function fit(ctx: Ctx, withDetail: boolean, available: number): Metrics {
  const smallest = ABSOLUTE_MIN_TYPE - 3;
  for (const detail of withDetail ? [true, false] : [false]) {
    for (let size = ctx.ramp.small; size >= smallest; size--) {
      const metrics = measure(withRamp(ctx, size), detail);
      if (metrics.content <= available) return metrics;
    }
  }
  return measure(withRamp(ctx, smallest), false);
}

export function layoutMessage(
  ctx: Ctx,
  message: { title: string; detail: string },
): Layout {
  const { canvas, palette } = ctx;
  const withDetail = message.detail.length > 0;
  const right = canvas.width - canvas.inset.right;
  let left = canvas.inset.left;
  const top = canvas.inset.top;
  let m = measure(ctx, withDetail);
  let bottom = top + m.content;
  if (canvas.height !== null) {
    bottom = canvas.height - canvas.inset.bottom;
    m = fit(ctx, withDetail, bottom - top);
    const zone = canvas.safeZone;
    if (zone && zone.y - top >= m.content) {
      // Above the area the destination covers with its own UI...
      bottom = zone.y;
    } else if (zone) {
      // ...or beside it, when the strip above is too shallow.
      const gutter = Math.round(m.ctx.ramp.small * 1.25);
      left = Math.min(right, zone.x + zone.width + gutter);
    }
  }
  const width = right - left;
  const height = canvas.height ?? bottom + canvas.inset.bottom;

  // The host is the only mark: a message card is about no one's profile.
  const host = ctx.options.brand ? hostOf(ctx) : "";
  const hostWidth = host ? boxOf(m.ctx, host, finePrint(m.ctx)) : 0;
  const mark =
    host && hostWidth < width / 2 ? planBrand(m.ctx, host, hostWidth) : null;
  const y = Math.max(top, top + Math.floor((bottom - top - m.content) / 2));
  // On a fixed canvas the mark sits in the bottom-right corner, where every
  // other banner has it, when the message leaves that corner free. On a card
  // (and on a canvas too low for both) it shares the message's last line.
  const corner =
    mark && canvas.height !== null
      ? canvas.height - canvas.inset.bottom - mark.height
      : null;
  const cornered =
    corner !== null && corner >= y + m.content + m.ctx.ramp.small;
  const textWidth =
    width - (mark && !cornered ? hostWidth + m.ctx.ramp.small * 2 : 0);

  return {
    width: canvas.width,
    height,
    heatmap: null,
    nodes: compact([
      textLine({
        x: left,
        y,
        width: textWidth,
        text: message.title,
        size: m.titleSize,
        line: m.titleHeight,
        weight: m.ctx.ramp.strong,
        color: palette.colors.text,
      }),
      m.lines
        ? textBlock({
            x: left,
            y: y + m.titleHeight + m.gap,
            width: textWidth,
            text: message.detail,
            size: m.detailSize,
            line: m.detailLine,
            lines: m.lines,
            color: palette.colors.muted,
          })
        : null,
      ...(mark
        ? mark.at(
            right - hostWidth,
            cornered && corner !== null
              ? corner
              : Math.max(top, y + m.content - mark.height),
          )
        : []),
    ]),
  };
}
