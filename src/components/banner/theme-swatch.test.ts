import { describe, expect, test } from "bun:test";
import { getTheme, THEMES } from "@/lib/banner";
import { filterThemes, swatchVariables } from "./theme-swatch";

describe("filterThemes", () => {
  test("an empty search keeps every theme in order", () => {
    expect(filterThemes(THEMES, "")).toEqual([...THEMES]);
    expect(filterThemes(THEMES, "   ")).toHaveLength(THEMES.length);
  });
  test("matches the name or the id, without case", () => {
    expect(filterThemes(THEMES, "DRACULA").map((theme) => theme.id)).toEqual([
      "dracula",
    ]);
    expect(
      filterThemes(THEMES, "tokyo-night").map((theme) => theme.id),
    ).toEqual(["tokyo-night"]);
  });
  test("every word has to match", () => {
    const ids = filterThemes(THEMES, "github light").map((theme) => theme.id);
    expect(ids).toContain("github-light");
    expect(ids).toContain("github-light-high-contrast");
    expect(ids).not.toContain("github-dark");
    expect(ids).not.toContain("solarized-light");
  });
  test("no match is an empty list", () => {
    expect(filterThemes(THEMES, "no such theme")).toEqual([]);
  });
});

describe("swatchVariables", () => {
  test("carries the theme's real colours", () => {
    const theme = getTheme("github-dark");
    const variables = swatchVariables(theme);
    expect(variables["--gb-sw-bg"]).toBe("#0d1117");
    expect(variables["--gb-sw-text"]).toBe("#f0f6fc");
    expect(variables["--gb-sw-border"]).toBe("#3d444d");
    expect(variables["--gb-sw-accent"]).toBe("#4493f8");
  });
  test("draws the ramp as five equal bands, least to most", () => {
    const heat = swatchVariables(getTheme("github-dark"))["--gb-sw-heat"];
    expect(heat).toBe(
      "linear-gradient(90deg, #151b23 0% 20%, #033a16 20% 40%, #196c2e 40% 60%, #2ea043 60% 80%, #56d364 80% 100%)",
    );
  });
});
