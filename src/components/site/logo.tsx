import { site } from "@/lib/site";

/** Column fills, left to right: GitHub's dark contribution ramp. */
const RAMP = ["#196c2e", "#2ea043", "#56d364"] as const;
/** [column, row] of every lit cell. The missing one cuts the banner's notch. */
const CELLS = [
  [0, 0],
  [1, 0],
  [2, 0],
  [0, 1],
  [1, 1],
  [0, 2],
  [1, 2],
  [2, 2],
] as const;

/**
 * The GitBanners mark: contribution cells arranged as a swallow-tailed
 * banner. The same drawing is the favicon (`src/app/icon.svg`); keep the two
 * in step. Its colours are GitHub's dark canvas and ramp on purpose: the mark
 * is a tiny banner, so it does not follow the page theme.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="8" fill="#0d1117" />
      {CELLS.map(([column, row]) => (
        <rect
          key={`${column}-${row}`}
          x={5 + column * 8}
          y={5 + row * 8}
          width="6"
          height="6"
          rx="1.5"
          fill={RAMP[column]}
        />
      ))}
    </svg>
  );
}

/**
 * Mark and wordmark. Plain inline content: the caller wraps it in the home
 * link and decides the size through `className` on the mark.
 */
export function Logo() {
  return (
    <>
      <LogoMark className="size-6 shrink-0" />
      <span className="gb-wordmark">{site.name}</span>
    </>
  );
}
