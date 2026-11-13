import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  spyOn,
  test,
} from "bun:test";
import {
  type FakeGitHub,
  fakeGitHub,
  fixture,
  htmlTimeout,
  json,
  type Reply,
} from "./__fixtures__/mock";
import { findStargazer } from "./stargazers";

const REPO = { owner: "markeljan", name: "gitbanners" };

/**
 * A stargazer list as an admin token sees it, newest first, 100 per page.
 * Synthetic on purpose: real stargazer lists are not public data any more.
 * User ids are 1000, 1001, ...
 */
function visibleList(
  stars: number,
  options: { reportedCount?: number; totalCount?: number } = {},
): Reply {
  return (call) => {
    const after = call.variables?.after;
    const start = typeof after === "string" ? Number(after) : 0;
    const ids = Array.from({ length: stars }, (_, index) => 1000 + index);
    const page = ids.slice(start, start + 100);
    const end = start + page.length;
    return json({
      data: {
        repository: {
          stargazerCount: options.reportedCount ?? stars,
          stargazers: {
            totalCount: options.totalCount ?? stars,
            pageInfo: {
              hasNextPage: end < stars,
              endCursor: page.length > 0 ? String(end) : null,
            },
            edges: page.map((databaseId) => ({ node: { databaseId } })),
          },
        },
      },
    });
  };
}

let fake: FakeGitHub;
let warn: Mock<typeof console.warn>;

function serve(reply: Reply): FakeGitHub {
  fake = fakeGitHub({ graphql: { Stargazers: reply } });
  return fake;
}

beforeEach(() => {
  process.env.GITHUB_TOKEN = "admin-token";
  warn = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  fake?.restore();
  warn.mockRestore();
  delete process.env.GITHUB_TOKEN;
});

describe("findStargazer", () => {
  test("starred: found on the first page, one request", async () => {
    serve(visibleList(250));
    expect(await findStargazer(REPO, 1042)).toBe("starred");
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.variables).toEqual({
      owner: "markeljan",
      name: "gitbanners",
      after: null,
    });
  });

  test("starred: found on a later page", async () => {
    serve(visibleList(250));
    expect(await findStargazer(REPO, 1230)).toBe("starred");
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls.map((call) => call.variables?.after)).toEqual([
      null,
      "100",
      "200",
    ]);
  });

  test("not_starred: the whole list was read and the user is not in it", async () => {
    serve(visibleList(250));
    expect(await findStargazer(REPO, 7)).toBe("not_starred");
    expect(fake.calls).toHaveLength(3);
  });

  test("not_starred: a repository nobody has starred", async () => {
    serve(visibleList(0));
    expect(await findStargazer(REPO, 1000)).toBe("not_starred");
    expect(fake.calls).toHaveLength(1);
  });

  test("unknown: the token cannot see the list (recorded response)", async () => {
    // vercel/next.js through a token without admin access: 143k stars, no entries.
    serve(fixture("stargazers.not-visible.json") as object);
    expect(
      await findStargazer({ owner: "vercel", name: "next.js" }, 1000),
    ).toBe("unknown");
  });

  test("unknown: fewer entries than the star count", async () => {
    serve(visibleList(40, { reportedCount: 55 }));
    expect(await findStargazer(REPO, 7)).toBe("unknown");
    // A member of the visible part is still a certain yes.
    expect(await findStargazer(REPO, 1010)).toBe("starred");
  });

  test("unknown: the list reports fewer entries than there are stars", async () => {
    serve(visibleList(40, { totalCount: 39 }));
    expect(await findStargazer(REPO, 7)).toBe("unknown");
  });

  test("unknown: the list is longer than maxPages", async () => {
    serve(visibleList(250));
    expect(await findStargazer(REPO, 7, { maxPages: 2 })).toBe("unknown");
    expect(fake.calls).toHaveLength(2);
    // Old stargazers beyond the limit are not "not starred" either.
    expect(await findStargazer(REPO, 1249, { maxPages: 2 })).toBe("unknown");
    expect(await findStargazer(REPO, 1249, { maxPages: 3 })).toBe("starred");
  });

  test("the default reads at most ten pages", async () => {
    serve(visibleList(1500));
    expect(await findStargazer(REPO, 7)).toBe("unknown");
    expect(fake.calls).toHaveLength(10);
  });

  test("unknown: the repository does not resolve for this token", async () => {
    serve({
      data: { repository: null },
      errors: [
        {
          type: "NOT_FOUND",
          path: ["repository"],
          message:
            "Could not resolve to a Repository with the name 'markeljan/gitbanners'.",
        },
      ],
    });
    expect(await findStargazer(REPO, 1000)).toBe("unknown");
    expect(warn).not.toHaveBeenCalled();
  });

  test("unknown: GitHub fails or throttles (logged, never thrown)", async () => {
    serve(htmlTimeout());
    expect(await findStargazer(REPO, 1000)).toBe("unknown");

    serve(json({ message: "Bad credentials" }, { status: 401 }));
    expect(await findStargazer(REPO, 1000)).toBe("unknown");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      "stargazer check unavailable for markeljan/gitbanners",
    );
  });

  test("unknown: a failure after the first page", async () => {
    let page = 0;
    const list = visibleList(250);
    serve((call) => {
      page += 1;
      if (page === 2) return htmlTimeout(504);
      return typeof list === "function" ? list(call) : json(list);
    });
    expect(await findStargazer(REPO, 7)).toBe("unknown");
  });

  test("unknown: no token, or nothing that could be a match", async () => {
    serve(visibleList(10));
    expect(await findStargazer(REPO, 0)).toBe("unknown");
    expect(await findStargazer(REPO, -5)).toBe("unknown");
    expect(await findStargazer(REPO, 1.5)).toBe("unknown");
    expect(await findStargazer(REPO, Number.NaN)).toBe("unknown");
    expect(await findStargazer({ owner: "not a login", name: "x" }, 1000)).toBe(
      "unknown",
    );
    delete process.env.GITHUB_TOKEN;
    expect(await findStargazer(REPO, 1000)).toBe("unknown");
    expect(fake.calls).toHaveLength(0);
  });

  test("an explicit token is used instead of the server token", async () => {
    serve(visibleList(10));
    expect(await findStargazer(REPO, 1003, { token: "stars-token" })).toBe(
      "starred",
    );
    expect(fake.calls[0]?.headers.get("authorization")).toBe(
      "Bearer stars-token",
    );
  });

  test("matching is on the numeric id only", async () => {
    serve({
      data: {
        repository: {
          stargazerCount: 2,
          stargazers: {
            totalCount: 2,
            pageInfo: { hasNextPage: false, endCursor: "2" },
            edges: [
              { node: { databaseId: null } },
              { node: { databaseId: 77 } },
            ],
          },
        },
      },
    });
    expect(await findStargazer(REPO, 77)).toBe("starred");
    expect(await findStargazer(REPO, 78)).toBe("not_starred");
  });
});
