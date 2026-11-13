/**
 * GraphQL documents, one per round trip. Every document costs 1 rate-limit
 * point, and the matching response shapes live in `raw.ts`.
 *
 * Public-only by construction, so the result is the same whoever owns the
 * token (including a developer's own token, or a signed-in user's):
 * - every `repositories` connection says `privacy: PUBLIC`,
 * - every repository node carries `isPrivate` + `visibility` and is dropped
 *   in `normalize.ts` unless it is public (pinned items and per-repository
 *   contributions have no privacy argument),
 * - every search says `is:public`,
 * - `email` is never selected (it also fails the whole query without the
 *   `read:user` scope),
 * - `user.organizations` and `organization.membersWithRole` are never
 *   selected: both include private memberships when the token can see them.
 *   Public memberships come from REST, which is public-only by contract.
 *
 * Latency notes that shaped these documents (GitHub-side, measured):
 * resolvers run serially, so a document costs roughly the sum of its fields.
 * Inside `contributionsCollection` the calendar is fast, while any
 * `total*Contributions` field switches to a slow collector (+350 to 900 ms).
 * That is why the calendar and the totals are separate documents.
 */

const LANGUAGE_BYTES = /* GraphQL */ `
  languages(first: 8, orderBy: { field: SIZE, direction: DESC }) {
    totalSize
    edges { size node { name color } }
  }`;

const REPO_CARD_FRAGMENT = /* GraphQL */ `
fragment RepoCard on Repository {
  name
  owner { login }
  description
  stargazerCount
  forkCount
  isPrivate
  visibility
  isFork
  isArchived
  primaryLanguage { name color }
}`;

/**
 * The single round trip for `/{owner}`: tells a user from an organization and
 * returns the fast-path data for either. `repositoryOwner` is `null` WITHOUT
 * an error for an unknown login. Omit `$from`/`$to` for the last 12 months
 * (starting on the Sunday on or before one year ago, UTC).
 */
export const OWNER_CORE = /* GraphQL */ `
query OwnerCore($login: String!, $from: DateTime, $to: DateTime) {
  repositoryOwner(login: $login) {
    __typename
    login
    avatarUrl(size: 256)
    ... on User {
      databaseId
      name
      bio
      company
      location
      websiteUrl
      twitterUsername
      pronouns
      createdAt
      followers { totalCount }
      following { totalCount }
      publicRepos: repositories(ownerAffiliations: OWNER, privacy: PUBLIC) { totalCount }
      contributionsCollection(from: $from, to: $to) {
        contributionYears
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount contributionLevel } }
        }
      }
    }
    ... on Organization {
      databaseId
      name
      description
      location
      websiteUrl
      twitterUsername
      isVerified
      createdAt
      publicRepos: repositories(privacy: PUBLIC) { totalCount }
      topRepos: repositories(first: 6, privacy: PUBLIC, isFork: false, orderBy: { field: STARGAZERS, direction: DESC }) {
        nodes { ...RepoCard }
      }
      pinnedItems(first: 6, types: [REPOSITORY]) {
        nodes { ... on Repository { nameWithOwner } }
      }
    }
  }
}
${REPO_CARD_FRAGMENT}`;

/**
 * Repositories for a user banner: pinned items (any owner) and the top owned
 * ones by stars, the latter with language bytes for the language mix.
 */
export const USER_EXTRAS = /* GraphQL */ `
query UserExtras($login: String!) {
  user(login: $login) {
    pinnedItems(first: 6, types: [REPOSITORY]) {
      nodes { ... on Repository { ...RepoCard } }
    }
    topRepos: repositories(first: 6, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, orderBy: { field: STARGAZERS, direction: DESC }) {
      nodes { ...RepoCard ${LANGUAGE_BYTES} }
    }
  }
}
${REPO_CARD_FRAGMENT}`;

/**
 * Slow path: contribution-type totals for the same window as the calendar.
 * Asking for one of these fields costs the same as asking for all of them.
 */
export const USER_TOTALS = /* GraphQL */ `
query UserTotals($login: String!, $from: DateTime, $to: DateTime) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      totalPullRequestReviewContributions
      totalRepositoriesWithContributedCommits
    }
  }
}`;

