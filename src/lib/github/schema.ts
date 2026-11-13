/**
 * Normalized GitHub data model.
 *
 * These zod schemas are the single source of truth for:
 *  - what the GitHub data layer returns (`src/lib/github`),
 *  - what the banner engine consumes (`src/lib/banner`),
 *  - the public JSON API response bodies and their OpenAPI schemas.
 *
 * Everything here is plain JSON (no Dates, no undefined-vs-null ambiguity:
 * absent optional values are `null`) so it can cross the server/client
 * boundary and be cached as-is.
 */
import { z } from "zod";

const isoDateTime = z
  .string()
  .describe("ISO 8601 timestamp, e.g. 2026-11-12T14:23:19Z");
const isoDate = z.string().describe("Calendar date as YYYY-MM-DD");
const count = z.number().int().nonnegative();

export const LanguageSchema = z
  .object({
    name: z.string(),
    color: z
      .string()
      .describe("Hex colour assigned by GitHub Linguist, e.g. #3178c6"),
  })
  .meta({ id: "Language" });

export const LanguageShareSchema = z
  .object({
    name: z.string(),
    color: z.string().describe("Hex colour assigned by GitHub Linguist"),
    percent: z
      .number()
      .min(0)
      .max(100)
      .describe("Share of bytes, 0-100 with one decimal"),
    bytes: count,
  })
  .meta({ id: "LanguageShare" });

export const RepoSummarySchema = z
  .object({
    owner: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    stars: count,
    forks: count,
    language: LanguageSchema.nullable(),
    isFork: z.boolean(),
    isArchived: z.boolean(),
    pinned: z
      .boolean()
      .describe("True when the owner pinned this repository on their profile"),
  })
  .meta({ id: "RepoSummary" });

export const ContributionDaySchema = z
  .object({
    date: isoDate,
    count,
    level: z
      .number()
      .int()
      .min(0)
      .max(4)
      .describe("Intensity bucket as shown on github.com: 0 = none, 4 = most"),
  })
  .meta({ id: "ContributionDay" });

export const CalendarSchema = z
  .object({
    total: count.describe("Total contributions in the covered range"),
    from: isoDate,
    to: isoDate,
    days: z
      .array(ContributionDaySchema)
      .describe("One entry per day, oldest first, no gaps"),
  })
  .meta({ id: "ContributionCalendar" });

export const StreakSchema = z
  .object({
    current: count.describe(
      "Consecutive days with contributions ending today or yesterday",
    ),
    currentStart: isoDate.nullable(),
    longest: count.describe(
      "Longest run of consecutive days within the calendar range",
    ),
    longestStart: isoDate.nullable(),
    longestEnd: isoDate.nullable(),
  })
  .meta({ id: "Streak" });

export const AvatarRefSchema = z
  .object({
    login: z.string(),
    avatarUrl: z.string(),
  })
  .meta({ id: "AvatarRef" });

export const UserStatsSchema = z
  .object({
    contributions: count.describe(
      "Contributions in the calendar range (last 12 months by default)",
    ),
    commits: count,
    pullRequests: count,
    issues: count,
    reviews: count,
    repositories: count.describe("Public repositories owned"),
    stars: count.describe("Stars received across owned, non-fork repositories"),
    contributedTo: count.describe(
      "Repositories contributed to in the calendar range",
    ),
  })
  .meta({ id: "UserStats" });

export const UserSchema = z
  .object({
    kind: z.literal("user"),
    login: z.string(),
    id: z.number().int(),
    name: z.string().nullable(),
    avatarUrl: z.string(),
    bio: z.string().nullable(),
    company: z.string().nullable(),
    location: z.string().nullable(),
    websiteUrl: z.string().nullable(),
    twitter: z.string().nullable(),
    pronouns: z.string().nullable(),
    createdAt: isoDateTime,
    followers: count,
    following: count,
    stats: UserStatsSchema,
    calendar: CalendarSchema,
    streak: StreakSchema,
    bestDay: ContributionDaySchema.nullable().describe(
      "Busiest day in the calendar range",
    ),
    years: z
      .array(z.number().int())
      .describe("Years with contributions, newest first"),
    repos: z
      .array(RepoSummarySchema)
      .describe(
        "Pinned repositories first, then top owned repositories by stars (max 6)",
      ),
    languages: z
      .array(LanguageShareSchema)
      .describe("Top languages by bytes (max 8)"),
    organizations: z
      .array(AvatarRefSchema)
      .describe("Public organization memberships (max 8)"),
    includesPrivate: z
      .boolean()
      .describe(
        "True when private contribution counts are included (owner-connected banners only)",
      ),
    fetchedAt: isoDateTime,
  })
  .meta({ id: "User" });

export const OrgStatsSchema = z
  .object({
    repositories: count.describe("Public repositories"),
    stars: count.describe(
      "Stars across the organization's top public repositories",
    ),
    forks: count,
    members: count
      .nullable()
      .describe("Public member count, null when not visible"),
    followers: count.nullable(),
  })
  .meta({ id: "OrgStats" });

