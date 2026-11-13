/** Small formatters for copy that quotes numbers from the code. */

const UNITS = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
] as const;

/**
 * A whole number of the largest unit that divides the duration: 900 is
 * "15 minutes", 86400 "1 day", 90 "90 seconds".
 */
export function duration(seconds: number): string {
  for (const [unit, size] of UNITS) {
    if (seconds >= size && seconds % size === 0) {
      const count = seconds / size;
      return `${count} ${unit}${count === 1 ? "" : "s"}`;
    }
  }
  return `${seconds} seconds`;
}

/** "13 November 2026" for an ISO date, independent of the server's locale and zone. */
export function longDate(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
