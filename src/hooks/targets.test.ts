import { describe, expect, test } from "bun:test";
import {
  createKnownTargets,
  entityUrl,
  knownTargets,
  sameTarget,
  targetKey,
} from "./targets";

describe("targetKey and sameTarget", () => {
  test("compare like GitHub: without case", () => {
    expect(targetKey({ kind: "owner", login: "Vercel" })).toBe("vercel");
    expect(targetKey({ kind: "repo", owner: "Vercel", name: "Next.js" })).toBe(
      "vercel/next.js",
    );
    expect(
      sameTarget(
        { kind: "owner", login: "Torvalds" },
        { kind: "owner", login: "torvalds" },
      ),
    ).toBe(true);
    expect(
      sameTarget(
        { kind: "owner", login: "vercel" },
        { kind: "repo", owner: "vercel", name: "next.js" },
      ),
    ).toBe(false);
  });
  test("null only equals null", () => {
    expect(sameTarget(null, null)).toBe(true);
    expect(sameTarget(null, { kind: "owner", login: "a" })).toBe(false);
  });
});

describe("entityUrl", () => {
  test("owners have a preview and a full view", () => {
    const owner = { kind: "owner", login: "Torvalds" } as const;
    expect(entityUrl(owner)).toBe("/api/v1/owners/torvalds");
    expect(entityUrl(owner, "preview")).toBe(
      "/api/v1/owners/torvalds?view=preview",
    );
  });
  test("repositories have one endpoint", () => {
    const repo = { kind: "repo", owner: "Vercel", name: "Next.js" } as const;
    expect(entityUrl(repo)).toBe("/api/v1/repos/vercel/next.js");
    expect(entityUrl(repo, "preview")).toBe("/api/v1/repos/vercel/next.js");
  });
});

describe("known targets", () => {
  test("remember slugs without case", () => {
    const known = createKnownTargets(["Torvalds"]);
    expect(known.has("torvalds")).toBe(true);
    expect(known.has("vercel/next.js")).toBe(false);
    known.add("Vercel/Next.js");
    expect(known.has("vercel/next.js")).toBe(true);
    known.add("");
    expect(known.has("")).toBe(false);
  });
  test("the page registry starts with the bundled samples", () => {
    expect(knownTargets.has("markeljan")).toBe(true);
    expect(knownTargets.has("vercel")).toBe(true);
    expect(knownTargets.has("vercel/next.js")).toBe(true);
    expect(knownTargets.has("no-such-sample")).toBe(false);
  });
});
