"use no memo";

import type { CSSProperties, ReactElement } from "react";
import { createElement } from "react";
import type { IconData } from "@/lib/banner/icons";

/**
 * Drawing primitives.
 *
 * A banner is a flat list of absolutely positioned leaves inside one root:
 * every position and size is a whole pixel computed by the layout code, so
 * the browser preview, the SVG and the PNG cannot disagree about where a box
 * is. The primitives encode the rules the three renderers need to agree on
 * the rest (see the "rules for banner components" in the image-engine notes):
 * only div / span / img / svg, inline styles, explicit box-sizing, text in
 * block leaves, the `-webkit-box` clamp, quoted font families.
 */

export type Node = ReactElement;

/** One run of a text line. Runs sit on the line's baseline, whatever their size. */
export interface TextRun {
  text: string;
  color?: string;
  weight?: number;
  /** Font size in px when it differs from the line's. */
  size?: number;
}

export interface TextSpec {
  /** Left edge of the box. */
  x: number;
  /** Top of the first line box. */
  y: number;
  /** Box width: text that does not fit is cut with an ellipsis. */
  width: number;
  text: string | readonly TextRun[];
  /** Font size in px. */
  size: number;
  /** Line height in px. */
  line: number;
  color: string;
  weight?: number;
  align?: "left" | "right" | "center";
  /** CSS font-family for this leaf only (already quoted). */
  family?: string;
}

/**
 * Typographic constants of the Mona Sans static files (the same for the Mono
 * cut), measured through the renderer: the glyph box is 1.41 em tall with the
 * baseline 1.09 em below its top, capitals are 0.73 em tall.
 */
const ASCENT = 1.09;
const CONTENT = 1.41;
export const CAP_HEIGHT = 0.73;

/** Distance from the top of a line box to its baseline. */
export function baselineOffset(size: number, line: number): number {
  return (line - CONTENT * size) / 2 + ASCENT * size;
}

/** Distance from the top of a line box to the top of a capital letter. */
export function capOffset(size: number, line: number): number {
  return baselineOffset(size, line) - CAP_HEIGHT * size;
}

/**
 * Padding that keeps accents and descenders inside a clipped one-line box.
 * A tight line box is shorter than the font's own glyph box, and
 * `overflow: hidden` (needed for the ellipsis) would otherwise shave the top
 * of "Å" or the tail of "g".
 */
function clipPadding(size: number, line: number): number {
  return Math.max(0, Math.ceil((CONTENT * size - line) / 2) + 1);
}

function runs(text: string | readonly TextRun[]): (string | ReactElement)[] {
  if (typeof text === "string") return [text];
  return text
    .filter((run) => run.text)
    .map((run) => {
      const style: CSSProperties = {};
      if (run.color) style.color = run.color;
      if (run.weight) style.fontWeight = run.weight;
      if (run.size) style.fontSize = run.size;
      return createElement("span", { style }, run.text);
    });
}

function hasText(text: string | readonly TextRun[]): boolean {
  return typeof text === "string"
    ? text.length > 0
    : text.some((run) => run.text.length > 0);
}

function typeStyle(spec: TextSpec): CSSProperties {
  const style: CSSProperties = {
    fontSize: spec.size,
    lineHeight: `${spec.line}px`,
    fontWeight: spec.weight ?? 400,
    color: spec.color,
    textAlign: spec.align ?? "left",
  };
  if (spec.family) style.fontFamily = spec.family;
  return style;
}

/** One line of text, cut with an ellipsis when it does not fit. */
export function textLine(spec: TextSpec): Node | null {
  if (!hasText(spec.text) || spec.width <= 0) return null;
  // Never above the canvas. A line box that would start above it (tight
  // display type on a canvas with almost no inset) is trimmed by the same
  // amount on both sides, which keeps its baseline where it was, and a line
  // at the very top keeps less padding rather than a negative offset.
  const trim = Math.max(0, Math.ceil(-spec.y));
  const y = spec.y + trim;
  const line = Math.max(1, spec.line - 2 * trim);
  const pad = Math.min(clipPadding(spec.size, line), Math.floor(y));
  return createElement(
    "div",
    {
      style: {
        position: "absolute",
        left: spec.x,
        top: y - pad,
        width: spec.width,
        height: line + 2 * pad,
        boxSizing: "border-box",
        paddingTop: pad,
        paddingBottom: pad,
        display: "block",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        ...typeStyle({ ...spec, line }),
      } satisfies CSSProperties,
    },
    ...runs(spec.text),
  );
}

/**
 * A paragraph clamped to `lines` lines. The box is exactly `lines` line
 * boxes tall, so the line height must not be tighter than the font's own
 * 1.41 or the clamp would clip glyphs.
 */