export const OrgSchema = z
  .object({
    kind: z.literal("org"),
    login: z.string(),
    id: z.number().int(),
    name: z.string().nullable(),
    avatarUrl: z.string(),
    description: z.string().nullable(),
    location: z.string().nullable(),
    websiteUrl: z.string().nullable(),
    twitter: z.string().nullable(),
    isVerified: z.boolean(),
    createdAt: isoDateTime,
    stats: OrgStatsSchema,
    repos: z
      .array(RepoSummarySchema)
      .describe("Top public repositories by stars (max 6)"),
    languages: z
      .array(LanguageShareSchema)
      .describe("Top languages across top repositories"),
    people: z.array(AvatarRefSchema).describe("Public members (max 24)"),
    fetchedAt: isoDateTime,
  })
  .meta({ id: "Organization" });

export const RepoActivityWeekSchema = z
  .object({
    week: isoDate.describe("First day (Sunday) of the week"),
    commits: count,
  })
  .meta({ id: "RepoActivityWeek" });

export const ContributorSchema = z
  .object({
    login: z.string(),
    avatarUrl: z.string(),
    contributions: count,
  })
  .meta({ id: "Contributor" });

export const RepoSchema = z
  .object({
    kind: z.literal("repo"),
    owner: z.object({
      login: z.string(),
      avatarUrl: z.string(),
      kind: z.enum(["user", "org"]),
    }),
    name: z.string(),
    fullName: z.string().describe("owner/name"),
    description: z.string().nullable(),
    homepageUrl: z.string().nullable(),
    stars: count,
    forks: count,
    watchers: count,
    openIssues: count,
    openPullRequests: count,
    language: LanguageSchema.nullable(),
    languages: z.array(LanguageShareSchema),
    license: z.string().nullable().describe("SPDX identifier, e.g. MIT"),
    topics: z.array(z.string()),
    createdAt: isoDateTime,
    pushedAt: isoDateTime.nullable(),
    isArchived: z.boolean(),
    isFork: z.boolean(),
    latestRelease: z
      .object({
        tag: z.string(),
        name: z.string().nullable(),
        publishedAt: isoDateTime.nullable(),
      })
      .nullable(),
    commits: count
      .nullable()
      .describe("Commits on the default branch, null when unknown"),
    activity: z
      .object({
        total: count.describe("Commits in the covered weeks"),
        weeks: z
          .array(RepoActivityWeekSchema)
          .describe("Up to 52 weeks, oldest first"),
      })
      .nullable()
      .describe(
        "Weekly commit activity, null while GitHub is still computing it",
      ),
    contributors: z
      .array(ContributorSchema)
      .describe("Top contributors by commits (max 30)"),
    contributorCount: count
      .nullable()
      .describe("Total contributors, null when unknown"),
    fetchedAt: isoDateTime,
  })
  .meta({ id: "Repository" });

export const OwnerSchema = z.discriminatedUnion("kind", [
  UserSchema,
  OrgSchema,
]);
export const EntitySchema = z.discriminatedUnion("kind", [
  UserSchema,
  OrgSchema,
  RepoSchema,
]);

export const OwnerSuggestionSchema = z
  .object({
    kind: z.enum(["user", "org", "repo"]),
    /** `login` for users/orgs, `owner/name` for repositories. */
    slug: z.string(),
    title: z
      .string()
      .nullable()
      .describe("Display name or repository description"),
    avatarUrl: z.string(),
    stars: count.nullable(),
  })
  .meta({ id: "Suggestion" });

export type Language = z.infer<typeof LanguageSchema>;
export type LanguageShare = z.infer<typeof LanguageShareSchema>;
export type RepoSummary = z.infer<typeof RepoSummarySchema>;
export type ContributionDay = z.infer<typeof ContributionDaySchema>;
export type Calendar = z.infer<typeof CalendarSchema>;
export type Streak = z.infer<typeof StreakSchema>;
export type AvatarRef = z.infer<typeof AvatarRefSchema>;
export type UserStats = z.infer<typeof UserStatsSchema>;
export type User = z.infer<typeof UserSchema>;
export type OrgStats = z.infer<typeof OrgStatsSchema>;
export type Org = z.infer<typeof OrgSchema>;
export type RepoActivityWeek = z.infer<typeof RepoActivityWeekSchema>;
export type Contributor = z.infer<typeof ContributorSchema>;
export type Repo = z.infer<typeof RepoSchema>;
export type Owner = z.infer<typeof OwnerSchema>;
export type Entity = z.infer<typeof EntitySchema>;
export type Suggestion = z.infer<typeof OwnerSuggestionSchema>;

/** GitHub login / organization name: 1-39 chars, alphanumeric or single hyphens, no leading/trailing hyphen. */
export const LOGIN_RE = /^[a-zA-Z\d](?:[a-zA-Z\d]|-(?=[a-zA-Z\d])){0,38}$/;
/** Repository name: 1-100 chars of letters, digits, ".", "-", "_" (not "." or ".."). */
export const REPO_NAME_RE = /^(?!\.{1,2}$)[\w.-]{1,100}$/;

export function isValidLogin(value: string): boolean {
  return LOGIN_RE.test(value);
}

export function isValidRepoName(value: string): boolean {
  return REPO_NAME_RE.test(value);
}
