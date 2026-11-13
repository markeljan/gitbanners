import { describe, expect, test } from "bun:test";
import { createNameMemory } from "./memory";

describe("createNameMemory", () => {
  test("remembers names case-insensitively", () => {
    const memory = createNameMemory();
    expect(memory.has("vercel")).toBe(false);
    memory.note("Vercel", true);
    expect(memory.has("vercel")).toBe(true);
    expect(memory.has("VERCEL")).toBe(true);
    expect(memory.has("vercel-labs")).toBe(false);
  });

  test("a later verdict replaces the earlier one", () => {
    const memory = createNameMemory();
    memory.note("zeit", true);
    // The login changed hands.
    memory.note("ZEIT", false);
    expect(memory.has("zeit")).toBe(false);
    // Forgetting what was never known is fine.
    memory.note("never-seen", false);
    expect(memory.has("never-seen")).toBe(false);
  });

  test("is bounded: it starts over when full", () => {
    const memory = createNameMemory(3);
    for (const name of ["a", "b", "c"]) memory.note(name, true);
    // A name that is already known does not count as growth.
    memory.note("A", true);
    expect(["a", "b", "c"].every((name) => memory.has(name))).toBe(true);

    memory.note("d", true);
    expect(memory.has("d")).toBe(true);
    expect(["a", "b", "c"].some((name) => memory.has(name))).toBe(false);
  });

  test("memories are independent of each other", () => {
    const organizations = createNameMemory(2);
    const missing = createNameMemory(2);
    organizations.note("vercel", true);
    // A flood of unknown names only ever resets its own memory.
    for (let index = 0; index < 10; index += 1) {
      missing.note(`junk-${index}`, true);
    }
    expect(organizations.has("vercel")).toBe(true);
  });
});
