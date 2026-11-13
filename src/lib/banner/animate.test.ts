import { describe, expect, test } from "bun:test";
import { buildBanner } from "@/lib/banner/build";
import { DEMO_NOW, demoEntity } from "@/lib/banner/demo";
import { parseOptions, resolveOptions, SIZE_IDS } from "@/lib/banner/options";
import { cellRadius } from "@/lib/banner/sizes";
import { THEME_EXTRAS, THEMES } from "@/lib/banner/themes";
import type { BuiltBanner, RenderEnv } from "@/lib/banner/types";
import { animateHeatmap, renderSvg } from "@/lib/render";

/**
 * The animation contract: `BuiltBanner.heatmap` must describe the day cells
 * exactly as the renderer writes them, or the SVG post-processor finds none
 * (or the wrong ones) and Pro banners silently stop animating.
 */

const ENV: RenderEnv = {
  image: () => "",
  now: new Date(DEMO_NOW),
  host: "gitbanners.test",
};

function build(preset: string, query = ""): BuiltBanner {
  return buildBanner(
    demoEntity("user"),
    resolveOptions("user", preset, parseOptions(new URLSearchParams(query))),
    ENV,
  );
}

async function animate(built: BuiltBanner) {
  if (!built.heatmap) throw new Error("this banner has no heatmap");
  const svg = await renderSvg(built.element, {
    width: built.width,
    height: built.height,
  });
  const { cell, radius, gap, colors, cells } = built.heatmap;
  const result = animateHeatmap(svg, {
    cell,
    radius,
    gap,
    colors: [...colors],
    expected: cells,
  });
  return { svg, result, cells };
}

describe("heatmap animation contract", () => {
  test("user/activity at README size: every day cell is matched", async () => {
    const built = build("activity");
    const days = demoEntity("user").calendar.days.length;
    expect(built.heatmap?.cells).toBe(days);
    const { svg, result, cells } = await animate(built);
    expect(result.cells).toBe(cells);
    expect(result.engine).toBe("takumi");
    expect(result.svg).not.toBe(svg);
    expect(result.svg.match(/class="gb-c/g)).toHaveLength(days);
    // Columns and rows come out as week and weekday indices.
    expect(result.svg).toContain('style="--c:0;--r:0"');
    expect(result.svg).toContain('style="--c:52;--r:5"');
    expect(result.svg).not.toContain("--r:7");
  });

  test("every size of the default banner", async () => {
    for (const size of SIZE_IDS) {
      const { result, cells } = await animate(
        build("overview", `size=${size}`),
      );
      expect({ size, cells: result.cells, engine: result.engine }).toEqual({
        size,
        cells,
        engine: "takumi",
      });
    }
  });

  test("every theme that does not stroke its cells", async () => {
    for (const theme of THEMES) {
      if (THEME_EXTRAS[theme.id].heatBorder) continue;
      const { result, cells } = await animate(
        build("activity", `theme=${theme.id}`),
      );
      expect({ theme: theme.id, cells: result.cells }).toEqual({
        theme: theme.id,
        cells,
      });
    }
  });

  test("custom heat colours, including ones the SVG writer shortens", async () => {
    for (const heat of [
      "ff0000",
      "ffffff,aabbcc,112233,123456,000000",
      "0969da",
    ]) {
      const { result, cells } = await animate(
        build("activity", `heat=${heat}`),
      );
      expect({ heat, cells: result.cells }).toEqual({ heat, cells });
    }
  });

  test("a wrapped calendar animates too", async () => {
    const built = build("activity", "size=square");
    const { result, cells } = await animate(built);
    expect(result.cells).toBe(cells);
    // The second band continues below the first: its rows carry on from 7.
    expect(result.svg).toMatch(/--r:(?:[89]|1\d)"/);
  });

  test("themes that stroke their cells are left alone", async () => {
    for (const theme of THEMES) {
      if (!THEME_EXTRAS[theme.id].heatBorder) continue;
      const built = build("activity", `theme=${theme.id}`);
      expect(built.heatmap?.cells).toBeGreaterThan(0);
      const { svg, result } = await animate(built);
      expect({
        theme: theme.id,
        cells: result.cells,
        engine: result.engine,
      }).toEqual({
        theme: theme.id,
        cells: 0,
        engine: "none",
      });
      expect(result.svg).toBe(svg);
    }
  });

  test("legend swatches never have the shape of a cell", async () => {
    // Otherwise five extra "cells" would be counted and nothing would animate.
    for (const query of ["", "size=x", "size=og", "width=495", "width=700"]) {
      const built = build("activity", query);
      const svg = await renderSvg(built.element, {
        width: built.width,
        height: built.height,
      });
      if (!built.heatmap) throw new Error("no heatmap");
      const { cell, radius, gap, colors, cells } = built.heatmap;
      const found = animateHeatmap(svg, {
        cell,
        radius,
        gap,
        colors: [...colors],
      });
      // Below 8 px the matcher finds nothing (see `cellRadius`); never too many.
      expect([0, cells]).toContain(found.cells);
    }
  });

  test("cellRadius keeps the renderer's path in the form the matcher expects", () => {
    expect(cellRadius(10)).toBe(2.25);
    expect(cellRadius(11)).toBe(2.25);
    expect(cellRadius(12)).toBe(2.25);
    expect(cellRadius(17)).toBe(3);
    expect(cellRadius(20)).toBe(4);
    expect(cellRadius(6)).toBe(1);
    // The control point of the corner curve, radius * (1 - 0.5523), must not
    // drop below 1: the SVG writer then omits a separator the matcher needs.
    for (let cell = 8; cell <= 60; cell++) {
      expect(cellRadius(cell) * (1 - 0.5522847498)).toBeGreaterThanOrEqual(1);
    }
  });
});
