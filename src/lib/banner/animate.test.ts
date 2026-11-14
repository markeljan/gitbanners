import { describe, expect, test } from "bun:test";
import { buildBanner } from "@/lib/banner/build";
import { DEMO_NOW, demoEntity } from "@/lib/banner/demo";
import { parseOptions, resolveOptions, SIZE_IDS } from "@/lib/banner/options";
import { cellRadius } from "@/lib/banner/sizes";
import { THEME_EXTRAS, THEMES } from "@/lib/banner/themes";
import type { BuiltBanner, RenderEnv } from "@/lib/banner/types";
import type { Entity } from "@/lib/github/schema";
import { animateHeatmap, renderPng, renderSvg } from "@/lib/render";

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
  return buildFor(demoEntity("user"), preset, query);
}

function buildFor(entity: Entity, preset: string, query = ""): BuiltBanner {
  return buildBanner(
    entity,
    resolveOptions(
      entity.kind,
      preset,
      parseOptions(new URLSearchParams(query)),
    ),
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
      // Without `expected` the matcher reports everything of a cell's shape:
      // exactly the days, never the five swatches on top.
      expect({ query, cells: found.cells }).toEqual({ query, cells });
    }
  });

  test("cell radii are whole pixels in GitHub's proportion", () => {
    expect(cellRadius(10)).toBe(2);
    expect(cellRadius(11)).toBe(2);
    expect(cellRadius(12)).toBe(2);
    expect(cellRadius(17)).toBe(3);
    expect(cellRadius(20)).toBe(4);
    expect(cellRadius(6)).toBe(1);
    expect(cellRadius(3)).toBe(1);
    // A 2 px cell with a 1 px radius would be a dot: it is drawn square.
    expect(cellRadius(2)).toBe(0);
    for (let cell = 2; cell <= 400; cell++) {
      expect(Number.isInteger(cellRadius(cell))).toBe(true);
    }
  });

  test("small cells animate too: every cell size a canvas can produce", async () => {
    // 495 px cards wrap the year into bands of 9 px cells, a 320 x 120 canvas
    // has 3 px cells, and the photo zone of a LinkedIn banner leaves 8 px.
    for (const [preset, query] of [
      ["activity", "width=495"],
      ["overview", "width=320&height=120"],
      ["overview", "width=400&height=140"],
      ["repos", "size=linkedin"],
      ["activity", "size=linkedin&height=200"],
      ["overview", "size=x&width=640"],
      ["overview", "width=3000&height=1000"],
    ] as const) {
      const built = build(preset, query);
      const { result, cells } = await animate(built);
      expect({
        preset,
        query,
        cell: built.heatmap?.cell,
        cells: result.cells,
      }).toEqual({ preset, query, cell: built.heatmap?.cell, cells });
      expect(Number.isInteger(built.heatmap?.radius)).toBe(true);
    }
  });

  test("a repository's commit calendar animates like a profile's", async () => {
    for (const kind of ["repo", "org"] as const) {
      for (const size of SIZE_IDS) {
        const built = buildFor(demoEntity(kind), "activity", `size=${size}`);
        const { result, cells } = await animate(built);
        expect({ kind, size, cells: result.cells }).toEqual({
          kind,
          size,
          cells,
        });
        expect(cells).toBe(52 * 7 - 1);
      }
    }
  });

  test("the year in review animates at every size", async () => {
    for (const year of [2026, null]) {
      const user = demoEntity("user", { year });
      for (const size of SIZE_IDS) {
        const built = buildFor(
          user,
          "wrapped",
          `size=${size}${year ? `&year=${year}` : ""}`,
        );
        const { result, cells } = await animate(built);
        expect({ year, size, cells: result.cells }).toEqual({
          year,
          size,
          cells,
        });
        expect(cells).toBe(user.calendar.days.length);
      }
    }
  });

  test("a placeholder calendar and a bar chart report nothing to animate", () => {
    const computing = { ...demoEntity("repo"), activity: null };
    expect(buildFor(computing, "activity").heatmap).toBeNull();
    expect(buildFor(demoEntity("repo"), "release").heatmap).toBeNull();
    expect(buildFor(demoEntity("repo"), "overview").heatmap).toBeNull();
  });

  test("bars and avatar chips never have the shape of a cell", async () => {
    // A bar as wide as a cell, in a heat colour, must not be counted as one.
    for (const [kind, preset, query] of [
      ["repo", "release", ""],
      ["repo", "release", "size=og"],
      ["repo", "contributors", ""],
      ["org", "overview", "size=square"],
    ] as const) {
      const built = buildFor(demoEntity(kind), preset, query);
      const svg = await renderSvg(built.element, {
        width: built.width,
        height: built.height,
      });
      const reference = buildFor(demoEntity("repo"), "activity", query);
      if (!reference.heatmap) throw new Error("no heatmap");
      const { cell, radius, gap, colors } = reference.heatmap;
      const found = animateHeatmap(svg, {
        cell,
        radius,
        gap,
        colors: [...colors],
      });
      expect({ preset, query, cells: found.cells }).toEqual({
        preset,
        query,
        cells: 0,
      });
    }
  });
});

