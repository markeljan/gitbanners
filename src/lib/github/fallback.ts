/**
 * Tokenless degradation, used only when no GitHub token is available.
 *
 * GraphQL has no anonymous access, so an owner is assembled from two public
 * sources instead:
 * - the unauthenticated REST profile (`GET /users/{login}`, 60 requests per
 *   hour and IP: on shared serverless IPs assume that budget is small), and
 * - the HTML fragment github.com itself loads for the contribution graph
 *   (`https://github.com/users/{login}/contributions`), which needs no API
 *   quota and matches the GraphQL calendar day for day under UTC.
 *
 * The result is always fast-path only (`complete: false` for users; identity
 * and counts for organizations). The HTML is unversioned markup: every parse
 * step is defensive and any drift yields "no calendar" instead of an error.
 */
import { calendarFromDays, isValidYear, utcDate } from "./calendar";
import { rest, withDeadline } from "./client";
import { GitHubError, isGitHubError } from "./errors";
import { toOrgFromRest, toUserFromRest } from "./normalize";
import { decode, RestOrgSchema, type RestUser, RestUserSchema } from "./raw";
import {
  type Calendar,
  type ContributionDay,
  isValidLogin,
  type Org,
  type Owner,
} from "./schema";

/** Deadline for the github.com fragment (233 KB, usually 50 to 450 ms). */
const HTML_TIMEOUT_MS = 8_000;
const DAY_ID_PREFIX = "contribution-day-component-";

/** What could be read from the contributions fragment. */
export interface PublicContributions {
  /** Total from the heading ("4,015 contributions in the last year"). */
  total: number | null;
  /** One entry per calendar cell, oldest first. */
  days: ContributionDay[];
}

/** Options of the tokenless fetchers. */
export interface PublicFetchOptions {
  /** Calendar year instead of the last 12 months. */
  year?: number | null;
  /** Clock override for deterministic tests. */
  now?: Date;
  signal?: AbortSignal;
}

/** Value of attribute `name` in the attribute part of a start tag. */
function attribute(attributes: string, name: string): string | null {
  // Anchored on whitespace so `id` cannot match inside `data-id`.
  return (
    attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1] ?? null
  );
}

function parseCount(text: string): number | null {
  // "3 contributions on November 9th." | "1 contribution on ..." | "No contributions on ..."
  const amount = text.trim().match(/^(No|[\d,]+) contributions?\b/)?.[1];
  if (amount === undefined) return null;
  return amount === "No" ? 0 : Number(amount.replace(/,/g, ""));
}

/**
 * Parses the contributions fragment, or returns `null` when it does not look
 * like the markup this was written against.
 *
 * Facts about that markup this relies on (verified against GraphQL):
 * - cells are `<td class="ContributionCalendar-day" data-date data-level id>`,
 *   emitted row by row (all Sundays first), so they are sorted here;
 * - the count exists only in a `<tool-tip for="{cell id}">` text node;
 * - the legend reuses the cell class on `<div>`s without `data-date`.
 *
 * Drift checks: every cell needs a valid date, a level of 0-4 and a tooltip,
 * and a cell is empty exactly when its level is 0. One violation rejects the
 * whole fragment, because a half-understood calendar would draw wrong data.
 */
export function parseContributionsHtml(
  html: string,
): PublicContributions | null {
  const counts = new Map<string, number>();
  for (const match of html.matchAll(
    /<tool-tip\b([^>]*)>([^<]*)<\/tool-tip>/g,
  )) {
    const id = attribute(match[1] ?? "", "for");
    if (!id?.startsWith(DAY_ID_PREFIX)) continue;
    const count = parseCount(match[2] ?? "");
    if (count === null) return null;
    counts.set(id, count);
  }

  const days: ContributionDay[] = [];
  for (const match of html.matchAll(
    /<td\b([^>]*\bclass="[^"]*\bContributionCalendar-day\b[^"]*"[^>]*)>/g,
  )) {
    const tag = match[1] ?? "";
    const date = attribute(tag, "data-date");
    const id = attribute(tag, "id");
    const level = Number(attribute(tag, "data-level"));
    const count = id === null ? undefined : counts.get(id);
    if (
      date === null ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      count === undefined ||
      !Number.isInteger(level) ||
      level < 0 ||
      level > 4 ||
      (level === 0) !== (count === 0)
    ) {
      return null;
    }
    days.push({ date, count, level });
  }
  if (days.length === 0) return null;
  days.sort((a, b) => (a.date < b.date ? -1 : 1));

  const heading = html
    .match(
      /<h2[^>]*id="js-contribution-activity-description"[^>]*>([\s\S]*?)<\/h2>/,
    )?.[1]
    ?.replace(/\s+/g, " ")
    .trim();
  const headingTotal = heading?.match(/^([\d,]+) contributions?\b/)?.[1];
  return {
    total:
      headingTotal === undefined
        ? null
        : Number(headingTotal.replace(/,/g, "")),
    days,
  };
}

