import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractEmojis } from "@takumi-rs/helpers/emoji";
import type { ReactElement } from "react";
import {
  type BannerFont,
  drawableText,
  drawnAsEmoji,
  fontsForText,
  prepareText,
  renderSvg,
} from "@/lib/render";

/**
 * Mona Sans draws the GitHub Invertocat as its `.notdef` glyph. Text-style
 * pictographs (❤ ♥ ✔ ⛓ 🖥 without U+FE0F) and characters no font covers used
 * to come out as that logo inside users' names and bios.
 */

const WIDTH = 1600;
const HEIGHT = 80;

/** Text-default pictographs: Takumi draws them as text, not as Twemoji. */
const PICTOGRAPHS = ["❤", "♥", "✔", "⛓", "🖥"];
const CJK_ARABIC = "你好世界 こんにちは 안녕하세요 مرحبا بالعالم";

function line(text: string, family = "Mona Sans"): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        width: WIDTH,
        height: HEIGHT,
        background: "#ffffff",
        color: "#000000",
        fontFamily: family,
        fontSize: 40,
      }}
    >
      {text}
    </div>
  );
}

function svgOf(element: ReactElement, fonts?: BannerFont[]): Promise<string> {
  return renderSvg(element, { width: WIDTH, height: HEIGHT, fonts });
}

/** The outline of every distinct glyph the SVG draws. */
function glyphs(svg: string): string[] {
  return [...svg.matchAll(/<path id="g\d+" d="([^"]+)"/g)].map(
    (match) => match[1] ?? "",
  );
}

/** Text of an element's direct string children. */
function textOf(element: ReactElement): string {
  return String((element.props as { children?: unknown }).children ?? "");
}

/**
 * The Invertocat outline at this font size, drawn from an unpatched copy of
 * Mona Sans registered for one render under another name.
 */
let invertocat = "";
beforeAll(async () => {
  const raw: BannerFont = {
    name: "Unpatched Mona",
    data: readFileSync(
      join(process.cwd(), "assets/fonts/MonaSans-Regular.ttf"),
    ),
    weight: 400,
    style: "normal",
  };
  const drawn = glyphs(await svgOf(line("\u{16E6D}", "Unpatched Mona"), [raw]));
  expect(drawn).toHaveLength(1);
  invertocat = drawn[0] ?? "";
  expect(invertocat.length).toBeGreaterThan(100);
});

function expectNoInvertocat(svg: string): void {
  expect(invertocat).not.toBe("");
  expect(glyphs(svg)).not.toContain(invertocat);
}

describe("drawnAsEmoji", () => {
  test("only emoji-presentation sequences become Twemoji images", () => {
    for (const char of PICTOGRAPHS) expect(drawnAsEmoji(char)).toBe(false);
    expect(drawnAsEmoji("❤︎")).toBe(false);
    for (const emoji of ["❤️", "🖥️", "😀", "👍🏽", "👩‍💻", "🇺🇸", "#️⃣"]) {
      expect(drawnAsEmoji(emoji)).toBe(true);
    }
    expect(drawnAsEmoji("A")).toBe(false);
  });

  test("agrees with Takumi's own emoji extraction", () => {
    const samples = [
      ...PICTOGRAPHS,
      "❤️",
      "❤︎",
      "🖥️",
      "😀",
      "👍🏽",
      "👩‍💻",
      "🇺🇸",
      "🇺",
      "#️⃣",
      "#⃣",
      "☺",
      "✓",
      "★",
      "A",
      "你",
    ];
    for (const sample of samples) {
      const node = extractEmojis({ type: "text", text: sample }, "twemoji");
      const takumi = node.type !== "text";
      expect({ sample, emoji: drawnAsEmoji(sample) }).toEqual({
        sample,
        emoji: takumi,
      });
    }
  });
});

describe("drawableText", () => {
  test("drops only the missing characters and keeps emoji whole", () => {
    const missing = new Set([0x2764, 0x16e6d]);
    expect(drawableText("I❤U ❤️ q\u{16E6D}r", missing)).toBe("IU ❤️ qr");
    expect(drawableText("I❤U", new Set())).toBe("I❤U");
  });
});