/**
 * One page of a user's owned public non-fork repositories, most-starred
 * first, for the star total. There is no aggregate: page with `$after` while
 * `hasNextPage` and the last node still has stars.
 */
export const USER_REPO_STATS = /* GraphQL */ `
query UserRepoStats($login: String!, $after: String) {
  user(login: $login) {
    repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, orderBy: { field: STARGAZERS, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { stargazerCount }
    }
  }
}`;

/**
 * Year-in-review extras: commits per repository in the requested year and the
 * previous year's contribution total. More repositories than the five we keep
 * are requested because non-public ones are dropped afterwards.
 */
export const USER_YEAR_REVIEW = /* GraphQL */ `
query UserYearReview($login: String!, $from: DateTime!, $to: DateTime!, $previousFrom: DateTime!, $previousTo: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      commitContributionsByRepository(maxRepositories: 10) {
        repository { nameWithOwner isPrivate visibility }
        contributions { totalCount }
      }
    }
    previous: contributionsCollection(from: $previousFrom, to: $previousTo) {
      contributionCalendar { totalContributions }
    }
  }
}`;

/**
 * What an organization banner needs beyond `OwnerCore`: star and fork totals
 * over its 100 most-starred public non-fork repositories, and language bytes
 * of the top 6. Kept out of `OwnerCore` because the language bytes alone add
 * up to 0.4 s, which would delay telling a user from an organization.
 */
export const ORG_EXTRAS = /* GraphQL */ `
query OrgExtras($login: String!) {
  organization(login: $login) {
    repositories(first: 100, privacy: PUBLIC, isFork: false, orderBy: { field: STARGAZERS, direction: DESC }) {
      nodes { stargazerCount forkCount }
    }
    languageRepos: repositories(first: 6, privacy: PUBLIC, isFork: false, orderBy: { field: STARGAZERS, direction: DESC }) {
      nodes { isPrivate visibility ${LANGUAGE_BYTES} }
    }
  }
}`;

/**
 * Everything a repository banner needs except contributors, weekly activity
 * and star history (REST). Renames and transfers are followed silently, so
 * `nameWithOwner` is the canonical name. Do NOT add `releases { totalCount }`
 * or `forks { totalCount }`: 1 to 4 s each on large repositories.
 */
export const REPO_CORE = /* GraphQL */ `
query RepoCore($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    name
    nameWithOwner
    description
    homepageUrl
    stargazerCount
    forkCount
    watchers { totalCount }
    openIssues: issues(states: OPEN) { totalCount }
    openPullRequests: pullRequests(states: OPEN) { totalCount }
    primaryLanguage { name color }
    ${LANGUAGE_BYTES}
    licenseInfo { spdxId }
    repositoryTopics(first: 8) { nodes { topic { name } } }
    latestRelease { name tagName publishedAt }
    defaultBranchRef { target { ... on Commit { history { totalCount } } } }
    createdAt
    pushedAt
    isArchived
    isFork
    isPrivate
    visibility
    owner { __typename login avatarUrl(size: 128) }
  }
}`;

/** Typeahead for owners. `type: USER` returns users AND organizations. */
export const SEARCH_OWNERS = /* GraphQL */ `
query SearchOwners($query: String!) {
  search(type: USER, query: $query, first: 6) {
    nodes {
      __typename
      ... on User { login name avatarUrl(size: 64) }
      ... on Organization { login name avatarUrl(size: 64) }
    }
  }
}`;

/** Typeahead for repositories. The query string must contain `is:public`. */
export const SEARCH_REPOS = /* GraphQL */ `
query SearchRepos($query: String!) {
  search(type: REPOSITORY, query: $query, first: 6) {
    nodes {
      ... on Repository {
        nameWithOwner
        description
        stargazerCount
        isPrivate
        visibility
        owner { avatarUrl(size: 64) }
      }
    }
  }
}`;

/**
 * One page of a repository's stargazers, newest first. Only a token that
 * administers (or collaborates on) the repository sees the list: everyone
 * else gets `totalCount: 0` and no edges while `stargazerCount` is non-zero.
 */
export const STARGAZERS = /* GraphQL */ `
query Stargazers($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    stargazerCount
    stargazers(first: 100, after: $after, orderBy: { field: STARRED_AT, direction: DESC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      edges { node { databaseId } }
    }
  }
}`;