/**
 * The public contribution calendar of a user without any token.
 *
 * @returns `null` whenever no calendar can be had: unknown login or an
 *   organization (both 404), hidden accounts such as `ghost` (an empty
 *   wrapper), throttling, network failure, or changed markup. Never throws.
 */
export async function fetchPublicCalendar(
  login: string,
  opts: PublicFetchOptions = {},
): Promise<Calendar | null> {
  if (!isValidLogin(login)) return null;
  const now = opts.now ?? new Date();
  const { year } = opts;
  if (year != null && !isValidYear(year, now)) return null;
  // The endpoint only understands whole calendar years.
  const query = year == null ? "" : `?from=${year}-01-01&to=${year}-12-31`;
  let html: string;
  try {
    const response = await fetch(
      `https://github.com/users/${encodeURIComponent(login)}/contributions${query}`,
      {
        // No Authorization header, ever: this is the public website.
        headers: { Accept: "text/html", "User-Agent": "gitbanners" },
        signal: withDeadline(opts.signal, HTML_TIMEOUT_MS),
        cache: "no-store",
      },
    );
    if (response.status !== 200) {
      // An organization's 404 is a full 220 KB page: do not download it.
      await response.body?.cancel();
      return null;
    }
    html = await response.text();
  } catch {
    return null;
  }
  const parsed = parseContributionsHtml(html);
  if (!parsed) return null;
  return calendarFromDays(parsed.days, utcDate(now), parsed.total ?? undefined);
}

/** Every failure of this path means the same to callers: try again later. */
function unavailable(cause: unknown): GitHubError {
  if (isGitHubError(cause) && cause.code === "unavailable") return cause;
  return new GitHubError(
    "unavailable",
    "GitHub data is unavailable without a token right now",
    {
      retryAfter: isGitHubError(cause) ? cause.retryAfter : null,
      cause,
    },
  );
}

async function fetchPublicOrg(
  profile: RestUser,
  now: Date,
  signal: AbortSignal,
): Promise<Org> {
  // `/users/{org}` lacks `is_verified`; the org endpoint has it. Best effort:
  // the second request may not fit the anonymous budget.
  const full = await rest(`/orgs/${encodeURIComponent(profile.login)}`, {
    signal,
  }).then(
    (response) =>
      response.data === null
        ? null
        : decode(RestOrgSchema, response.data, "organization profile"),
    () => null,
  );
  return toOrgFromRest(
    full ?? {
      login: profile.login,
      id: profile.id,
      avatar_url: profile.avatar_url,
      name: profile.name,
      // For an organization the user endpoint reports the description as `bio`.
      description: profile.bio,
      blog: profile.blog,
      location: profile.location,
      twitter_username: profile.twitter_username,
      public_repos: profile.public_repos,
      followers: profile.followers,
      created_at: profile.created_at,
    },
    { now },
  );
}

/**
 * A user or organization from public, tokenless sources only.
 *
 * @returns `null` for an unknown or malformed login.
 * @throws GitHubError `unavailable` when the profile cannot be fetched (the
 *   anonymous REST budget is exhausted, GitHub is down), whatever the cause;
 *   `invalid` for a year outside 2008..current year.
 */
export async function fetchPublicOwner(
  login: string,
  opts: PublicFetchOptions = {},
): Promise<Owner | null> {
  if (!isValidLogin(login)) return null;
  const now = opts.now ?? new Date();
  const year = opts.year ?? null;
  if (year !== null && !isValidYear(year, now)) {
    throw new GitHubError("invalid", `year ${year} is out of range`);
  }
  // One deadline for the whole fetch, see `withDeadline`.
  const signal = withDeadline(opts.signal);
  try {
    // The calendar request is free (no API quota) and 404s for anything that
    // is not a user, so it runs alongside the profile instead of after it.
    const [response, calendar] = await Promise.all([
      rest(`/users/${encodeURIComponent(login)}`, { signal }),
      fetchPublicCalendar(login, { year, now, signal }),
    ]);
    if (response.data === null) return null;
    const profile = decode(RestUserSchema, response.data, "user profile");
    if (profile.type === "Organization") {
      return await fetchPublicOrg(profile, now, signal);
    }
    return toUserFromRest(profile, calendar, { now, year });
  } catch (cause) {
    throw unavailable(cause);
  }
}
