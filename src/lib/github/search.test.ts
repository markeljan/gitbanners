import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type FakeGitHub,
  fakeGitHub,
  fixture,
  htmlTimeout,
} from "./__fixtures__/mock";
import { GitHubError } from "./errors";
import { OwnerSuggestionSchema } from "./schema";
import {
  MIN_SEARCH_LENGTH,
  parseSearchQuery,
  searchGitHub,
  searchQueryKey,
} from "./search";

let fake: FakeGitHub;

function serve(): FakeGitHub {
  fake = fakeGitHub({
    graphql: {
      SearchOwners: fixture("search-owners.verc.json") as object,
      SearchRepos: fixture("search-repos.vercel-ne.json") as object,
    },
  });
  return fake;
}

beforeEach(() => {
  process.env.GITHUB_TOKEN = "server-token";
});

afterEach(() => {
  fake?.restore();
  delete process.env.GITHUB_TOKEN;
});

describe("parseSearchQuery", () => {
  test.each([
    ["verc", { kind: "owners", prefix: "verc" }],
    ["  Verc ", { kind: "owners", prefix: "verc" }],
    ["@verc", { kind: "owners", prefix: "verc" }],
    ["ve", { kind: "owners", prefix: "ve" }],
    ["00", { kind: "owners", prefix: "00" }],
    ["foo--bar-", { kind: "owners", prefix: "foo--bar-" }],
    ["x".repeat(39), { kind: "owners", prefix: "x".repeat(39) }],
    ["vercel/", { kind: "repos", owner: "vercel", prefix: "" }],
    ["Vercel/Next.js", { kind: "repos", owner: "vercel", prefix: "next.js" }],
    ["vercel/.github", { kind: "repos", owner: "vercel", prefix: ".github" }],
    ["a/_", { kind: "repos", owner: "a", prefix: "_" }],
    [
      "https://github.com/vercel/next.js",
      { kind: "repos", owner: "vercel", prefix: "next.js" },
    ],
    [
      "github.com/vercel/next.js/tree/canary",
      { kind: "repos", owner: "vercel", prefix: "next.js" },
    ],
    ["https://www.github.com/torvalds", { kind: "owners", prefix: "torvalds" }],
    [
      `${"x".repeat(39)}/${"y".repeat(100)}`,
      { kind: "repos", owner: "x".repeat(39), prefix: "y".repeat(100) },
    ],
  ] as const)("%p", (input, expected) => {
    expect(parseSearchQuery(input)).toEqual(expected);
  });

  test.each([
    "",
    " ",
    "v",
    "@v",
    "-ab",
    "next.js",
    "under_score",
    "two words",
    "x".repeat(40),
    "/next.js",
    "-bad/repo",
    "has space/repo",
    "vercel/has space",
    `${"x".repeat(39)}/${"y".repeat(101)}`,
    `${"x".repeat(40)}/y`,
    // Attempts to add search qualifiers or break out of the term.
    "vercel is:private",
    "ve org:secret",
    've" OR "x',
    "vercel/ne user:acme",
    "vercel/ne+is:private",
    "vercel/n:e",
    "ve\nx",
    "vercel/ne\tis:private",
  ])("%p is not searchable", (input) => {
    expect(parseSearchQuery(input)).toBeNull();
  });

  test("what survives can only be login and repository-name characters", () => {
    for (const input of ["Verc", "vercel/Next.js", "a/_.-"]) {
      const parsed = parseSearchQuery(input);
      if (!parsed) throw new Error(`${input} should parse`);
      expect(searchQueryKey(parsed)).toMatch(/^[a-z\d-]+(\/[\w.-]*)?$/);
    }
  });

  test("one key for every spelling of the same search", () => {
    const key = (input: string) => {
      const parsed = parseSearchQuery(input);
      return parsed && searchQueryKey(parsed);
    };
    expect(key(" @Verc")).toBe("verc");
    expect(key("VERC")).toBe("verc");
    expect(key("Vercel/Ne")).toBe("vercel/ne");
    expect(key("https://github.com/vercel/ne")).toBe("vercel/ne");
    expect(key("vercel/")).toBe("vercel/");
    expect(MIN_SEARCH_LENGTH).toBe(2);
  });
});

