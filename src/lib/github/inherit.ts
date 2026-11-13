/**
 * What a refreshed entity keeps from the snapshot it replaces.
 *
 * A refresh makes several upstream requests, and the optional ones (a
 * user's totals, a repository's weekly statistics) fail on their own: REST
 * runs out of quota before GraphQL does, and GitHub answers 202 while it
 * recomputes statistics. The entity then arrives with holes. Stored as it
 * is, it would replace a complete snapshot, and a partial failure would
 * show less than a total one (which serves the old snapshot whole).
 *
 * Only holes are filled, and only where a hole means "this request failed"
 * rather than "there is nothing": a fresh value always wins.
 */
import type { Org, Owner, Repo, User } from "./schema";

function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function inheritUser(loaded: User, previous: User): User {
  // `complete` is the fetcher saying every optional request succeeded.
  // Carry over only from a snapshot that was itself complete, so a hole is
  // never filled with another refresh's leftovers.
  if (loaded.complete || !previous.complete) return loaded;
  const { stats } = loaded;
  const kept = previous.stats;
  return {
    ...loaded,
    stats: {
      ...stats,
      commits: stats.commits ?? kept.commits,
      pullRequests: stats.pullRequests ?? kept.pullRequests,
      issues: stats.issues ?? kept.issues,
      reviews: stats.reviews ?? kept.reviews,
      contributedTo: stats.contributedTo ?? kept.contributedTo,
      stars: stats.stars ?? kept.stars,
    },
    repos: loaded.repos.length > 0 ? loaded.repos : previous.repos,
    languages:
      loaded.languages.length > 0 ? loaded.languages : previous.languages,
    organizations:
      loaded.organizations.length > 0
        ? loaded.organizations
        : previous.organizations,
    wrapped:
      loaded.wrapped &&
      previous.wrapped &&
      loaded.wrapped.year === previous.wrapped.year &&
      loaded.wrapped.topRepos.length === 0 &&
      loaded.wrapped.previousTotal === null
        ? previous.wrapped
        : loaded.wrapped,
    // Still incomplete: the carried-over parts are one refresh behind.
  };
}

function inheritOrg(loaded: Org, previous: Org): Org {
  // A missing chart is the only hole an organization can be known to have.
  if (loaded.activity !== null || previous.activity === null) return loaded;
  return { ...loaded, activity: previous.activity };
}

/** For `getOwner`: a user keeps totals and lists, an organization its chart. */
export function inheritOwner(loaded: Owner, previous: Owner): Owner {
  if (loaded.kind !== previous.kind) return loaded;
  if (!sameLogin(loaded.login, previous.login)) return loaded;
  if (loaded.kind === "user" && previous.kind === "user") {
    return inheritUser(loaded, previous);
  }
  if (loaded.kind === "org" && previous.kind === "org") {
    return inheritOrg(loaded, previous);
  }
  return loaded;
}

/**
 * For `getRepo`: the weekly chart, the star history and the contributor
 * list each come from their own REST request and are kept when that request
 * came back empty-handed.
 */
export function inheritRepo(loaded: Repo, previous: Repo): Repo {
  // A renamed or transferred repository starts over.
  if (loaded.fullName.toLowerCase() !== previous.fullName.toLowerCase()) {
    return loaded;
  }
  const lostContributors =
    loaded.contributorCount === null &&
    loaded.contributors.length === 0 &&
    previous.contributors.length > 0;
  const activity = loaded.activity ?? previous.activity;
  const starHistory = loaded.starHistory ?? previous.starHistory;
  if (
    activity === loaded.activity &&
    starHistory === loaded.starHistory &&
    !lostContributors
  ) {
    return loaded;
  }
  return {
    ...loaded,
    activity,
    starHistory,
    contributors: lostContributors
      ? previous.contributors
      : loaded.contributors,
    contributorCount: lostContributors
      ? previous.contributorCount
      : loaded.contributorCount,
  };
}
