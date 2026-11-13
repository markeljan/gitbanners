/**
 * Per-process memory of names that did NOT resolve to what a fetcher was
 * hoping for: logins that are organizations, logins and repositories that
 * do not exist.
 *
 * Fetchers fire their follow-up requests together with the core request to
 * save a round trip. For such a name those requests are wasted rate-limit
 * points, and the same names come back for a long time: the banner of a
 * deleted or renamed account stays embedded in READMEs, and "not found" is
 * only cached for minutes. Remembering the name makes every later check
 * cost the core request alone.
 *
 * It is a hint, never the truth: the core request still decides, the memory
 * is corrected after each of them, and forgetting only costs points.
 */

/** A bounded set of names, compared case-insensitively. */
export interface NameMemory {
  has(name: string): boolean;
  /** Records whether `name` currently belongs to the set. */
  note(name: string, member: boolean): void;
}

/** Default bound: a few hundred kilobytes of names at most. */
const DEFAULT_MAX_NAMES = 2_000;

/**
 * Creates an empty memory. When `maxNames` is reached it starts over: with
 * names that arrive in no useful order (a crawler probing random ones)
 * there is nothing worth keeping selectively.
 */
export function createNameMemory(maxNames = DEFAULT_MAX_NAMES): NameMemory {
  const names = new Set<string>();
  return {
    has: (name) => names.has(name.toLowerCase()),
    note(name, member) {
      const key = name.toLowerCase();
      if (!member) {
        // A name can change hands: never keep a stale verdict.
        names.delete(key);
        return;
      }
      if (names.size >= maxNames && !names.has(key)) names.clear();
      names.add(key);
    },
  };
}
