import { describe, expect, test } from "bun:test";
import { clipText, plainText } from "@/lib/banner/text";

const char = String.fromCodePoint;

describe("plainText", () => {
  test("collapses whitespace and trims", () => {
    expect(plainText("  Mona \n\t Demo  ")).toBe("Mona Demo");
    expect(plainText("")).toBe("");
    expect(plainText(`a${char(0xa0)}b`)).toBe("a b");
  });

  test("turns control characters into spaces", () => {
    expect(
      plainText(
        `a${char(0)}b${char(7)}c${char(0x1b)}[0m${char(0x85)}d${char(0x2028)}e`,
      ),
    ).toBe("a b c [0m d e");
  });

  test("removes bidi overrides but keeps right-to-left text", () => {
    const rlo = char(0x202e);
    const isolate = char(0x2066);
    expect(plainText(`${rlo}evil${isolate} name`)).toBe("evil name");
    expect(plainText("مرحبا بالعالم")).toBe("مرحبا بالعالم");
    expect(plainText("שלום")).toBe("שלום");
  });

  test("drops broken surrogates and keeps real emoji", () => {
    const high = String.fromCharCode(0xd83d);
    const low = String.fromCharCode(0xde80);
    expect(plainText(`a${high}b`)).toBe("ab");
    expect(plainText(`a${low}b`)).toBe("ab");
    expect(plainText(`a${high}${low}b`)).toBe("a🚀b");
    expect(plainText("👩‍💻 🇯🇵")).toBe("👩‍💻 🇯🇵");
    expect(() => encodeURIComponent(plainText(`x${high}`))).not.toThrow();
  });

  test("anything that is not a string is empty", () => {
    for (const value of [null, undefined, 42, {}, [], true]) {
      expect(plainText(value)).toBe("");
    }
  });
});

describe("clipText", () => {
  test("counts characters, not UTF-16 units", () => {
    expect(clipText("abcdef", 3)).toBe("abc");
    expect(clipText("🚀🚀🚀🚀", 2)).toBe("🚀🚀");
    expect(clipText("ab   cd", 3)).toBe("ab");
    expect(clipText("abc", 0)).toBe("");
    expect(clipText("abc", -1)).toBe("");
    expect(clipText(null, 5)).toBe("");
  });
});
