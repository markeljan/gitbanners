import { describe, expect, test } from "bun:test";
import {
  SESSION_HINT_RE,
  SIGNED_IN_ATTRIBUTE,
  THEME_STORAGE_KEY,
  themeInitScript,
} from "./theme";

/** Runs the inline bootstrap against a stand-in document. */
function run(stored: string | null | Error, cookie: string) {
  const attributes = new Map<string, string>([["data-theme", "dark"]]);
  const root = {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  };
  const storage = {
    getItem(key: string) {
      if (stored instanceof Error) throw stored;
      return key === THEME_STORAGE_KEY ? stored : null;
    },
  };
  new Function("document", "localStorage", themeInitScript)(
    { documentElement: root, cookie },
    storage,
  );
  return attributes;
}

describe("themeInitScript", () => {
  test("applies a stored light or dark mode", () => {
    expect(run("light", "").get("data-theme")).toBe("light");
    expect(run("dark", "").get("data-theme")).toBe("dark");
  });
  test('"system" removes the attribute so the OS decides', () => {
    expect(run("system", "").has("data-theme")).toBe(false);
  });
  test("nothing stored or junk keeps the server's default", () => {
    expect(run(null, "").get("data-theme")).toBe("dark");
    expect(run("purple", "").get("data-theme")).toBe("dark");
  });
  test("blocked storage does not stop the session hint", () => {
    const attributes = run(new Error("denied"), "gb_in=1");
    expect(attributes.get("data-theme")).toBe("dark");
    expect(attributes.has(SIGNED_IN_ATTRIBUTE)).toBe(true);
  });
  test("marks the document only while the hint cookie exists", () => {
    expect(run(null, "a=b; __Host-gb_in=1").has(SIGNED_IN_ATTRIBUTE)).toBe(
      true,
    );
    expect(run(null, "a=b; gb_in=0").has(SIGNED_IN_ATTRIBUTE)).toBe(false);
    expect(run(null, "").has(SIGNED_IN_ATTRIBUTE)).toBe(false);
  });
  test("embeds the same pattern the hooks use", () => {
    expect(themeInitScript).toContain(SESSION_HINT_RE.source);
  });
});
