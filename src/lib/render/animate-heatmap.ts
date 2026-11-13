/**
 * Deterministic SVG post-process: tag heatmap cells so CSS can animate them.
 *
 * Works on the SVG text Takumi 2.20 writes. A heatmap cell is a rounded square
 * of a known size and corner radius whose fill is one of the heat colours:
 *
 *   <path d="M12 10h6c1.1 0 2 .9 2 2v6c0 1.1-.9 2-2 2h-6c-1.1 0-2-.9-2-2v-6c0-1.1.9-2 2-2Z" fill="#2ea043"/>
 *
 * (a plain `<rect>` when the radius is 0). The writer minifies numbers: at most
 * two decimals, no leading zero, and no separator before a sign or a leading
 * dot, so the path is tokenised and compared numerically instead of as text.
 */
export type HeatmapSpec = {
  /** Cell edge in px. */
  cell: number;
  /** Corner radius in px (0 for square cells). */
  radius: number;
  /** Gap between cells in px. */
  gap: number;
  /** Heat palette, level 0..n, as hex colours (any case, 3 or 6 digits). */
  colors: readonly string[];
  /** weeks * 7. When given and the match count differs, nothing is changed. */
  expected?: number;
};

export type AnimateResult = {
  svg: string;
  cells: number;
  engine: "takumi" | "none";
};

/** Circle approximation constant of a cubic Bézier quarter arc. */
const KAPPA = 0.5522847498;
/** The writer rounds to 2 decimals; allow one unit of rounding on each side. */
const EPSILON = 0.011;

const NUMBER = "-?(?:\\d+\\.?\\d*|\\.\\d+)";
const NUMBERS_RE = new RegExp(NUMBER, "g");
/** Candidate rounded squares: M x y h c v c h c v c Z and a solid hex fill. */
const ROUNDED_RE = new RegExp(
  `<path d="M(${NUMBER}) ?(${NUMBER})h(${NUMBER})c([-\\d. ]+)v(${NUMBER})c([-\\d. ]+)h(${NUMBER})c([-\\d. ]+)v(${NUMBER})c([-\\d. ]+)Z" fill="(#[0-9a-fA-F]{3,6})"/>`,
  "g",
);
const RECT_RE = new RegExp(
  `<rect x="(${NUMBER})" y="(${NUMBER})" width="(${NUMBER})" height="(${NUMBER})" fill="(#[0-9a-fA-F]{3,6})"/>`,
  "g",
);

function canonicalHex(color: string): string {
  const hex = color.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex;
}

const near = (a: number, b: number) => Math.abs(a - b) <= EPSILON;

function curveIs(text: string, expected: readonly number[]): boolean {
  const found = text.match(NUMBERS_RE);
  if (found?.length !== expected.length) return false;
  return expected.every((value, i) => near(Number(found[i]), value));
}

type Cell = {
  /** Offset of the tag in the SVG text. */
  index: number;
  /** Length of the tag's opening keyword, e.g. `<path`. */
  keyword: number;
  x: number;
  y: number;
  level: number;
};

function findCells(svg: string, spec: HeatmapSpec): Cell[] {
  const levels = new Map<string, number>();
  spec.colors.forEach((color, level) => {
    // The first level wins when two levels share a colour.
    const key = canonicalHex(color);
    if (!levels.has(key)) levels.set(key, level);
  });
  const { cell, radius: r } = spec;
  const cells: Cell[] = [];

  if (r <= 0) {
    for (const m of svg.matchAll(RECT_RE)) {
      const level = levels.get(canonicalHex(m[5]));
      if (level === undefined) continue;
      if (!near(Number(m[3]), cell) || !near(Number(m[4]), cell)) continue;
      cells.push({
        index: m.index,
        keyword: 5,
        x: Number(m[1]),
        y: Number(m[2]),
        level,
      });
    }
    return cells;
  }

  const k = r * KAPPA;
  const side = cell - 2 * r;
  const corners = [
    [k, 0, r, r - k, r, r],
    [0, k, -(r - k), r, -r, r],
    [-k, 0, -r, -(r - k), -r, -r],
    [0, -k, r - k, -r, r, -r],
  ] as const;
  for (const m of svg.matchAll(ROUNDED_RE)) {
    const level = levels.get(canonicalHex(m[11]));
    if (level === undefined) continue;
    if (
      !near(Number(m[3]), side) ||
      !near(Number(m[5]), side) ||
      !near(Number(m[7]), -side) ||
      !near(Number(m[9]), -side)
    ) {
      continue;
    }
    if (
      !curveIs(m[4], corners[0]) ||
      !curveIs(m[6], corners[1]) ||
      !curveIs(m[8], corners[2]) ||
      !curveIs(m[10], corners[3])
    ) {
      continue;
    }
    // The path starts at the end of the top-left corner: left edge + radius.
    cells.push({
      index: m.index,
      keyword: 5,
      x: Number(m[1]) - r,
      y: Number(m[2]),
      level,
    });
  }
  return cells;
}

export const HEATMAP_CSS = (stepMs = 14) =>
  `
@keyframes gb-pop{from{opacity:0;transform:scale(.3)}to{opacity:1;transform:none}}
.gb-c{transform-box:fill-box;transform-origin:center;animation:gb-pop .45s cubic-bezier(.2,.9,.3,1.2) both;animation-delay:calc(var(--c)*${stepMs}ms + var(--r)*${Math.round(stepMs / 2)}ms)}
@keyframes gb-glow{50%{filter:brightness(1.35)}}
.gb-l4{animation:gb-pop .45s cubic-bezier(.2,.9,.3,1.2) both,gb-glow 2.4s ease-in-out 1.6s infinite;animation-delay:calc(var(--c)*${stepMs}ms + var(--r)*${Math.round(stepMs / 2)}ms),calc(1.6s + var(--c)*40ms)}
@media (prefers-reduced-motion:reduce){.gb-c,.gb-l4{animation:none}}`.replace(
    /\n/g,
    "",
  );

/**
 * Adds a staggered "pop in" animation to every heatmap cell and a soft pulse
 * to the cells of the highest level. Returns the SVG untouched when no cell
 * matches or when the count differs from `spec.expected`.
 *
 * Inline styles and a `<style>` element are allowed by the CSP GitHub's image
 * proxy applies to SVGs (`style-src 'unsafe-inline'`); scripts are not needed.
 */
export function animateHeatmap(svg: string, spec: HeatmapSpec): AnimateResult {
  const cells = findCells(svg, spec);
  const count = cells.length;
  if (count === 0 || (spec.expected !== undefined && count !== spec.expected)) {
    return { svg, cells: count, engine: "none" };
  }
  const pitch = spec.cell + spec.gap;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const cell of cells) {
    minX = Math.min(minX, cell.x);
    minY = Math.min(minY, cell.y);
  }
  const top = spec.colors.length - 1;
  let out = "";
  let cursor = 0;
  for (const cell of cells) {
    const at = cell.index + cell.keyword;
    const column = Math.round((cell.x - minX) / pitch);
    const row = Math.round((cell.y - minY) / pitch);
    const glow = cell.level === top ? " gb-l4" : "";
    out += `${svg.slice(cursor, at)} class="gb-c${glow}" style="--c:${column};--r:${row}"`;
    cursor = at;
  }
  out += svg.slice(cursor);
  // The style element goes right after the opening <svg ...> tag.
  const open = out.indexOf(">") + 1;
  return {
    svg: `${out.slice(0, open)}<style>${HEATMAP_CSS()}</style>${out.slice(open)}`,
    cells: count,
    engine: "takumi",
  };
}
