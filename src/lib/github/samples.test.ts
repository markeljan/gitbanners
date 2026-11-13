import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { site } from "@/lib/site";
import { computeStreak } from "./calendar";
import { isStatisticsPending, LIMITS } from "./normalize";
import {
  getSample,
  SAMPLE_ORG,
  SAMPLE_REPO,
  SAMPLE_USER,
  SAMPLES,
} from "./samples";
import { EntitySchema } from "./schema";

const SAMPLES_DIR = join(import.meta.dir, "__fixtures__/samples");

describe("bundled samples", () => {
  test("the first of each kind", () => {
    expect(SAMPLE_USER.kind).toBe("user");
    expect(SAMPLE_USER.login).toBe(site.exampleLogin);
    expect(SAMPLE_ORG.kind).toBe("org");
    expect(SAMPLE_ORG.login).toBe("vercel");
    expect(SAMPLE_REPO.kind).toBe("repo");
    expect(SAMPLE_REPO.fullName).toBe("vercel/next.js");
  });

  test("two users, one organization, two repositories", () => {
    expect(
      SAMPLES.map((entity) =>
        entity.kind === "repo" ? entity.fullName : entity.login,
      ),
    ).toEqual([
      "markeljan",
      "torvalds",
      "vercel",
      "vercel/next.js",
      "sindresorhus/yocto-queue",
    ]);
  });

  test("every file on disk is bundled and satisfies the schema", () => {
    const files = readdirSync(SAMPLES_DIR).filter((name) =>
      name.endsWith(".json"),
    );
    expect(files).toHaveLength(SAMPLES.length);
    for (const file of files) {
      const text = readFileSync(join(SAMPLES_DIR, file), "utf8");
      const entity = EntitySchema.parse(JSON.parse(text));
      // Nothing beyond the model is stored (parse strips unknown keys).
      expect(JSON.parse(text)).toEqual(entity);
      expect(SAMPLES).toContainEqual(entity);
      // Small enough to ship in a bundle.
      expect(text.length).toBeLessThan(40_000);
    }
  });

  test("samples are complete, not provisional", () => {
    for (const entity of SAMPLES) {
      expect(isStatisticsPending(entity)).toBe(false);
      if (entity.kind === "user") {
        expect(entity.complete).toBe(true);
        expect(entity.wrapped).toBeNull();
        expect(entity.calendar.days.length).toBeGreaterThan(360);
        expect(entity.repos.length).toBeLessThanOrEqual(LIMITS.repos);
        expect(entity.languages.length).toBeGreaterThan(0);
        expect(entity.stats.commits).not.toBeNull();
        expect(entity.stats.stars).not.toBeNull();
        // The streak was computed on the day the sample was taken.
        expect(
          computeStreak(entity.calendar.days, entity.fetchedAt.slice(0, 10)),
        ).toEqual(entity.streak);
      } else if (entity.kind === "org") {
        expect(entity.activity).not.toBeNull();
        expect(entity.repos).toHaveLength(LIMITS.repos);
        expect(entity.people.length).toBeGreaterThan(0);
        expect(entity.people.length).toBeLessThanOrEqual(LIMITS.people);
      } else {
        expect(entity.activity?.weeks).toHaveLength(52);
        expect(entity.starHistory?.length).toBeGreaterThan(0);
        expect(entity.contributors.length).toBeGreaterThan(0);
        expect(entity.contributors.length).toBeLessThanOrEqual(
          LIMITS.contributors,
        );
      }
    }
  });

  test("no field of a sample can carry private data", () => {
    const keys = new Set<string>();
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(collect);
      else if (typeof value === "object" && value !== null) {
        for (const [key, child] of Object.entries(value)) {
          keys.add(key);
          collect(child);
        }
      }
    };
    collect(SAMPLES);
    for (const forbidden of [
      "email",
      "isPrivate",
      "visibility",
      "token",
      "restrictedContributionsCount",
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });
});

describe("getSample", () => {
  test("owners and repositories, case-insensitively", () => {
    expect(getSample({ kind: "owner", login: "markeljan" })).toBe(SAMPLE_USER);
    expect(getSample({ kind: "owner", login: "MarkelJan" })).toBe(SAMPLE_USER);
    expect(getSample({ kind: "owner", login: "VERCEL" })).toBe(SAMPLE_ORG);
    expect(getSample({ kind: "owner", login: "torvalds" })?.kind).toBe("user");
    expect(getSample({ kind: "repo", owner: "Vercel", name: "Next.JS" })).toBe(
      SAMPLE_REPO,
    );
    expect(
      getSample({ kind: "repo", owner: "sindresorhus", name: "yocto-queue" })
        ?.kind,
    ).toBe("repo");
  });

  test("null for everything else", () => {
    expect(getSample({ kind: "owner", login: "octocat" })).toBeNull();
    expect(getSample({ kind: "owner", login: "" })).toBeNull();
    expect(
      getSample({ kind: "repo", owner: "vercel", name: "swr" }),
    ).toBeNull();
    // An owner target never resolves to a repository and vice versa.
    expect(getSample({ kind: "owner", login: "vercel/next.js" })).toBeNull();
    expect(getSample({ kind: "repo", owner: "", name: "vercel" })).toBeNull();
    expect(getSample({ kind: "repo", owner: "vercel", name: "" })).toBeNull();
  });
});
