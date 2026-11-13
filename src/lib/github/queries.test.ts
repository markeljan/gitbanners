/**
 * Guards on the GraphQL documents themselves: the privacy and latency rules
 * they were written under are easy to break with a one-line edit.
 */
import { describe, expect, test } from "bun:test";
import * as queries from "./queries";

const documents = Object.entries(queries);

describe("GraphQL documents", () => {
  test("there is one named operation per document", () => {
    expect(documents.length).toBeGreaterThanOrEqual(10);
    for (const [name, document] of documents) {
      expect(typeof document).toBe("string");
      expect(document.match(/\bquery \w+/g) ?? []).toHaveLength(1);
      expect(name).toMatch(/^[A-Z_]+$/);
    }
  });

  test("every repositories connection is restricted to public repositories", () => {
    let connections = 0;
    for (const [, document] of documents) {
      for (const match of document.matchAll(/repositories\(([^)]*)\)/g)) {
        connections += 1;
        expect(match[1]).toContain("privacy: PUBLIC");
      }
    }
    expect(connections).toBeGreaterThanOrEqual(6);
  });

  test("repositories reached without a privacy filter carry their visibility", () => {
    // Pinned items, per-repository contributions and search hits cannot be
    // filtered by GitHub, so the normalizer must be able to drop them.
    for (const document of [
      queries.USER_EXTRAS,
      queries.USER_YEAR_REVIEW,
      queries.SEARCH_REPOS,
    ]) {
      expect(document).toContain("isPrivate");
      expect(document).toContain("visibility");
    }
  });

  test("nothing that needs extra scopes or exposes private memberships", () => {
    for (const [, document] of documents) {
      // `email` fails the whole query without read:user / user:email.
      expect(document).not.toMatch(/\bemail\b/);
      // Both include private memberships when the token can see them.
      expect(document).not.toMatch(/\borganizations\b/);
      expect(document).not.toMatch(/\bmembersWithRole\b/);
      // Counts that include private items for the token owner.
      expect(document).not.toMatch(/\brepositoriesContributedTo\b/);
      expect(document).not.toMatch(/\bstarredRepositories\b/);
    }
  });

  test("the calendar and the slow contribution totals are separate documents", () => {
    expect(queries.OWNER_CORE).toContain("contributionCalendar");
    expect(queries.OWNER_CORE).not.toMatch(
      /total\w+Contributions\b(?<!totalContributions)/,
    );
    expect(queries.OWNER_CORE).not.toContain("restrictedContributionsCount");
    expect(queries.OWNER_CORE).not.toMatch(/hasAny\w+/);
    expect(queries.USER_TOTALS).toContain("totalCommitContributions");
    expect(queries.USER_TOTALS).not.toContain("contributionCalendar");
    // Never the calendar's own colours: always the legacy light palette.
    expect(queries.OWNER_CORE).not.toMatch(/contributionDays \{[^}]*\bcolor\b/);
    expect(queries.OWNER_CORE).not.toMatch(/\bcolors\b/);
  });

  test("the known multi-second fields stay out", () => {
    for (const [, document] of documents) {
      expect(document).not.toMatch(/\breleases\s*[({]/);
      expect(document).not.toMatch(/\bforks\s*[({]/);
      expect(document).not.toMatch(/\bmentionableUsers\b/);
    }
  });
});
