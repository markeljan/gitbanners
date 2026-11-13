import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type FakeGitHub,
  fakeGitHub,
  fixture,
  fixtureData,
  fixtureText,
} from "./__fixtures__/mock";
import { toCalendar } from "./calendar";
import { GitHubError } from "./errors";
import {
  fetchPublicCalendar,
  fetchPublicOwner,
  parseContributionsHtml,
} from "./fallback";
import { decode, OwnerCoreDataSchema } from "./raw";
import { CalendarSchema } from "./schema";

const NOW = new Date("2026-11-13T04:23:19Z");
const HTML = fixtureText("contributions.torvalds.html");

/** What the research parser produced from the same fragment. */
const expected = fixture("contributions.torvalds.parsed.json") as {
  total: number;
  days: { date: string; level: number; count: number }[];
};

let fake: FakeGitHub;

function serveHtml(body: string | Response): FakeGitHub {
  fake = fakeGitHub({
    web: [
      [
        /^\/users\/[^/]+\/contributions/,
        typeof body === "string" ? new Response(body) : body,
      ],
    ],
  });
  return fake;
}

beforeEach(() => {
  delete process.env.GITHUB_TOKEN;
});

afterEach(() => {
  fake?.restore();
});

describe("parseContributionsHtml", () => {
  test("the recorded fragment: every day, count and level", () => {
    const parsed = parseContributionsHtml(HTML);
    expect(parsed?.total).toBe(4015);
    expect(parsed?.days).toHaveLength(370);
    expect(parsed?.days).toEqual(
      expected.days.map(({ date, count, level }) => ({ date, count, level })),
    );
    expect(parsed?.days[0]?.date).toBe("2025-11-09");
    expect(parsed?.days.at(-1)?.date).toBe("2026-11-13");
    expect(parsed?.days.reduce((sum, day) => sum + day.count, 0)).toBe(4015);
  });

  test("agrees with the GraphQL calendar of the same day, day for day", () => {
    const owner = decode(
      OwnerCoreDataSchema,
      fixtureData("owner-core.torvalds.json"),
      "core",
    ).repositoryOwner;
    if (owner?.__typename !== "User") throw new Error("not a user");
    const graphql = toCalendar(
      owner.contributionsCollection.contributionCalendar.weeks,
      "2026-11-13",
    );
    const html = parseContributionsHtml(HTML);
    expect(html?.days.map((day) => day.date)).toEqual(
      graphql.days.map((day) => day.date),
    );
    // The two were recorded hours apart; the days in between may have moved.
    const settled = (days: typeof graphql.days) =>
      days.filter((day) => day.date < "2026-11-12");
    expect(settled(html?.days ?? [])).toEqual(settled(graphql.days));
  });

  test("singular, plural, thousands and 'No contributions'", () => {
    const cell = (id: string, date: string, level: number, tip: string) =>
      `<td tabindex="0" data-ix="0" style="width: 10px" data-date="${date}" id="contribution-day-component-${id}" data-level="${level}" role="gridcell" class="ContributionCalendar-day"></td>
       <tool-tip id="tooltip-${id}" for="contribution-day-component-${id}" popover="manual" class="sr-only position-absolute">${tip}</tool-tip>`;
    const parsed = parseContributionsHtml(`
      <h2 tabindex="-1" id="js-contribution-activity-description" class="f4 text-normal mb-2">
        1,236
        contributions
          in 2024
      </h2>
      <table><tbody><tr>
        ${cell("0-1", "2024-01-08", 4, "1,234 contributions on January 8th.")}
        ${cell("0-0", "2024-01-01", 1, "1 contribution on January 1st.")}
        ${cell("1-0", "2024-01-02", 0, "No contributions on January 2nd.")}
        ${cell("2-0", "2024-01-03", 1, "1 contribution on January 3rd.")}
      </tr></tbody></table>
      <div class="ContributionCalendar-day" data-level="2"></div>`);
    expect(parsed).toEqual({
      total: 1236,
      days: [
        { date: "2024-01-01", count: 1, level: 1 },
        { date: "2024-01-02", count: 0, level: 0 },
        { date: "2024-01-03", count: 1, level: 1 },
        { date: "2024-01-08", count: 1234, level: 4 },
      ],
    });
  });

  test("a missing heading keeps the days", () => {
    const parsed = parseContributionsHtml(
      HTML.replace('id="js-contribution-activity-description"', 'id="renamed"'),
    );
    expect(parsed?.total).toBeNull();
    expect(parsed?.days).toHaveLength(370);
  });

  test.each([
    [
      "an empty wrapper (hidden accounts)",
      '<div class="js-yearly-contributions"></div>',
    ],
    ["an unrelated page", "<html><body>Sign in to GitHub</body></html>"],
    ["nothing", ""],
    [
      "renamed cell class",
      HTML.replaceAll("ContributionCalendar-day", "Calendar-cell"),
    ],
    ["tooltips gone", HTML.replaceAll("<tool-tip", "<tooltip")],
    [
      "tooltips detached from cells",
      HTML.replaceAll(' for="contribution-day-component-', ' data-for="x-'),
    ],
    [
      "tooltip wording changed",
      HTML.replaceAll(" contributions on ", " commits on "),
    ],
    ["levels gone", HTML.replaceAll("data-level=", "data-intensity=")],
    ["a level out of range", HTML.replace('data-level="1"', 'data-level="7"')],
    [
      "dates in another format",
      HTML.replaceAll(
        /data-date="(\d{4})-(\d{2})-(\d{2})"/g,
        'data-date="$2/$3/$1"',
      ),
    ],
  ])("markup drift is null, not an exception: %s", (_name, html) => {
    expect(parseContributionsHtml(html)).toBeNull();
  });
});

