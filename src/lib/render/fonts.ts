import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fontCoverage, withEmptyNotdef } from "./sfnt";

export type BannerFont = {
  name: string;
  data: ArrayBuffer | Uint8Array;
  weight: 400 | 500 | 600 | 700;
  style: "normal";
};

// Static TTFs vendored from github/mona-sans v2.0.27 (SIL OFL 1.1) → /assets/fonts
const FILES = [
  ["Mona Sans", 400, "MonaSans-Regular.ttf"],
  ["Mona Sans", 500, "MonaSans-Medium.ttf"],
  ["Mona Sans", 600, "MonaSans-SemiBold.ttf"],
  ["Mona Sans", 700, "MonaSans-Bold.ttf"],
  ["Mona Sans Mono", 400, "MonaSansMono-Regular.ttf"],
  ["Mona Sans Mono", 500, "MonaSansMono-Medium.ttf"],
] as const;

let fontsPromise: Promise<BannerFont[]> | undefined;

/**
 * Read once per server instance; concurrent callers share the same promise.
 *
 * Mona Sans draws the GitHub Invertocat as its `.notdef` glyph, the glyph a
 * renderer falls back to for a character no font covers. The fonts are
 * registered with that glyph emptied (in memory only, the files are not
 * changed), so a gap in coverage can never look like GitHub branding.
 */
export function loadBaseFonts(): Promise<BannerFont[]> {
  fontsPromise ??= Promise.all(
    FILES.map(async ([name, weight, file]) => ({
      name,
      weight,
      style: "normal" as const,
      data: withEmptyNotdef(
        await readFile(join(process.cwd(), "assets/fonts", file)),
      ),
    })),
  ).catch((err) => {
    fontsPromise = undefined; // do not cache a failed load
    throw err;
  });
  return fontsPromise;
}

/**
 * Private Use Area code points. Their glyphs are whatever a font maker put
 * there (Mona Sans maps U+F8FF to the Invertocat), so they are never treated
 * as covered.
 */
const PRIVATE_USE = /\p{Co}/u;

let coveragePromise: Promise<ReadonlySet<number>> | undefined;

/**
 * Code points every base font draws with a real glyph: the intersection of the
 * Mona Sans and Mona Sans Mono character maps, without private-use code
 * points. A banner can be set in either family, so a character only one of
 * them has still gets a fallback font.
 */
export function baseCoverage(): Promise<ReadonlySet<number>> {
  coveragePromise ??= loadBaseFonts()
    .then((fonts) => {
      let common: Set<number> | undefined;
      for (const font of fonts) {
        const covered = fontCoverage(
          font.data instanceof ArrayBuffer
            ? font.data
            : new Uint8Array(font.data),
        );
        common = common
          ? new Set([...common].filter((cp) => covered.has(cp)))
          : covered;
      }
      for (const cp of common ?? []) {
        if (PRIVATE_USE.test(String.fromCodePoint(cp))) common?.delete(cp);
      }
      return common ?? new Set<number>();
    })
    .catch((err) => {
      coveragePromise = undefined;
      throw err;
    });
  return coveragePromise;
}
