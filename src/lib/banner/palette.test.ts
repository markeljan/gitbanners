import { describe, expect, test } from "bun:test";
import { contrast, deltaE } from "@/lib/banner/color";
import { resolvePalette, shortHex } from "@/lib/banner/palette";
import { getTheme, THEME_EXTRAS, THEMES } from "@/lib/banner/themes";
import type { BannerOptions } from "@/lib/banner/types";

const HEX6 = /^#[0-9a-f]{6}$/;

function palette(theme: string, colors: BannerOptions["colors"] = {}) {
  return resolvePalette({ theme, colors });
}

describe("resolvePalette", () => {
  test("every theme resolves to itself", () => {
    for (const theme of THEMES) {
      const resolved = palette(theme.id);
      expect(resolved.theme).toEqual({ ...theme, colors: resolved.colors });
      expect(resolved.colors).toEqual(theme.colors);
      expect(resolved.heatBorder).toBe(
        THEME_EXTRAS[theme.id].heatBorder ?? null,
      );
      for (const color of [
        ...Object.values(theme.colors).flat(),
        resolved.success,
        resolved.warning,
        resolved.danger,
        resolved.done,
        resolved.link,
      ]) {
        expect(color).toMatch(HEX6);
      }
    }
  });

  test("an unknown theme is the default theme", () => {
    expect(palette("nope").theme.id).toBe("github-dark");
    expect(palette("").colors).toEqual(getTheme("github-dark").colors);
    expect(
      resolvePalette({ theme: undefined as never, colors: undefined as never })
        .theme.id,
    ).toBe("github-dark");
  });

  test("valid overrides win, invalid ones are ignored", () => {
    const resolved = palette("github-dark", {
      bg: "#101010",
      text: "FFF" as string,
      muted: "rgb(1,2,3)",
      accent: "#12345",
      border: "#ABCDEF",
    });
    expect(resolved.colors.bg).toBe("#101010");
    expect(resolved.colors.text).toBe("#ffffff");
    expect(resolved.colors.border).toBe("#abcdef");
    expect(resolved.colors.muted).toBe(getTheme("github-dark").colors.muted);
    expect(resolved.colors.accent).toBe(getTheme("github-dark").colors.accent);
    expect(resolved.theme.colors).toBe(resolved.colors);
  });

  test("the mode follows a recoloured canvas", () => {
    expect(palette("github-dark").theme.mode).toBe("dark");
    expect(palette("github-dark", { bg: "#ffffff" }).theme.mode).toBe("light");
    expect(palette("github-light", { bg: "#000000" }).theme.mode).toBe("dark");
    expect(palette("github-light", { text: "#000000" }).theme.mode).toBe(
      "light",
    );
  });

  test("one heat colour becomes a ramp that suits the canvas", () => {
    const one = "#ff7b72";
    const dark = palette("github-dark", { heat: [one, one, one, one, one] });
    expect(dark.colors.heat[0]).toBe(getTheme("github-dark").colors.heat[0]);
    expect(dark.colors.heat[4]).toBe(one);
    expect(new Set(dark.colors.heat).size).toBe(5);
    for (const color of dark.colors.heat) expect(color).toMatch(HEX6);
    // Each step is visibly different from the one before.
    for (let level = 1; level < 5; level++) {
      expect(
        deltaE(dark.colors.heat[level - 1], dark.colors.heat[level]),
      ).toBeGreaterThan(0.04);
    }
    const light = palette("github-light", { heat: [one, one, one, one, one] });
    expect(light.colors.heat[3]).toBe(one);
    expect(light.colors.heat[0]).toBe(getTheme("github-light").colors.heat[0]);
    // On a light canvas the ramp gets darker, on a dark one lighter.
    expect(contrast(light.colors.heat[4], "#ffffff")).toBeGreaterThan(
      contrast(light.colors.heat[1], "#ffffff"),
    );
  });

  test("the empty cell never vanishes into a custom canvas", () => {
    const one = "#22c55e";
    const flat = palette("github-dark", {
      bg: "#000000",
      surface: "#000000",
      heat: [one, one, one, one, one],
    });
    expect(flat.colors.heat[0]).not.toBe("#000000");
    const raised = palette("github-dark", {
      bg: "#000000",
      surface: "#222222",
      heat: [one, one, one, one, one],
    });
    expect(raised.colors.heat[0]).toBe("#222222");
  });

  test("five heat colours are used as given; a broken list is ignored", () => {
    const five = [
      "#111111",
      "#222222",
      "#333333",
      "#444444",
      "#555555",
    ] as const;
    expect(palette("dracula", { heat: [...five] }).colors.heat).toEqual([
      ...five,
    ]);
    const base = getTheme("dracula").colors.heat;
    expect(
      palette("dracula", {
        heat: ["#111", "nope", "#333", "#444", "#555"] as never,
      }).colors.heat,
    ).toEqual(base);
    expect(
      palette("dracula", { heat: ["#111", "#222"] as never }).colors.heat,
    ).toEqual(base);
    expect(
      palette("dracula", { heat: "#111111" as never }).colors.heat,
    ).toEqual(base);
  });

  test("a custom accent also colours links", () => {
    expect(palette("dracula").link).toBe(THEME_EXTRAS.dracula.link);
    expect(palette("dracula", { accent: "#ff0000" }).link).toBe("#ff0000");
  });
});

describe("shortHex", () => {
  test("is how the SVG writer prints a fill", () => {
    expect(shortHex("#ffffff")).toBe("#fff");
    expect(shortHex("#AABBCC")).toBe("#abc");
    expect(shortHex("#000000")).toBe("#000");
    expect(shortHex("#151b23")).toBe("#151b23");
    expect(shortHex("#aabbcd")).toBe("#aabbcd");
    expect(shortHex("#abc")).toBe("#abc");
  });
});