describe("fetchPublicCalendar", () => {
  test("the last 12 months, without credentials", async () => {
    process.env.GITHUB_TOKEN = "server-token";
    serveHtml(HTML);
    const calendar = await fetchPublicCalendar("torvalds", { now: NOW });

    expect(calendar && CalendarSchema.parse(calendar)).toEqual(calendar);
    expect(calendar?.total).toBe(4015);
    expect(calendar?.from).toBe("2025-11-09");
    expect(calendar?.to).toBe("2026-11-13");
    expect(calendar?.days).toHaveLength(370);
    const [call] = fake.calls;
    expect(call?.url.href).toBe(
      "https://github.com/users/torvalds/contributions",
    );
    // Even with a server token configured: this is the public website.
    expect(call?.headers.has("authorization")).toBe(false);
    expect(call?.headers.get("user-agent")).toBe("gitbanners");
  });

  test("a calendar year, cut at today", async () => {
    serveHtml(HTML);
    const calendar = await fetchPublicCalendar("torvalds", {
      now: new Date("2026-03-01T12:00:00Z"),
      year: 2026,
    });
    expect(fake.calls[0]?.url.search).toBe("?from=2026-01-01&to=2026-12-31");
    expect(calendar?.to).toBe("2026-03-01");
    expect(calendar?.days.at(-1)?.date).toBe("2026-03-01");
  });

  test.each([
    [
      "an unknown login or an organization (404)",
      new Response("Not Found", { status: 404 }),
    ],
    ["throttling (429)", new Response("Too many requests", { status: 429 })],
    ["a server error", new Response("oops", { status: 500 })],
    ["changed markup", new Response("<div>redesigned</div>")],
    [
      "an empty wrapper",
      new Response('<div class="js-yearly-contributions"></div>'),
    ],
  ])("null for %s", async (_name, response) => {
    serveHtml(response);
    expect(await fetchPublicCalendar("someone", { now: NOW })).toBeNull();
  });

  test("null when github.com cannot be reached", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = Object.assign(
      () => Promise.reject(new TypeError("fetch failed")),
      { preconnect: original.preconnect },
    );
    try {
      expect(await fetchPublicCalendar("torvalds", { now: NOW })).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("null without a request for impossible logins and years", async () => {
    serveHtml(HTML);
    expect(await fetchPublicCalendar("not a login", { now: NOW })).toBeNull();
    expect(await fetchPublicCalendar("a/b", { now: NOW })).toBeNull();
    expect(
      await fetchPublicCalendar("torvalds", { now: NOW, year: 1999 }),
    ).toBeNull();
    expect(
      await fetchPublicCalendar("torvalds", { now: NOW, year: 2027 }),
    ).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });
});

describe("fetchPublicOwner", () => {
  test("null without a request for an impossible login", async () => {
    fake = fakeGitHub({});
    expect(await fetchPublicOwner("not a login")).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  test("a year out of range is invalid, without a request", async () => {
    fake = fakeGitHub({});
    const error = await fetchPublicOwner("torvalds", {
      now: NOW,
      year: 1999,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error.code).toBe("invalid");
    expect(fake.calls).toHaveLength(0);
  });

  test("profile and calendar are requested together", async () => {
    fake = fakeGitHub({
      rest: [
        [/^\/users\/torvalds$/, fixture("rest-user.torvalds.json") as object],
      ],
      web: [[/^\/users\/torvalds\/contributions$/, new Response(HTML)]],
    });
    const owner = await fetchPublicOwner("torvalds", { now: NOW });
    expect(owner?.kind).toBe("user");
    expect(fake.unexpected).toEqual([]);
    expect(fake.calls.map((call) => call.url.hostname).sort()).toEqual([
      "api.github.com",
      "github.com",
    ]);
  });
});
