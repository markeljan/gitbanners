/**
 * Shapes of the GitHub responses we read, as zod schemas, and the one place
 * where untrusted JSON becomes typed data.
 *
 * Each schema lists only the fields `normalize.ts` uses and is lenient where
 * GitHub is: unset strings arrive as `null` or `""`, connection `nodes` may
 * hold `null` (a node the token may not see), and list items that do not look
 * like the selected type are dropped instead of failing the response.
 * Anything else that does not match means GitHub changed its contract, and
 * {@link decode} reports that as `unavailable` so a stale snapshot is served
 * rather than a half-understood payload.
 */
import { z } from "zod";
import { GitHubError } from "./errors";

const count = z.number().int().nonnegative();
/** Optional profile text: GitHub answers `null` or `""` when it is unset. */
const text = z.string().nullish();
const totalCount = z.object({ totalCount: count });

/** Connection `nodes`: `null` entries are tolerated, malformed ones dropped. */
function nodesOf<S extends z.ZodType>(node: S) {
  return z.object({ nodes: z.array(node.nullable().catch(null)).nullish() });
}

const RawLanguageSchema = z.object({
  name: z.string(),
  color: z.string().nullish(),
});

const RawLanguageBytesSchema = z.object({
  totalSize: count,
  edges: z
    .array(z.object({ size: count, node: RawLanguageSchema }).nullable())
    .nullish(),
});

const RawRepoCardSchema = z.object({
  name: z.string(),
  owner: z.object({ login: z.string() }),
  description: text,
  stargazerCount: count,
  forkCount: count,
  isPrivate: z.boolean(),
  visibility: z.string(),
  isFork: z.boolean(),
  isArchived: z.boolean(),
  primaryLanguage: RawLanguageSchema.nullish(),
  languages: RawLanguageBytesSchema.nullish(),
});

const RawCalendarSchema = z.object({
  totalContributions: count,
  weeks: z.array(
    z.object({
      contributionDays: z.array(
        z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          contributionCount: count,
          contributionLevel: z.string(),
        }),
      ),
    }),
  ),
});

const RawUserCoreSchema = z.object({
  __typename: z.literal("User"),
  login: z.string(),
  avatarUrl: z.string(),
  databaseId: z.number().int(),
  name: text,
  bio: text,
  company: text,
  location: text,
  websiteUrl: text,
  twitterUsername: text,
  pronouns: text,
  createdAt: z.string(),
  followers: totalCount,
  following: totalCount,
  publicRepos: totalCount,
  contributionsCollection: z.object({
    contributionYears: z.array(z.number().int()),
    contributionCalendar: RawCalendarSchema,
  }),
});

const RawOrgCoreSchema = z.object({
  __typename: z.literal("Organization"),
  login: z.string(),
  avatarUrl: z.string(),
  databaseId: z.number().int(),
  name: text,
  description: text,
  location: text,
  websiteUrl: text,
  twitterUsername: text,
  isVerified: z.boolean(),
  createdAt: z.string(),
  publicRepos: totalCount,
  topRepos: nodesOf(RawRepoCardSchema),
  pinnedItems: nodesOf(z.object({ nameWithOwner: z.string() })),
});

/** `data` of the `OWNER_CORE` document. */
export const OwnerCoreDataSchema = z.object({
  repositoryOwner: z
    .discriminatedUnion("__typename", [RawUserCoreSchema, RawOrgCoreSchema])
    .nullable(),
});

/** `data` of the `USER_EXTRAS` document. */
export const UserExtrasDataSchema = z.object({
  user: z
    .object({
      pinnedItems: nodesOf(RawRepoCardSchema),
      topRepos: nodesOf(RawRepoCardSchema),
    })
    .nullable(),
});

/** `data` of the `USER_TOTALS` document. */
export const UserTotalsDataSchema = z.object({
  user: z
    .object({
      contributionsCollection: z.object({
        totalCommitContributions: count,
        totalPullRequestContributions: count,
        totalIssueContributions: count,
        totalPullRequestReviewContributions: count,
        totalRepositoriesWithContributedCommits: count,
      }),
    })
    .nullable(),
});

/** `data` of the `USER_REPO_STATS` document. */
export const UserRepoStatsDataSchema = z.object({
  user: z
    .object({
      repositories: z.object({
        pageInfo: z.object({
          hasNextPage: z.boolean(),
          endCursor: z.string().nullish(),
        }),
        nodes: z
          .array(z.object({ stargazerCount: count }).nullable())
          .nullish(),
      }),
    })
    .nullable(),
});

