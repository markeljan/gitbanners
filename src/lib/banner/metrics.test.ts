import { describe, expect, test } from "bun:test";
import { fitFontSize, textBox, textWidth } from "@/lib/banner/metrics";

/**
 * Widths of real strings at 1000 px, read from the renderer on 2026-11-13.
 * The estimator must stay close to them, and err on the wide side.
 */
const MEASURED: [text: string, regular: number, semibold: number][] = [
  ["Linus Torvalds", 6628, 6816],
  ["@torvalds · Portland, OR", 11304, 11559],
  ["4,015 contributions in the last year", 15770, 16250],
  ["Contributions", 6345, 6528],
  ["Pull requests", 5965, 6161],
  ["Contributed to", 6758, 6948],
  ["267.8k", 2993, 3093],
  ["gitbanners.vercel.app/torvalds", 14000, 14517],
  ["TypeScript", 4989, 5173],
  ["Open pull requests", 8709, 8941],
  ["vercel/next.js", 6106, 6381],
  ["The React Framework for the Web", 15869, 16252],
  ["Repositories", 5802, 5970],
  ["Followers", 4367, 4509],
  ["acme-labs/rocket", 8268, 8513],
];

describe("textWidth", () => {
  test("stays within a few percent of the renderer", () => {
    for (const [text, regular, semibold] of MEASURED) {
      for (const [weight, real] of [
        [400, regular],
        [600, semibold],
      ] as const) {
        const estimate = textWidth(text, { size: 1000, weight });
        const error = (estimate - real) / real;
        expect({ text, weight, ok: error > -0.01 && error < 0.035 }).toEqual({
          text,
          weight,
          ok: true,
        });
      }
    }
  });

  test("a box sized with textBox always holds the real text", () => {
    for (const [text, regular, semibold] of MEASURED) {
      for (const size of [11, 12, 14, 22, 24, 44]) {
        expect(textBox(text, { size, weight: 400 })).toBeGreaterThanOrEqual(
          Math.ceil((regular * size) / 1000),
        );
        expect(textBox(text, { size, weight: 600 })).toBeGreaterThanOrEqual(
          Math.ceil((semibold * size) / 1000),
        );
      }
    }
  });

  test("scales with the size and grows with the weight", () => {
    const at = (size: number, weight: 400 | 500 | 600 | 700) =>
      textWidth("Mona Demo", { size, weight });
    expect(at(24, 400)).toBeCloseTo(at(12, 400) * 2, 6);
    expect(at(12, 500)).toBeGreaterThan(at(12, 400));
    expect(at(12, 600)).toBeGreaterThan(at(12, 500));
    expect(at(12, 700)).toBeGreaterThan(at(12, 600));
  });

  test("knows the scripts the tables do not list", () => {
    const size = 100;
    expect(textWidth("", { size })).toBe(0);
    expect(textWidth("山田太郎", { size })).toBe(400);
    expect(textWidth("한국어", { size })).toBe(300);
    expect(textWidth("🚀", { size })).toBeGreaterThanOrEqual(100);
    // A flag is two code points drawn as one glyph.
    expect(textWidth("🇯🇵", { size })).toBe(textWidth("🚀", { size }));
    // Combining marks, joiners and variation selectors take no room.
    expect(textWidth("é", { size })).toBe(textWidth("é", { size }));
    expect(textWidth(`a${String.fromCodePoint(0x200d)}b`, { size })).toBe(
      textWidth("ab", { size }),
    );
    expect(textWidth("é", { size })).toBe(textWidth("e", { size }));
    expect(textWidth("Привет", { size })).toBeGreaterThan(300);
    expect(textWidth("\n\t", { size })).toBe(0);
  });

  test("the mono cut is one advance per glyph", () => {
    const one = textWidth("i", { size: 100, mono: true });
    expect(one).toBeCloseTo(61.8, 6);
    expect(textWidth("Wide & narrow", { size: 100, mono: true })).toBeCloseTo(
      one * 13,
      6,
    );
    expect(textWidth("i", { size: 100, mono: true, weight: 500 })).toBe(one);
  });
});

describe("textBox", () => {
  test("is whole pixels, with a margin, and empty for no text", () => {
    expect(textBox("", { size: 12 })).toBe(0);
    const width = textBox("Stars", { size: 12 });
    expect(Number.isInteger(width)).toBe(true);
    expect(width).toBeGreaterThan(textWidth("Stars", { size: 12 }) + 2);
  });
});

describe("fitFontSize", () => {
  test("keeps the largest size that fits", () => {
    expect(fitFontSize("Mona Demo", 1000, 44, 30)).toBe(44);
    expect(fitFontSize("", 10, 44, 30)).toBe(44);
    const name = "Wolfeschlegelsteinhausenbergerdorff";
    const size = fitFontSize(name, 400, 44, 20, { weight: 600 });
    expect(size).toBeLessThan(44);
    expect(size).toBeGreaterThanOrEqual(20);
    expect(textBox(name, { size, weight: 600 })).toBeLessThanOrEqual(400);
    expect(textBox(name, { size: size + 1, weight: 600 })).toBeGreaterThan(400);
  });

  test("never goes below the floor", () => {
    expect(fitFontSize("x".repeat(500), 100, 44, 30)).toBe(30);
    expect(fitFontSize("anything", 0, 44, 30)).toBe(30);
  });
});
