import { describe, expect, test } from "bun:test";
import { getPreset } from "@/lib/banner";
import {
  SAMPLE_ORG,
  SAMPLE_REPO,
  SAMPLE_USER,
  SAMPLES,
} from "@/lib/github/samples";
import type { User } from "@/lib/github/schema";
import {
  entityLabel,
  headlineFacts,
  listing,
  pageDescription,
  pageTitle,
  summary,
} from "./copy";

const torvalds = SAMPLES.find(
  (entity): entity is User =>
    entity.kind === "user" && entity.login === "torvalds",
);

describe("titles", () => {
  test("follow the page title pattern", () => {
    if (!torvalds) throw new Error("sample missing");
    expect(pageTitle(torvalds, getPreset("user", "overview"))).toBe(
      "Linus Torvalds (@torvalds) GitHub banner",
    );
    expect(pageTitle(torvalds, getPreset("user", "activity"))).toBe(
      "Linus Torvalds (@torvalds) GitHub banner: Activity",
    );
    expect(pageTitle(SAMPLE_REPO, getPreset("repo", "overview"))).toBe(
      "vercel/next.js GitHub banner",
    );
  });

  test("an account without a display name is its handle", () => {
    expect(entityLabel({ ...SAMPLE_USER, name: null })).toBe("@markeljan");
    expect(entityLabel({ ...SAMPLE_USER, name: "  " })).toBe("@markeljan");
  });
});

describe("summary", () => {
  test("quotes the entity's own numbers and names", () => {
    if (!torvalds) throw new Error("sample missing");
    const text = summary(torvalds);
    expect(text).toContain("4,015 contributions");
    expect(text).toContain("longest streak of 104 days");
    expect(text).toContain("linux");
    expect(summary(SAMPLE_ORG)).toContain("verified GitHub organization");
    expect(summary(SAMPLE_ORG)).toContain("next.js");
    expect(summary(SAMPLE_REPO)).toContain("143,499 stars");
    expect(summary(SAMPLE_REPO)).toContain("v16.4.6");
  });

  test("is different for every sample", () => {
    const texts = new Set(SAMPLES.map(summary));
    expect(texts.size).toBe(SAMPLES.length);
  });

  test("an account with no activity gets a true sentence", () => {
    const quiet: User = {
      ...SAMPLE_USER,
      calendar: { ...SAMPLE_USER.calendar, total: 0 },
      languages: [],
      repos: [],
    };
    expect(summary(quiet)).toBe(
      "markeljan has no public contributions on GitHub this year.",
    );
  });
});

describe("pageDescription", () => {
  test("stays within 160 characters", () => {
    for (const entity of SAMPLES) {
      const preset = getPreset(entity.kind, null);
      expect(pageDescription(entity, preset).length).toBeLessThanOrEqual(160);
    }
  });
});

describe("headlineFacts", () => {
  test("numbers are written in full", () => {
    if (!torvalds) throw new Error("sample missing");
    const followers = headlineFacts(torvalds).find(
      (item) => item.label === "Followers",
    );
    expect(followers?.value).toBe("331,794");
  });

  test("unknown numbers are left out, not shown as zero", () => {
    const partial: User = {
      ...SAMPLE_USER,
      stats: { ...SAMPLE_USER.stats, commits: null, reviews: null },
    };
    const labels = headlineFacts(partial).map((item) => item.label);
    expect(labels).not.toContain("Commits");
    expect(labels).not.toContain("Pull request reviews");
  });
});

test("listing joins like a sentence", () => {
  expect(listing([])).toBe("");
  expect(listing(["C"])).toBe("C");
  expect(listing(["C", "Rust"])).toBe("C and Rust");
  expect(listing(["C", "Rust", "Go"])).toBe("C, Rust and Go");
});
