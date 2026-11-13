"use no memo";

import { type Node, vector } from "@/lib/banner/draw";

/**
 * A trend line: a number's recent history at the size of the number itself.
 * It answers "going up, flat or down?" at a glance and nothing more, so it
 * has no axes and scales to its own range.
 */

export interface SparklineSpec {
  /** Values oldest first; at least two. */
  values: readonly number[];
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  /** Line width in px. */
  stroke: number;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Draws the line with a faint fill under it. A history that never changed is
 * a level line through the middle: flat is information too.
 */
export function sparkline(spec: SparklineSpec): Node | null {
  const values = spec.values.filter((value) => Number.isFinite(value));
  if (values.length < 2 || spec.width < 4 || spec.height < 4) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  // The stroke is centred on the line: keep half of it inside the box.
  const pad = spec.stroke / 2 + 0.5;
  const innerWidth = spec.width - 2 * pad;
  const innerHeight = spec.height - 2 * pad;
  const points = values.map((value, index) => {
    const share = range > 0 ? (value - min) / range : 0.5;
    return [
      round(pad + (index * innerWidth) / (values.length - 1)),
      round(pad + (1 - share) * innerHeight),
    ] as const;
  });
  const line = points
    .map(([px, py], index) => `${index === 0 ? "M" : "L"}${px} ${py}`)
    .join("");
  const last = points[points.length - 1];
  const first = points[0];
  if (!last || !first) return null;
  const area = `${line}L${last[0]} ${spec.height}L${first[0]} ${spec.height}Z`;
  return vector(spec.x, spec.y, spec.width, spec.height, [
    { d: area, fill: spec.color, opacity: 0.16 },
    { d: line, stroke: spec.color, strokeWidth: spec.stroke },
  ]);
}
