/**
 * Deterministic SVG post-process: tag heatmap cells so CSS can animate them.
 * Works on the SVG text of takumi-js 2.20 `renderSvg` and satori 0.63 output.
 * Cells are rounded rects of a known size/radius whose fill is one of the heat palette colors.
 */
export type HeatmapSpec = {
  cell: number; // px, e.g. 20
  radius: number; // px, e.g. 5
  gap: number; // px, e.g. 5
  colors: string[]; // heat palette, level 0..n (lowercase hex as written in the JSX)
  expected?: number; // weeks * 7 — if given and the match count differs, the SVG is returned untouched
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** number formatting used by takumi's SVG writer: max 2 decimals, no leading zero, no trailing zeros */
const n = (v: number) => {
  const s = (Math.round(v * 100) / 100).toString();
  return s.startsWith("0.")
    ? s.slice(1)
    : s.startsWith("-0.")
      ? `-${s.slice(2)}`
      : s;
};

function takumiCellRe({ cell: w, radius: r, colors }: HeatmapSpec) {
  const k = r * 0.5522847498; // cubic-bezier circle constant
  const a = n(k);
  const b = n(r - k);
  const s = w - 2 * r;
  // M{x+r} {y} h{s} c{k} 0 {r} {r-k} {r} {r} v{s} c0 {k}-{r-k} {r}-{r} {r} h-{s} c-{k} 0-{r}-{r-k}-{r}-{r} v-{s} c0-{k} {r-k}-{r} {r}-{r} Z
  const tail = `h${s}c${a} 0 ${r} ${b} ${r} ${r}v${s}c0 ${a}-${b} ${r}-${r} ${r}h-${s}c-${a} 0-${r}-${b}-${r}-${r}v-${s}c0-${a} ${b}-${r} ${r}-${r}Z`;
  return new RegExp(
    `<path d="M(-?[\\d.]+) (-?[\\d.]+)${esc(tail)}" fill="(${colors.map(esc).join("|")})"/>`,
    "g",
  );
}
function satoriCellRe({ cell: w, colors }: HeatmapSpec) {
  return new RegExp(
    `<path x="(-?[\\d.]+)" y="(-?[\\d.]+)" width="${w}" height="${w}" fill="(${colors.map(esc).join("|")})" d="[^"]+"/>`,
    "g",
  );
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

export function animateHeatmap(
  svg: string,
  spec: HeatmapSpec,
): { svg: string; cells: number; engine: "takumi" | "satori" | "none" } {
  const isSatori = svg.includes("satori_");
  const re = isSatori ? satoriCellRe(spec) : takumiCellRe(spec);
  const pitch = spec.cell + spec.gap;
  const offset = isSatori ? 0 : spec.radius; // takumi's M x is the left edge + radius
  // pass 1: find the grid origin so (col,row) are stable indices
  let minX = Infinity;
  let minY = Infinity;
  let cells = 0;
  for (const m of svg.matchAll(re)) {
    cells++;
    minX = Math.min(minX, +m[1] - offset);
    minY = Math.min(minY, +m[2]);
  }
  if (cells === 0 || (spec.expected !== undefined && cells !== spec.expected))
    return { svg, cells, engine: "none" };
  // pass 2: add class + custom properties (inline style is allowed by GitHub camo CSP: style-src 'unsafe-inline')
  const out = svg.replace(re, (tag, x, y, fill) => {
    const c = Math.round((+x - offset - minX) / pitch);
    const r = Math.round((+y - minY) / pitch);
    const lvl = spec.colors.indexOf(fill);
    return `${tag.slice(0, 5)} class="gb-c${lvl === spec.colors.length - 1 ? " gb-l4" : ""}" style="--c:${c};--r:${r}"${tag.slice(5)}`;
  });
  // inject <style> right after the opening <svg ...> tag
  const i = out.indexOf(">") + 1;
  return {
    svg: `${out.slice(0, i)}<style>${HEATMAP_CSS()}</style>${out.slice(i)}`,
    cells,
    engine: isSatori ? "satori" : "takumi",
  };
}