describe("fontsForText without Google Fonts", () => {
  const original = globalThis.fetch;
  let asked: { family: string; text: string }[] = [];

  function offline(): void {
    asked = [];
    globalThis.fetch = Object.assign(
      (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : input);
        if (url.hostname === "fonts.googleapis.com") {
          asked.push({
            family: (url.searchParams.get("family") ?? "").split(":")[0] ?? "",
            text: url.searchParams.get("text") ?? "",
          });
        }
        return Promise.reject(new TypeError("fetch failed"));
      },
      { preconnect: original.preconnect },
    );
  }

  afterEach(() => {
    globalThis.fetch = original;
  });

  test("plain Latin and emoji never touch the network", async () => {
    offline();
    const result = await fontsForText("Linus Torvalds ❤️ 😀 👍🏽 🇺🇸 #️⃣ café ☺ ✓");
    expect(asked).toEqual([]);
    expect(result.fonts).toEqual([]);
    expect(result.missing.size).toBe(0);
  });

  test("text-style pictographs are asked of a symbols font", async () => {
    offline();
    await fontsForText(`x${PICTOGRAPHS.join("")}y`);
    const symbols = asked.find(
      ({ family }) => family === "Noto Sans Symbols 2",
    );
    expect([...(symbols?.text ?? "")].sort()).toEqual([...PICTOGRAPHS].sort());
  });

  test("CJK and Arabic are asked of their script fonts", async () => {
    offline();
    await fontsForText(`${CJK_ARABIC}!`);
    const families = new Set(asked.map(({ family }) => family));
    for (const family of [
      "Noto Sans SC",
      "Noto Sans JP",
      "Noto Sans KR",
      "Noto Sans Arabic",
    ]) {
      expect(families.has(family)).toBe(true);
    }
  });

  test("characters no font arrives for are reported missing", async () => {
    offline();
    const { fonts, missing } = await fontsForText(`I${PICTOGRAPHS.join("")}`);
    expect(fonts).toEqual([]);
    for (const char of PICTOGRAPHS) {
      expect(missing.has(char.codePointAt(0) ?? 0)).toBe(true);
    }
    expect(missing.has("I".codePointAt(0) ?? 0)).toBe(false);
  });

  test("controls and private-use characters are missing without a fetch", async () => {
    offline();
    const { missing } = await fontsForText("a\u0007bc\u{F0000}");
    expect(asked).toEqual([]);
    expect([...missing].sort((a, b) => a - b)).toEqual([0x7, 0xf8ff, 0xf0000]);
  });

  test("a render without fallback fonts drops them instead of drawing the Invertocat", async () => {
    offline();
    const text = `I❤U A♥B C✔D ⛓ 🖥 ${CJK_ARABIC} q\u{16E6D}r .`;
    const { element, fonts } = await prepareText(line(text));
    expect(fonts).toEqual([]);
    expect(textOf(element)).toBe(text.replace(/[^\x20-\x7e]/gu, ""));
    expectNoInvertocat(await svgOf(element, fonts));
  });
});

describe("the base fonts", () => {
  test("draw nothing, not the Invertocat, for a character they lack", async () => {
    // Straight to the renderer, skipping prepareText.
    for (const text of [
      `I${PICTOGRAPHS.join("")}U`,
      CJK_ARABIC,
      "q\u{16E6D}r",
      "",
    ]) {
      expectNoInvertocat(await svgOf(line(text)));
    }
    expectNoInvertocat(await svgOf(line("I❤U", "Mona Sans Mono")));
  });
});

const online = await fetch(
  "https://fonts.googleapis.com/css2?family=Noto%20Sans&text=A",
  { signal: AbortSignal.timeout(4000) },
).then(
  (res) => res.ok,
  () => false,
);
if (!online)
  console.warn("fonts.googleapis.com unreachable: live font tests skipped");

describe.skipIf(!online)("rendering with Google Fonts", () => {
  test.each(PICTOGRAPHS)(
    "%s is drawn from Noto Sans Symbols 2",
    async (char) => {
      const { element, fonts } = await prepareText(line(`I${char}U`));
      expect(textOf(element)).toBe(`I${char}U`);
      expect(fonts.map((font) => font.name)).toContain(
        "fallback Noto Sans Symbols 2",
      );
      const svg = await svgOf(element, fonts);
      expectNoInvertocat(svg);
      // I, U and the pictograph itself.
      expect(glyphs(svg)).toHaveLength(3);
    },
  );

  test("❤ ♥ ✔ ⛓ 🖥 together in one line", async () => {
    const text = "I❤U A♥B C✔D x⛓y z🖥w";
    const { element, fonts } = await prepareText(line(text));
    expect(textOf(element)).toBe(text);
    const svg = await svgOf(element, fonts);
    expectNoInvertocat(svg);
    expect(glyphs(svg)).toHaveLength(new Set(text.replaceAll(" ", "")).size);
  });

  test("CJK and Arabic are drawn from their script fonts", async () => {
    const { element, fonts } = await prepareText(line(CJK_ARABIC));
    expect(textOf(element)).toBe(CJK_ARABIC);
    const names = new Set(fonts.map((font) => font.name));
    for (const family of [
      "Noto Sans SC",
      "Noto Sans JP",
      "Noto Sans KR",
      "Noto Sans Arabic",
    ]) {
      expect(names.has(`fallback ${family}`)).toBe(true);
    }
    const svg = await svgOf(element, fonts);
    expectNoInvertocat(svg);
    expect(glyphs(svg).length).toBeGreaterThan(15);
  });

  test("a character no Noto family covers is dropped", async () => {
    const { missing } = await fontsForText("q\u{16E6D}r");
    expect(missing.has(0x16e6d)).toBe(true);
    const { element, fonts } = await prepareText(line("q\u{16E6D}r"));
    expect(textOf(element)).toBe("qr");
    expectNoInvertocat(await svgOf(element, fonts));
  });
});
