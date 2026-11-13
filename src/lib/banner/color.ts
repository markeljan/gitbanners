"use no memo";

// Dependency-free colour helpers: sRGB <-> OKLab, WCAG contrast, alpha flattening and the heatmap ramp.
// Checked on 2026-11-12: hslToHex reproduces Atom One Dark's hex values, and heatRamp reproduces
// GitHub's own dark and light contribution ramps to within a few RGB steps.

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) throw new Error(`bad hex: ${hex}`);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function hexAlpha(hex: string): number {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 4) h = [...h].map((c) => c + c).join("");
  return h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
}

export function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

const toLinear = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (v: number) => {
  const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return s * 255;
};

export function rgbToOklab([r, g, b]: RGB): [number, number, number] {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgb([L, a, b]: [number, number, number]): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Perceptual mix: t=0 -> a, t=1 -> b (OKLab interpolation, clamped to sRGB). */
export function mix(a: string, b: string, t: number): string {
  const A = rgbToOklab(hexToRgb(a));
  const B = rgbToOklab(hexToRgb(b));
  return rgbToHex(
    oklabToRgb([
      A[0] + (B[0] - A[0]) * t,
      A[1] + (B[1] - A[1]) * t,
      A[2] + (B[2] - A[2]) * t,
    ]),
  );
}

/** Flatten a #rrggbbaa color over an opaque background (plain sRGB alpha compositing, like browsers). */
export function flatten(fg: string, bg: string): string {
  const a = hexAlpha(fg);
  const F = hexToRgb(fg);
  const B = hexToRgb(bg);
  return rgbToHex([
    F[0] * a + B[0] * (1 - a),
    F[1] * a + B[1] * (1 - a),
    F[2] * a + B[2] * (1 - a),
  ]);
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 2.x contrast ratio (1..21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function hslToHex(h: number, s: number, l: number): string {
  const S = s / 100;
  const Lv = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(Lv, 1 - Lv);
  const f = (n: number) =>
    Lv - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

export function oklabL(hex: string): number {
  return rgbToOklab(hexToRgb(hex))[0];
}

function oklchToHex(L: number, C: number, hRad: number): string {
  // Reduce chroma until the color fits in sRGB (simple gamut mapping that preserves L and hue).
  let c = C;
  for (let i = 0; i < 40; i++) {
    const rgb = oklabToRgb([L, c * Math.cos(hRad), c * Math.sin(hRad)]);
    if (rgb.every((v) => v >= -0.5 && v <= 255.5)) return rgbToHex(rgb);
    c *= 0.95;
  }
  return rgbToHex(oklabToRgb([L, 0, 0]));
}

/**
 * 5-step sequential heatmap ramp from ONE "heat" color, in OKLCH with constant hue.
 * The step coefficients are fitted to GitHub's own ramps (Primer 11.10.0):
 *   dark : heat = level 4 (brightest). Lightness climbs from the background, chroma grows 0.44 -> 1.
 *   light: heat = level 3. Level 1-2 are tints, level 4 is a darker, less saturated shade.
 * `empty` (level 0) is passed in: use the theme's surface (dark) or a faint neutral (light).
 */
export function heatRamp(
  mode: "dark" | "light",
  bg: string,
  empty: string,
  heat: string,
): [string, string, string, string, string] {
  const [Lb] = rgbToOklab(hexToRgb(bg));
  const [Lh, a, b] = rgbToOklab(hexToRgb(heat));
  const Ch = Math.hypot(a, b);
  const h = Math.atan2(b, a);
  // Level 1 must be visibly different from the empty cell: nudge its lightness until deltaE(OKLab) >= 0.09
  // (GitHub's own themes sit at 0.10-0.15). Only low-chroma / same-hue themes need the nudge.
  const MIN_DE = 0.09;
  if (mode === "dark") {
    const l1 = (f: number) => oklchToHex(Lb + (Lh - Lb) * f, Ch * 0.44, h);
    let f1 = 0.22;
    while (deltaE(empty, l1(f1)) < MIN_DE && f1 < 0.36) f1 += 0.01;
    const f2 = f1 + (0.75 - f1) * 0.51;
    return [
      empty,
      l1(f1),
      oklchToHex(Lb + (Lh - Lb) * f2, Ch * 0.65, h),
      oklchToHex(Lb + (Lh - Lb) * 0.75, Ch * 0.88, h),
      heat.toLowerCase(),
    ];
  }
  const l1 = (f: number) => oklchToHex(Lb - (Lb - Lh) * f, Ch * 0.59, h);
  let f1 = 0.3;
  while (deltaE(empty, l1(f1)) < MIN_DE && f1 < 0.42) f1 += 0.01;
  return [
    empty,
    l1(f1),
    oklchToHex(Lb - (Lb - Lh) * 0.75, Ch, h),
    heat.toLowerCase(),
    oklchToHex(Math.max(0.2, Lb - (Lb - Lh) * 1.53), Ch * 0.73, h),
  ];
}

/** Euclidean distance in OKLab (0 = identical, ~0.02 = just noticeable, 1 = black vs white). */
export function deltaE(x: string, y: string): number {
  const A = rgbToOklab(hexToRgb(x));
  const B = rgbToOklab(hexToRgb(y));
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}