export function textBlock(spec: TextSpec & { lines: number }): Node | null {
  if (!hasText(spec.text) || spec.width <= 0 || spec.lines < 1) return null;
  return createElement(
    "div",
    {
      style: {
        position: "absolute",
        left: spec.x,
        top: spec.y,
        width: spec.width,
        height: spec.line * spec.lines,
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: spec.lines,
        overflow: "hidden",
        ...typeStyle(spec),
      } satisfies CSSProperties,
    },
    ...runs(spec.text),
  );
}

/** A plain rectangle: fills, outlines, bars, cells. */
export function box(
  x: number,
  y: number,
  width: number,
  height: number,
  style: CSSProperties,
): Node {
  return createElement("div", {
    style: {
      position: "absolute",
      left: x,
      top: y,
      width,
      height,
      boxSizing: "border-box",
      ...style,
    } satisfies CSSProperties,
  });
}

/** An Octicon, filled with `color`. */
export function icon(
  data: IconData,
  x: number,
  y: number,
  size: number,
  color: string,
): Node {
  return createElement(
    "svg",
    {
      viewBox: data.viewBox,
      width: size,
      height: size,
      fill: "currentColor",
      style: {
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size,
        color,
      } satisfies CSSProperties,
    },
    createElement("path", { d: data.d }),
  );
}

/** One shape of a `vector` leaf, in the leaf's own pixel coordinates. */
export interface PathSpec {
  d: string;
  /** Fill colour; left out for an open line. */
  fill?: string;
  /** Stroke colour; left out for a filled shape. */
  stroke?: string;
  strokeWidth?: number;
  /** 0-1, for the soft area under a line. */
  opacity?: number;
}

/**
 * Free-form shapes in a box of their own: sparklines and area charts, the
 * only things a banner draws that are not rectangles. The box is a whole
 * pixel one like every other leaf; inside it the paths may use fractions,
 * because a trend line that snapped to pixels would turn into stairs.
 */
export function vector(
  x: number,
  y: number,
  width: number,
  height: number,
  paths: readonly PathSpec[],
): Node {
  return createElement(
    "svg",
    {
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      fill: "none",
      style: {
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
      } satisfies CSSProperties,
    },
    ...paths.map((path) =>
      createElement("path", {
        d: path.d,
        fill: path.fill ?? "none",
        ...(path.stroke
          ? {
              stroke: path.stroke,
              strokeWidth: path.strokeWidth ?? 1,
              strokeLinecap: "round",
              strokeLinejoin: "round",
            }
          : null),
        ...(path.opacity === undefined ? null : { opacity: path.opacity }),
      }),
    ),
  );
}

export interface ImageSpec {
  src: string;
  x: number;
  y: number;
  size: number;
  /** Corner radius in px; half the size makes a circle. */
  radius: number;
  /** Colour of the hairline ring around the picture. */
  ring: string;
  ringWidth: number;
  /** Shown instead of the picture when there is no drawable source. */
  placeholder: string;
}

/**
 * An avatar. Without a source (the fetch failed, or a dry run) a flat
 * placeholder of the same shape keeps the layout intact.
 */
export function image(spec: ImageSpec): Node {
  const style: CSSProperties = {
    position: "absolute",
    left: spec.x,
    top: spec.y,
    width: spec.size,
    height: spec.size,
    boxSizing: "border-box",
    borderRadius: spec.radius,
    border: `${spec.ringWidth}px solid ${spec.ring}`,
  };
  if (!spec.src) {
    return createElement("div", {
      style: { ...style, backgroundColor: spec.placeholder },
    });
  }
  return createElement("img", {
    src: spec.src,
    width: spec.size,
    height: spec.size,
    alt: "",
    style: { ...style, objectFit: "cover" } satisfies CSSProperties,
  });
}

/** Font, colour and metrics every leaf inherits from the root. */
export interface RootSpec {
  width: number;
  height: number;
  background: string;
  color: string;
  /** Registered family name, unquoted. */
  family: string;
  radius: number;
}

/**
 * The root element. It pins everything a page could otherwise leak into the
 * browser preview (font, size, weight, line height, spacing, alignment).
 */
export function root(spec: RootSpec, children: readonly Node[]): Node {
  return createElement(
    "div",
    {
      style: {
        position: "relative",
        display: "flex",
        boxSizing: "border-box",
        width: spec.width,
        height: spec.height,
        borderRadius: spec.radius,
        backgroundColor: spec.background,
        color: spec.color,
        fontFamily: `"${spec.family}"`,
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 1.25,
        letterSpacing: 0,
        textAlign: "left",
      } satisfies CSSProperties,
    },
    ...children,
  );
}

/** Drops the `null`s that optional leaves produce. */
export function compact(nodes: readonly (Node | null | false)[]): Node[] {
  return nodes.filter((node): node is Node => Boolean(node));
}
