/**
 * Renders the GitBanners logo set into `brand/` (and the app icons Next
 * serves): the contribution-grid mark, square icons and wordmark lockups.
 *
 *   bun scripts/brand.tsx
 *
 * Text is drawn as outlines by the banner engine, so the SVGs need no font.
 */
import { mkdir, writeFile } from "node:fs/promises";
import type { CSSProperties } from "react";
import { renderPng, renderSvg } from "@/lib/render/engine";

const OUT = new URL("../brand/", import.meta.url);
const APP = new URL("../src/app/", import.meta.url);

const GREENS = { low: "#196c2e", mid: "#2ea043", high: "#56d364" } as const;
const GREENS_LIGHT = {
  low: "#9be9a8",
  mid: "#40c463",
  high: "#216e39",
} as const;
// The 3×3 grid with one cell left out: a contribution graph read as a "G".
const CELLS: (keyof typeof GREENS | null)[] = [
  "low",
  "mid",
  "high",
  "low",
  "mid",
  null,
  "low",
  "mid",
  "high",
];

function Grid({
  size,
  palette = GREENS,
}: {
  size: number;
  palette?: Record<keyof typeof GREENS, string>;
}) {
  const unit = size / 22; // 3 cells of 6 + 2 gaps of 2
  const cell = 6 * unit;
  const gap = 2 * unit;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        width: size,
        height: size,
        gap,
      }}
    >
      {CELLS.map((tone, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed grid
          key={i}
          style={{
            width: cell,
            height: cell,
            borderRadius: 1.5 * unit,
            backgroundColor: tone ? palette[tone] : "transparent",
          }}
        />
      ))}
    </div>
  );
}

/** The app icon: the grid on GitHub's dark canvas, rounded square. */
function Mark({ size, rounded = true }: { size: number; rounded?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        backgroundColor: "#0d1117",
        borderRadius: rounded ? size / 4 : 0,
      }}
    >
      <Grid size={(size * 22) / 32} />
    </div>
  );
}

function Lockup({ mode, height }: { mode: "dark" | "light"; height: number }) {
  const dark = mode === "dark";
  const text: CSSProperties = {
    fontFamily: "Mona Sans",
    fontWeight: 700,
    fontSize: height * 0.56,
    letterSpacing: -0.02 * height * 0.56,
    lineHeight: 1,
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: height * 0.3,
        height,
        padding: `0 ${height * 0.25}px`,
        backgroundColor: dark ? "#0d1117" : "#ffffff",
      }}
    >
      <Grid size={height * 0.62} palette={dark ? GREENS : GREENS_LIGHT} />
      <div style={{ display: "flex", ...text }}>
        <span style={{ color: dark ? "#f0f6fc" : "#1f2328" }}>Git</span>
        <span style={{ color: dark ? "#56d364" : "#1a7f37" }}>Banners</span>
      </div>
    </div>
  );
}

const LOCKUP_H = 160;
const LOCKUP_W = 700;

async function main() {
  await mkdir(OUT, { recursive: true });
  const jobs: [string, Promise<string | Uint8Array>][] = [];
  const svg = (name: string, el: React.ReactElement, w: number, h: number) =>
    jobs.push([name, renderSvg(el, { width: w, height: h })]);
  const png = (
    name: string,
    el: React.ReactElement,
    w: number,
    h: number,
    scale: 1 | 2 = 1,
  ) => jobs.push([name, renderPng(el, { width: w, height: h, scale })]);

  svg("gitbanners-mark.svg", <Mark size={512} />, 512, 512);
  svg("gitbanners-mark-transparent.svg", <Grid size={512} />, 512, 512);
  for (const size of [1024, 512, 256])
    png(`gitbanners-mark-${size}.png`, <Mark size={size} />, size, size);
  png(
    "gitbanners-mark-square-1024.png",
    <Mark size={1024} rounded={false} />,
    1024,
    1024,
  );
  for (const mode of ["dark", "light"] as const) {
    const el = <Lockup mode={mode} height={LOCKUP_H} />;
    svg(`gitbanners-logo-${mode}.svg`, el, LOCKUP_W, LOCKUP_H);
    png(`gitbanners-logo-${mode}.png`, el, LOCKUP_W, LOCKUP_H, 2);
  }
  // Served by Next at /apple-icon.png (iOS home screen; no rounding, iOS masks it).
  jobs.push([
    "@app/apple-icon.png",
    renderPng(<Mark size={180} rounded={false} />, { width: 180, height: 180 }),
  ]);

  for (const [name, body] of jobs) {
    const target = name.startsWith("@app/")
      ? new URL(name.slice(5), APP)
      : new URL(name, OUT);
    const data = await body;
    await writeFile(
      target,
      typeof data === "string" ? data : Buffer.from(data),
    );
    console.log("wrote", target.pathname.replace(process.cwd(), "."));
  }
}

await main();