/** `data` of the `USER_YEAR_REVIEW` document. */
export const UserYearReviewDataSchema = z.object({
  user: z
    .object({
      contributionsCollection: z.object({
        commitContributionsByRepository: z.array(
          z.object({
            repository: z.object({
              nameWithOwner: z.string(),
              isPrivate: z.boolean(),
              visibility: z.string(),
            }),
            contributions: totalCount,
          }),
        ),
      }),
      previous: z.object({
        contributionCalendar: z.object({ totalContributions: count }),
      }),
    })
    .nullable(),
});

/** `data` of the `ORG_EXTRAS` document. */
export const OrgExtrasDataSchema = z.object({
  organization: z
    .object({
      repositories: nodesOf(
        z.object({ stargazerCount: count, forkCount: count }),
      ),
      languageRepos: nodesOf(
        z.object({
          isPrivate: z.boolean(),
          visibility: z.string(),
          languages: RawLanguageBytesSchema.nullish(),
        }),
      ),
    })
    .nullable(),
});

/** `data` of the `REPO_CORE` document. */
export const RepoCoreDataSchema = z.object({
  repository: z
    .object({
      name: z.string(),
      nameWithOwner: z.string(),
      description: text,
      homepageUrl: text,
      stargazerCount: count,
      forkCount: count,
      watchers: totalCount,
      openIssues: totalCount,
      openPullRequests: totalCount,
      primaryLanguage: RawLanguageSchema.nullish(),
      languages: RawLanguageBytesSchema.nullish(),
      licenseInfo: z.object({ spdxId: text }).nullish(),
      repositoryTopics: nodesOf(
        z.object({ topic: z.object({ name: z.string() }) }),
      ),
      latestRelease: z
        .object({ name: text, tagName: z.string(), publishedAt: text })
        .nullish(),
      // `null` for an empty repository; `target` is `{}` if it is not a commit.
      defaultBranchRef: z
        .object({
          target: z.object({ history: totalCount.nullish() }).nullish(),
        })
        .nullish(),
      createdAt: z.string(),
      pushedAt: text,
      isArchived: z.boolean(),
      isFork: z.boolean(),
      isPrivate: z.boolean(),
      visibility: z.string(),
      owner: z.object({
        __typename: z.string(),
        login: z.string(),
        avatarUrl: z.string(),
      }),
    })
    .nullable(),
});

/** `data` of the `SEARCH_OWNERS` document. Non-account hits decode to `null`. */
export const SearchOwnersDataSchema = z.object({
  search: nodesOf(
    z.object({
      __typename: z.enum(["User", "Organization"]),
      login: z.string(),
      name: text,
      avatarUrl: z.string(),
    }),
  ),
});

/** `data` of the `SEARCH_REPOS` document. */
export const SearchReposDataSchema = z.object({
  search: nodesOf(
    z.object({
      nameWithOwner: z.string(),
      description: text,
      stargazerCount: count,
      isPrivate: z.boolean(),
      visibility: z.string(),
      owner: z.object({ avatarUrl: z.string() }),
    }),
  ),
});

/** `data` of the `STARGAZERS` document. */
export const StargazersDataSchema = z.object({
  repository: z
    .object({
      stargazerCount: count,
      stargazers: z.object({
        totalCount: count,
        pageInfo: z.object({
          hasNextPage: z.boolean(),
          endCursor: z.string().nullish(),
        }),
        edges: z
          .array(
            z
              .object({
                node: z.object({ databaseId: z.number().int().nullish() }),
              })
              .nullable(),
          )
          .nullish(),
      }),
    })
    .nullable(),
});

/**
 * REST account lists: `/users/{login}/orgs`, `/orgs/{org}/public_members`
 * and `/repos/{owner}/{repo}/contributors`. `type` and `contributions` are
 * only present on contributors.
 */
export const RestAccountsSchema = z.array(
  z
    .object({
      login: z.string(),
      avatar_url: z.string(),
      type: z.string().nullish(),
      contributions: count.nullish(),
    })
    .nullable()
    .catch(null),
);

