/**
 * The in-page tools are written as literals on purpose (agents and scanners
 * read them from the script), so nothing ties their text to the registries
 * at compile time. These tests do: an id named in a tool definition must
 * exist, and the docs must list the tools that are registered.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { docs } from "@/content/docs";
import {
  DEFAULT_SIZE_ID,
  DEFAULT_THEME_ID,
  PRESETS,
  SIZE_IDS,
  THEMES,
} from "@/lib/banner";

// The code without its comments: they mention the call they explain.
const source = readFileSync(join(import.meta.dir, "webmcp.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const tools = [
  ...source.matchAll(/registerTool\(\s*\{\s*name: "([a-z_]+)"/g),
].map(([, name]) => name);

describe("WebMCP registration", () => {
  test("registers each tool with a literal call on document.modelContext", () => {
    expect(tools).toEqual([
      "search_github",
      "get_banner",
      "list_banner_options",
      "save_banner",
      "update_saved_banner",
    ]);
    expect(
      source.match(/document\.modelContext\.registerTool\(/g)?.length,
    ).toBe(tools.length);
    // The deprecated alias is not an entry point.
    expect(source).not.toContain("navigator.modelContext");
  });

  test("names are verb-first snake_case, each with a description and a handler", () => {
    for (const name of tools) expect(name).toMatch(/^[a-z]+(_[a-z]+)+$/);
    expect(source.match(/\bdescription:\s/g)?.length).toBeGreaterThanOrEqual(
      tools.length,
    );
    expect(source.match(/\bexecute: /g)?.length).toBe(tools.length + 1);
  });

  test("read tools say so, write tools do not", () => {
    const hints = [
      ...source.matchAll(/annotations: \{ readOnlyHint: (true|false)/g),
    ].map(([, value]) => value);
    expect(hints).toEqual(["true", "true", "true", "false", "false"]);
    // Search results and banner descriptions carry text written by GitHub users.
    expect(source.match(/untrustedContentHint: true/g)?.length).toBe(2);
  });

  test("ids named in the definitions exist in the registries", () => {
    expect(source).toContain(`Default "${DEFAULT_THEME_ID}"`);
    expect(source).toContain(`Default "${DEFAULT_SIZE_ID}"`);
    const themes = new Set<string>(THEMES.map((theme) => theme.id));
    const sizes = new Set<string>(SIZE_IDS);
    const presets = new Set<string>(PRESETS.map((preset) => preset.id));
    expect(themes.has("dracula")).toBe(true);
    for (const size of ["og", "x"]) expect(sizes.has(size)).toBe(true);
    for (const preset of ["streak", "contributors"]) {
      expect(presets.has(preset)).toBe(true);
    }
  });

  test("the docs list exactly the tools that are registered", () => {
    const section = docs.sections.find((entry) => entry.id === "webmcp");
    const text = JSON.stringify(section);
    for (const name of tools) expect(text).toContain(`\`${name}\``);
    expect(text.match(/`[a-z]+(_[a-z]+)+`/g)?.length).toBe(tools.length);
  });
});
