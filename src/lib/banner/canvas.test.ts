import { describe, expect, test } from "bun:test";
import { resolveCanvas } from "@/lib/banner/canvas";
import { SIZE_IDS } from "@/lib/banner/options";
import { fitHeatmap, SIZE_FACTS, SIZES } from "@/lib/banner/sizes";
import type { BannerOptions } from "@/lib/banner/types";

type CanvasOptions = Pick<
  BannerOptions,
  "size" | "width" | "height" | "radius" | "border"
>;

function canvas(patch: Partial<CanvasOptions> = {}) {
  return resolveCanvas({
    size: "readme",
    width: null,
    height: null,
    radius: null,
    border: null,
    ...patch,
  });
}

describe("resolveCanvas", () => {
  test("the README card", () => {
    expect(canvas()).toEqual({
      width: 846,
      height: null,
      inset: { top: 24, right: 24, bottom: 24, left: 24 },
      safeZone: null,
      unit: 12,
      minType: 11,
      chrome: "card",
      radius: 12,
      border: true,
    });
  });

  test("every fixed size is its own canvas, inset and zone", () => {
    const minimum = { x: 24, linkedin: 24, og: 24, social: 20, square: 28 };
    for (const id of SIZE_IDS) {
      if (id === "readme") continue;
      const size = SIZES[id];
      const [top, right, bottom, left] = SIZE_FACTS[id].inset;
      expect(canvas({ size: id })).toEqual({
        width: size.width,
        height: size.height,
        inset: { top, right, bottom, left },
        safeZone: size.safeZone
          ? {
              x: size.safeZone.x,
              y: size.safeZone.y,
              width: size.safeZone.width,
              height: size.safeZone.height,
            }
          : null,
        unit: minimum[id],
        minType: minimum[id],
        chrome: "poster",
        radius: 0,
        border: false,
      });
    }
  });

  test("a custom width on the README keeps the height automatic", () => {
    const narrow = canvas({ width: 495 });
    expect(narrow).toMatchObject({ width: 495, height: null, chrome: "card" });
    expect(narrow.unit).toBe(11);
    expect(narrow.inset.left).toBe(20);
    const wide = canvas({ width: 1692 });
    expect(wide).toMatchObject({
      width: 1692,
      height: null,
      unit: 24,
      radius: 24,
    });
    expect(wide.inset).toEqual({ top: 48, right: 48, bottom: 48, left: 48 });
  });

  test("a custom width on a fixed size scales the whole canvas", () => {
    const doubled = canvas({ size: "x", width: 3000 });
    expect(doubled).toMatchObject({ width: 3000, height: 1000, unit: 48 });
    expect(doubled.inset).toEqual({
      top: 120,
      right: 96,
      bottom: 120,
      left: 96,
    });
    expect(doubled.safeZone).toEqual({ x: 0, y: 600, width: 860, height: 400 });
    const small = canvas({ size: "x", width: 320 });
    expect(small).toMatchObject({ width: 320, height: 107, unit: 11 });
  });

  test("a canvas that leaves the size's shape has no known photo zone", () => {
    expect(canvas({ size: "x", height: 700 }).safeZone).toBeNull();
    expect(
      canvas({ size: "x", width: 1500, height: 500 }).safeZone,
    ).not.toBeNull();
    expect(
      canvas({ size: "linkedin", width: 2000, height: 396 }).safeZone,
    ).toBeNull();
  });

  test("a fixed-height README card keeps its card look", () => {
    const fixed = canvas({ width: 495, height: 195 });
    expect(fixed).toMatchObject({
      width: 495,
      height: 195,
      chrome: "card",
      border: true,
      radius: 12,
    });
    expect(fixed.inset.top).toBeLessThanOrEqual(fixed.inset.left);
    expect(canvas({ width: 320, height: 120 }).inset.top).toBe(17);
  });

  test("radius and border follow the options when they are set", () => {
    expect(canvas({ radius: 0, border: false })).toMatchObject({
      radius: 0,
      border: false,
    });
    expect(canvas({ size: "og", radius: 32, border: true })).toMatchObject({
      radius: 32,
      border: true,
    });
  });

  test("is total: junk falls back or is clamped", () => {
    const junk = resolveCanvas({
      size: "billboard" as never,
      width: Number.NaN,
      height: Number.POSITIVE_INFINITY,
      radius: -5 as never,
      border: "yes" as never,
    });
    expect(junk).toMatchObject({
      width: 846,
      height: null,
      radius: 0,
      border: true,
    });
    expect(canvas({ width: 5 }).width).toBe(320);
    expect(canvas({ width: 1e9 }).width).toBe(3000);
    expect(canvas({ height: 1 }).height).toBe(120);
    expect(canvas({ width: 900.6 }).width).toBe(901);
    expect(canvas({ size: "__proto__" as never }).width).toBe(846);
  });
});