/** REST `/repos/{owner}/{repo}/stats/commit_activity`. */
export const RestCommitActivitySchema = z.array(
  z.object({
    /** Unix seconds of the week's Sunday, 00:00 UTC. */
    week: z.number().int(),
    total: count,
    days: z.array(count).nullish(),
  }),
);

/** REST `/repos/{owner}/{repo}/stargazers/history`: new stars per week. */
export const RestStarHistorySchema = z.array(
  z.object({ week: z.number().int(), total: count }),
);

/** REST `/orgs/{org}`: only what GraphQL lacks (`followers`), plus the profile for the tokenless fallback. */
export const RestOrgSchema = z.object({
  login: z.string(),
  id: z.number().int(),
  avatar_url: z.string(),
  name: text,
  description: text,
  blog: text,
  location: text,
  twitter_username: text,
  is_verified: z.boolean().nullish(),
  public_repos: count.nullish(),
  followers: count.nullish(),
  created_at: z.string(),
});

/** REST `/users/{login}`: public profile of a user OR an organization. */
export const RestUserSchema = z.object({
  login: z.string(),
  id: z.number().int(),
  avatar_url: z.string(),
  type: z.string(),
  name: text,
  company: text,
  blog: text,
  location: text,
  bio: text,
  twitter_username: text,
  public_repos: count.nullish(),
  followers: count.nullish(),
  following: count.nullish(),
  created_at: z.string(),
});

/** A language as GitHub names it; `color` is missing for some. */
export type RawLanguage = z.infer<typeof RawLanguageSchema>;
/** Language bytes of one repository: the listed languages and the total. */
export type RawLanguageBytes = z.infer<typeof RawLanguageBytesSchema>;
/** A repository as selected by the `RepoCard` fragment. */
export type RawRepoCard = z.infer<typeof RawRepoCardSchema>;
/** The `User` branch of `OwnerCore`. */
export type RawUserCore = z.infer<typeof RawUserCoreSchema>;
/** The `Organization` branch of `OwnerCore`. */
export type RawOrgCore = z.infer<typeof RawOrgCoreSchema>;
/** `user` of `UserExtras`. */
export type RawUserExtras = NonNullable<
  z.infer<typeof UserExtrasDataSchema>["user"]
>;
/** `user.contributionsCollection` of `UserTotals`. */
export type RawUserTotals = NonNullable<
  z.infer<typeof UserTotalsDataSchema>["user"]
>["contributionsCollection"];
/** `user` of `UserYearReview`. */
export type RawYearReview = NonNullable<
  z.infer<typeof UserYearReviewDataSchema>["user"]
>;
/** `repository` of `RepoCore`. */
export type RawRepoCore = NonNullable<
  z.infer<typeof RepoCoreDataSchema>["repository"]
>;
/** `organization` of `OrgExtras`. */
export type RawOrgExtras = NonNullable<
  z.infer<typeof OrgExtrasDataSchema>["organization"]
>;
/** One account found by `SearchOwners`. */
export type RawOwnerHit = NonNullable<
  NonNullable<z.infer<typeof SearchOwnersDataSchema>["search"]["nodes"]>[number]
>;
/** One repository found by `SearchRepos`. */
export type RawRepoHit = NonNullable<
  NonNullable<z.infer<typeof SearchReposDataSchema>["search"]["nodes"]>[number]
>;
/** One row of a REST account list. */
export type RestAccount = NonNullable<
  z.infer<typeof RestAccountsSchema>[number]
>;
/** One week of REST commit activity. */
export type RestCommitWeek = z.infer<typeof RestCommitActivitySchema>[number];
/** One week of REST star history. */
export type RestStarWeek = z.infer<typeof RestStarHistorySchema>[number];
/** REST organization profile. */
export type RestOrg = z.infer<typeof RestOrgSchema>;
/** REST user (or organization) profile from `/users/{login}`. */
export type RestUser = z.infer<typeof RestUserSchema>;

/**
 * Validates an untrusted response body against `schema`.
 * @param what Short name of the response for the error message, e.g. "OwnerCore".
 * @throws GitHubError `unavailable` when the body has an unexpected shape.
 */
export function decode<S extends z.ZodType>(
  schema: S,
  value: unknown,
  what: string,
): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const [issue] = result.error.issues;
  const where = issue ? `${issue.path.join(".")}: ${issue.message}` : "";
  throw new GitHubError(
    "unavailable",
    `Unexpected ${what} response from GitHub (${where})`,
    { status: 502 },
  );
}
