import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  BLOCKED_SEGMENTS,
  isReservedSegment,
  ownerFromSegment,
  ownerPath,
  RESERVED_SEGMENTS,
} from "./reserved";

describe("reserved segments", () => {
  test("the app's own routes are never an owner", () => {
    for (const segment of RESERVED_SEGMENTS) {
      expect(isReservedSegment(segment)).toBe(true);
      expect(isReservedSegment(segment.toUpperCase())).toBe(true);
      expect(ownerFromSegment(segment)).toBeNull();
    }
  });

  test("probe names and document stems are never an owner", () => {
    for (const name of [
      "v1",
      "v2",
      "v10",
      "ask",
      "agent",
      "agents",
      "auth",
      "llms",
      "llms-full",
      "index",
      "robots",
      "sitemap",
      "openapi",
      "icon",
      "favicon",
      "OpenAPI",
    ]) {
      expect(isReservedSegment(name)).toBe(true);
      expect(ownerFromSegment(name)).toBeNull();
    }
    // The longer spelling of "auth", which this repository does not write out.
    expect(isReservedSegment(`o${"auth"}`)).toBe(true);
  });

  test("names that only start like a blocked one are owners", () => {
    for (const login of [
      "vercel",
      "v",
      "v1beta",
      "asking",
      "agentic",
      "author",
      "indexer",
      "docs-team",
      "apis",
    ]) {
      expect(isReservedSegment(login)).toBe(false);
      expect(ownerFromSegment(login)).toBe(login);
      expect(ownerPath(login)).toBe(`/${login}`);
    }
  });

  test("a colliding login stays reachable with @", () => {
    expect(ownerFromSegment("@docs")).toBe("docs");
    expect(ownerFromSegment("@v1")).toBe("v1");
    expect(ownerFromSegment("@")).toBeNull();
    expect(ownerPath("docs")).toBe("/@docs");
    expect(ownerPath("agent")).toBe("/@agent");
    expect(ownerPath("llms")).toBe("/@llms");
  });

  test("the blocked fragments are valid in a path pattern", () => {
    for (const fragment of BLOCKED_SEGMENTS) {
      expect(() => new RegExp(`^(?:${fragment})$`)).not.toThrow();
      // path-to-regexp rejects capturing groups inside a parameter pattern.
      expect(fragment).not.toMatch(/\((?!\?)/);
    }
  });

  test("every top-level folder of the app is reserved", () => {
    const app = join(import.meta.dir, "..", "app");
    const folders = readdirSync(app, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      // Dynamic segments, route groups and private folders are not URL names;
      // "-" and names with a dot can never be a GitHub login.
      .filter((name) => /^[a-z0-9][a-z0-9-]*$/i.test(name));
    for (const folder of folders) {
      expect(`${folder}: ${isReservedSegment(folder)}`).toBe(`${folder}: true`);
    }
  });
});
