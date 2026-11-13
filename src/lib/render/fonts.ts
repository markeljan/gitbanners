import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type BannerFont = {
  name: string;
  data: Buffer | ArrayBuffer;
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

/** Read once per server instance; concurrent callers share the same promise. */
export function loadBaseFonts(): Promise<BannerFont[]> {
  fontsPromise ??= Promise.all(
    FILES.map(async ([name, weight, file]) => ({
      name,
      weight,
      style: "normal" as const,
      data: await readFile(join(process.cwd(), "assets/fonts", file)),
    })),
  ).catch((err) => {
    fontsPromise = undefined; // do not cache a failed load
    throw err;
  });
  return fontsPromise;
}
