import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fontCoverage, withEmptyNotdef } from "./sfnt";

const MONA = readFileSync(
  join(process.cwd(), "assets/fonts/MonaSans-Regular.ttf"),
);

/** Byte length of glyph 0, read from `head.indexToLocFormat` and `loca`. */
function notdefLength(data: Uint8Array): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tables = new Map<string, number>();
  for (let i = 0; i < view.getUint16(4); i++) {
    const record = 12 + i * 16;
    const tag = String.fromCharCode(...data.subarray(record, record + 4));
    tables.set(tag, view.getUint32(record + 8));
  }
  const head = tables.get("head") ?? 0;
  const loca = tables.get("loca") ?? 0;
  return view.getInt16(head + 50) === 0
    ? (view.getUint16(loca + 2) - view.getUint16(loca)) * 2
    : view.getUint32(loca + 4) - view.getUint32(loca);
}

describe("fontCoverage", () => {
  test("reads the code points Mona Sans maps to real glyphs", () => {
    const covered = fontCoverage(MONA);
    for (const char of "AZaz09 é€™ỹ") {
      expect(covered.has(char.codePointAt(0) ?? 0)).toBe(true);
    }
    // The characters that used to come out as the Invertocat.
    for (const char of ["❤", "♥", "✔", "⛓", "🖥", "你", "ا"]) {
      expect(covered.has(char.codePointAt(0) ?? 0)).toBe(false);
    }
  });

  test("an empty set for data that is not a font", () => {
    expect(fontCoverage(new Uint8Array(8)).size).toBe(0);
    expect(fontCoverage(new ArrayBuffer(0)).size).toBe(0);
  });
});

describe("withEmptyNotdef", () => {
  test("empties glyph 0 (the Invertocat) and nothing else", () => {
    expect(notdefLength(MONA)).toBeGreaterThan(0);
    const patched = withEmptyNotdef(MONA);
    expect(notdefLength(patched)).toBe(0);
    expect(patched.byteLength).toBe(MONA.byteLength);
    expect(fontCoverage(patched)).toEqual(fontCoverage(MONA));
  });

  test("leaves the input untouched", () => {
    const before = notdefLength(MONA);
    withEmptyNotdef(MONA);
    expect(notdefLength(MONA)).toBe(before);
  });
});