describe("fitHeatmap", () => {
  test("matches the sizes the layouts were designed around", () => {
    expect(fitHeatmap(768, Number.POSITIVE_INFINITY)).toMatchObject({
      cell: 11,
      gap: 3,
      radius: 2,
      width: 739,
      height: 95,
    });
    expect(fitHeatmap(1404, 150)).toMatchObject({
      cell: 17,
      gap: 5,
      radius: 3,
      width: 1161,
      height: 149,
    });
    expect(fitHeatmap(1404, 240)).toMatchObject({
      cell: 20,
      gap: 6,
      radius: 4,
      width: 1372,
      height: 176,
    });
    expect(fitHeatmap(1088, 1000)).toMatchObject({
      cell: 15,
      gap: 5,
      width: 1055,
      height: 135,
    });
    expect(fitHeatmap(447, 1000)).toMatchObject({
      cell: 6,
      gap: 2,
      radius: 1,
      width: 422,
      height: 54,
    });
  });

  test("is the largest that fits: one pixel more per cell would not", () => {
    const fits = (
      cell: number,
      cols: number,
      width: number,
      height: number,
    ) => {
      const gap = Math.max(1, Math.round(cell * 0.3));
      return (
        cols * cell + (cols - 1) * gap <= width && 7 * cell + 6 * gap <= height
      );
    };
    for (let width = 150; width <= 3000; width += 13) {
      for (const height of [20, 60, 150, 400, Number.POSITIVE_INFINITY]) {
        for (const cols of [14, 27, 53, 54]) {
          const fit = fitHeatmap(width, height, cols);
          if (fit.cell > 2) {
            expect(fits(fit.cell, cols, width, height)).toBe(true);
          }
          expect({
            width,
            height,
            cols,
            larger: fits(fit.cell + 1, cols, width, height),
          }).toEqual({ width, height, cols, larger: false });
        }
      }
    }
    // Rounded gaps leave room the exact proportion does not see: 14 px
    // cells with 4 px gaps are 950 px wide, 13.85 px ones would be too.
    expect(fitHeatmap(950, 1000)).toMatchObject({ cell: 14, gap: 4 });
  });

  test("a box of a heatmap's own size gets that heatmap back", () => {
    // Layouts lay everything out a second time at the graph's width (its
    // "measure"); the graph must not shrink when asked to fit itself.
    for (let width = 150; width <= 3000; width += 29) {
      for (const cols of [27, 53, 54]) {
        const fit = fitHeatmap(width, Number.POSITIVE_INFINITY, cols);
        if (fit.cell <= 2) continue;
        expect(fitHeatmap(fit.width, fit.height, cols)).toEqual(fit);
      }
    }
  });

  test("always fits the box it was given, down to the 2 px floor", () => {
    for (let width = 150; width <= 3000; width += 37) {
      for (const height of [20, 60, 150, 400, Number.POSITIVE_INFINITY]) {
        for (const cols of [14, 27, 53, 54]) {
          const fit = fitHeatmap(width, height, cols);
          expect(Number.isInteger(fit.cell)).toBe(true);
          expect(fit.gap).toBeGreaterThanOrEqual(1);
          expect(fit.width).toBe(cols * fit.cell + (cols - 1) * fit.gap);
          expect(fit.height).toBe(7 * fit.cell + 6 * fit.gap);
          if (fit.cell > 2) {
            expect(fit.width).toBeLessThanOrEqual(width);
            expect(fit.height).toBeLessThanOrEqual(height);
          }
        }
      }
    }
  });
});