describe("searchGitHub", () => {
  test("a login prefix searches users and organizations", async () => {
    serve();
    const suggestions = await searchGitHub(" Verc ");

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.operation).toBe("SearchOwners");
    expect(fake.calls[0]?.variables).toEqual({
      query: "verc in:login sort:followers",
    });
    expect(suggestions).toHaveLength(6);
    for (const suggestion of suggestions) {
      expect(OwnerSuggestionSchema.parse(suggestion)).toEqual(suggestion);
      expect(suggestion.stars).toBeNull();
    }
    expect(suggestions.map((s) => `${s.kind}:${s.slug}`).slice(0, 3)).toEqual([
      "org:vercel",
      "org:vercel-labs",
      "user:verciless",
    ]);
  });

  test("owner/prefix searches that owner's public repositories", async () => {
    serve();
    const suggestions = await searchGitHub("Vercel/Ne");

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.operation).toBe("SearchRepos");
    expect(fake.calls[0]?.variables).toEqual({
      query: "user:vercel ne in:name is:public fork:true sort:stars",
    });
    expect(suggestions[0]).toMatchObject({
      kind: "repo",
      slug: "vercel/next.js",
      title: "The React Framework",
    });
    expect(suggestions.every((s) => s.kind === "repo")).toBe(true);
    expect(suggestions.every((s) => typeof s.stars === "number")).toBe(true);
    expect(suggestions.length).toBeLessThanOrEqual(6);
  });

  test("owner/ alone lists the owner's top repositories", async () => {
    serve();
    await searchGitHub("vercel/");
    expect(fake.calls[0]?.variables).toEqual({
      query: "user:vercel in:name is:public fork:true sort:stars",
    });
  });

  test("every repository search is restricted to public repositories", async () => {
    serve();
    for (const query of ["a/", "vercel/next", "torvalds/li", "x/.github"]) {
      await searchGitHub(query);
    }
    for (const call of fake.calls) {
      expect(String(call.variables?.query)).toContain(" is:public ");
    }
  });

  test("a private hit is dropped, hits of other types are skipped", async () => {
    fake = fakeGitHub({
      graphql: {
        SearchRepos: {
          data: {
            search: {
              nodes: [
                {
                  nameWithOwner: "acme/secret",
                  description: "must not leak",
                  stargazerCount: 5,
                  isPrivate: true,
                  visibility: "PRIVATE",
                  owner: {
                    avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
                  },
                },
                {},
                null,
                {
                  nameWithOwner: "acme/public",
                  description: "",
                  stargazerCount: 1,
                  isPrivate: false,
                  visibility: "PUBLIC",
                  owner: {
                    avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
                  },
                },
              ],
            },
          },
        },
        SearchOwners: {
          data: {
            search: {
              nodes: [
                {},
                { __typename: "Bot", login: "some-bot" },
                {
                  __typename: "User",
                  login: "acme",
                  name: "",
                  avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
                },
              ],
            },
          },
        },
      },
    });
    expect(await searchGitHub("acme/")).toEqual([
      {
        kind: "repo",
        slug: "acme/public",
        title: null,
        avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
        stars: 1,
      },
    ]);
    expect(await searchGitHub("acme")).toEqual([
      {
        kind: "user",
        slug: "acme",
        title: null,
        avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
        stars: null,
      },
    ]);
  });

  test.each([
    "",
    "v",
    "next.js",
    "two words",
    "vercel is:private",
    "x".repeat(40),
    `vercel/${"y".repeat(137)}`,
  ])("%p returns [] without a request", async (query) => {
    serve();
    expect(await searchGitHub(query)).toEqual([]);
    expect(fake.calls).toHaveLength(0);
  });

  test("without a token there is nothing to search with", async () => {
    delete process.env.GITHUB_TOKEN;
    serve();
    expect(await searchGitHub("verc")).toEqual([]);
    expect(fake.calls).toHaveLength(0);
    expect(await searchGitHub("verc", { token: "visitor-token" })).toHaveLength(
      6,
    );
    expect(fake.calls[0]?.headers.get("authorization")).toBe(
      "Bearer visitor-token",
    );
  });

  test("a failing search throws", async () => {
    fake = fakeGitHub({ graphql: { SearchOwners: htmlTimeout() } });
    const error = await searchGitHub("verc").catch((e) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error.code).toBe("unavailable");
  });
});
