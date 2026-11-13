import { describe, expect, test } from "bun:test";
import { SIZE_IDS } from "@/lib/banner";
import { sizeDimensions, sizeHint, sizeRatio } from "./sizes";

describe("sizeDimensions", () => {
  test("prints fixed canvases and the automatic README height", () => {
    expect(sizeDimensions("x")).toBe("1500 × 500");
    expect(sizeDimensions("linkedin")).toBe("1584 × 396");
    expect(sizeDimensions("readme")).toBe("846 × auto");
  });
});

describe("sizeRatio", () => {
  test("is width over height", () => {
    expect(sizeRatio("x")).toBe(3);
    expect(sizeRatio("social")).toBe(2);
    expect(sizeRatio("square")).toBe(1);
    expect(sizeRatio("linkedin")).toBe(4);
  });
  test("README cards use their usual overview shape", () => {
    expect(sizeRatio("readme")).toBeCloseTo(3.18, 2);
  });
});

describe("sizeHint", () => {
  test("every size has one sentence or two, without em dashes", () => {
    for (const id of SIZE_IDS) {
      const hint = sizeHint(id);
      expect(hint.length).toBeGreaterThan(40);
      expect(hint).not.toContain("—");
      expect(hint.endsWith(".")).toBe(true);
    }
  });
  test("upload destinations say so, with their limits", () => {
    expect(sizeHint("x")).toContain("uploads");
    expect(sizeHint("x")).toContain("profile photo");
    expect(sizeHint("linkedin")).toContain("under 8 MB");
    expect(sizeHint("social")).toContain("Social preview");
    expect(sizeHint("social")).toContain("under 1 MB");
  });
  test("live destinations say that the image updates itself", () => {
    expect(sizeHint("readme")).toContain("updates itself");
    expect(sizeHint("og")).toContain("og:image");
  });
});