describe("what the renderer makes of the new banners", () => {
  test("the repository social preview is far under GitHub's 1 MB as a 1x PNG", async () => {
    for (const theme of ["github-dark", "github-light", "tokyo-night"]) {
      const built = buildFor(demoEntity("repo"), "social", `theme=${theme}`);
      expect([built.width, built.height]).toEqual([1280, 640]);
      const png = await renderPng(built.element, {
        width: built.width,
        height: built.height,
        scale: 1,
      });
      // PNG signature, then the size GitHub accepts with room for a
      // photographic avatar (at most a 192 px image, some tens of kilobytes).
      expect([...png.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
      expect(png.byteLength).toBeLessThan(200_000);
    }
  });

  test("the star trend is drawn as a stroked line in the SVG", async () => {
    const built = buildFor(demoEntity("repo"), "overview");
    const svg = await renderSvg(built.element, {
      width: built.width,
      height: built.height,
    });
    // toContain on a boolean keeps a failure from printing the whole SVG.
    expect(/stroke="#3fb950"[^>]*stroke-linecap="round"/.test(svg)).toBe(true);
    // The soft area under the line is the same colour at 16%.
    expect(svg.includes('opacity=".16"')).toBe(true);
    const without = buildFor(
      { ...demoEntity("repo"), starHistory: null },
      "overview",
    );
    const plain = await renderSvg(without.element, {
      width: without.width,
      height: without.height,
    });
    expect(plain.includes('stroke="#3fb950"')).toBe(false);
  });

  test("every new preset renders to SVG without external references", async () => {
    const cases: [Entity, string, string][] = [
      [demoEntity("repo"), "overview", ""],
      [demoEntity("repo"), "activity", ""],
      [demoEntity("repo"), "contributors", ""],
      [demoEntity("repo"), "social", ""],
      [demoEntity("repo"), "release", ""],
      [demoEntity("org"), "overview", ""],
      [demoEntity("org"), "repos", ""],
      [demoEntity("org"), "activity", ""],
      [demoEntity("user", { year: 2026 }), "wrapped", "year=2026"],
    ];
    for (const [entity, preset, query] of cases) {
      const built = buildFor(entity, preset, query);
      const svg = await renderSvg(built.element, {
        width: built.width,
        height: built.height,
      });
      // GitHub's image proxy allows data: images only, and no fonts at all.
      expect({
        preset,
        svg: svg.startsWith("<svg"),
        remote: /href="https?:/.test(svg),
        text: svg.includes("<text"),
        fonts: svg.includes("@font-face"),
      }).toEqual({
        preset,
        svg: true,
        remote: false,
        text: false,
        fonts: false,
      });
    }
  });
});
