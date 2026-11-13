"use no memo";

import {
  addDays,
  daysBetween,
  parseIsoDate,
  toIsoDate,
  weekdayOf,
} from "@/lib/banner/format";
import type { EntityKind } from "@/lib/banner/types";
import type {
  AvatarRef,
  Calendar,
  CommitActivity,
  ContributionDay,
  Entity,
  LanguageShare,
  Org,
  Repo,
  RepoSummary,
  Streak,
  User,
  YearInReview,
} from "@/lib/github/schema";

/**
 * Synthetic entities for skeletons, documentation and tests.
 *
 * Everything is derived from fixed seeds, so the same call always returns the
 * same data and nothing touches the network (avatars are inline SVG data
 * URIs). Names are obviously fictional on purpose: a demo banner must never
 * be mistaken for a real account.
 */

/** The demo calendar ends here: the Friday the fixtures were written. */
const DEMO_TODAY = "2026-11-13";
/** GitHub starts "the last year" on the Sunday of the week one year back. */
const DEMO_FROM = "2025-11-09";
const FETCHED_AT = `${DEMO_TODAY}T12:00:00Z`;

/** Small, fast, well-distributed PRNG (mulberry32). */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

/**
 * A GitHub-style identicon: a 5x5 pattern mirrored around its middle column,
 * in one colour picked from the seed. Returned as a data URI so it renders
 * with no network in every engine.
 */
export function identicon(seed: string): string {
  const next = prng(hash(seed));
  const hue = Math.floor(next() * 360);
  const cells: string[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      if (next() < 0.5) continue;
      cells.push(`M${col + 1} ${row + 1}h1v1h-1z`);
      if (col < 2) cells.push(`M${5 - col} ${row + 1}h1v1h-1z`);
    }
  }
  // A blank pattern would read as a broken image: always light the centre.
  if (cells.length === 0) cells.push("M3 3h1v1h-1z");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7 7" shape-rendering="crispEdges"><rect width="7" height="7" fill="#f0f0f0"/><path fill="hsl(${hue} 52% 54%)" d="${cells.join("")}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const WEEKDAY_ACTIVITY = [0.2, 0.92, 1, 1, 0.95, 0.8, 0.28] as const;

/** Quiet stretches (day offsets): the winter holidays and two weeks in August. */
function isHoliday(offset: number): boolean {
  return (offset >= 44 && offset <= 55) || (offset >= 264 && offset <= 276);
}

/** A span of days to make a calendar for. */
interface DemoRange {
  from: string;
  to: string;
  seed: number;
  /** The range ends "today": its last days are a streak that is still running. */
  live: boolean;
}

/** GitHub's default view: the last year of activity, up to the demo's today. */
const LAST_YEAR: DemoRange = {
  from: DEMO_FROM,
  to: DEMO_TODAY,
  seed: 20261113,
  live: true,
};

/** The range of a calendar year: all of it, or up to the demo's today for the current one. */
function yearRange(year: number): DemoRange {
  const today = parseIsoDate(DEMO_TODAY);
  const current = today !== null && year === today.year;
  return {
    from: `${year}-01-01`,
    to: current ? DEMO_TODAY : `${year}-12-31`,
    seed: 20261113 + year,
    live: current,
  };
}

function demoCalendar(range: DemoRange = LAST_YEAR): Calendar {
  const next = prng(range.seed);
  const start = parseIsoDate(range.from);
  const end = parseIsoDate(range.to);
  if (!start || !end || daysBetween(start, end) < 0) {
    return { total: 0, from: range.from, to: range.to, days: [] };
  }
  const length = daysBetween(start, end) + 1;
  const firstWeekday = weekdayOf(start);

  const counts: number[] = [];
  let week = 1;
  for (let offset = 0; offset < length; offset++) {
    const weekday = (firstWeekday + offset) % 7;
    // Every week has its own pace: some are slow, a few are release weeks.
    if (weekday === 0 || offset === 0) {
      week = 0.35 + next() * 1.1 + (next() < 0.14 ? 1.2 : 0);
    }
    const season = 0.8 + 0.3 * Math.sin((offset / length) * Math.PI * 3.2);
    const activity = WEEKDAY_ACTIVITY[weekday] * season;
    const roll = next();
    const size = next();
    let count = 0;
    if (
      !isHoliday(offset) &&
      roll < Math.min(0.97, activity * (0.6 + week * 0.3))
    ) {
      count =
        1 + Math.floor(-Math.log(1 - size * 0.999) * 13 * activity * week);
    }
    // A long spring run and a live streak make the streak banner worth looking at.
    const inRun = offset >= 150 && offset <= 187;
    const inLiveStreak = range.live && offset >= length - 17;
    if ((inRun || inLiveStreak) && count === 0)
      count = 1 + Math.floor(size * 5);
    counts.push(count);
  }

  // Levels the way a real profile reads: about half of the active days are
  // the darkest green and only the best tenth is the brightest.
  const active = counts.filter((count) => count > 0).sort((a, b) => a - b);
  const cut = (share: number) =>
    active[Math.min(active.length - 1, Math.floor(active.length * share))] ?? 0;
  const [low, mid, high] = [cut(0.48), cut(0.76), cut(0.91)];
  const level = (count: number) =>
    count === 0
      ? 0
      : count <= low
        ? 1
        : count <= mid
          ? 2
          : count <= high
            ? 3
            : 4;

  const days: ContributionDay[] = counts.map((count, offset) => ({
    date: toIsoDate(addDays(start, offset)),
    count,
    level: level(count),
  }));
  return {
    total: counts.reduce((sum, count) => sum + count, 0),
    from: range.from,
    to: range.to,
    days,
  };
}

/** Current and longest run of active days, the way the data layer reports them. */
function streakOf(days: readonly ContributionDay[]): Streak {
  let longest = 0;
  let longestEnd = -1;
  let run = 0;
  days.forEach((day, index) => {
    run = day.count > 0 ? run + 1 : 0;
    if (run > longest) {
      longest = run;
      longestEnd = index;
    }
  });
  // "Current" may end today or yesterday: an empty today does not break it yet.
  let last = days.length - 1;
  if (last >= 0 && days[last].count === 0) last -= 1;
  let current = 0;
  while (last - current >= 0 && days[last - current].count > 0) current += 1;
  return {
    current,
    currentStart: current > 0 ? days[last - current + 1].date : null,
    longest,
    longestStart: longest > 0 ? days[longestEnd - longest + 1].date : null,
    longestEnd: longest > 0 ? days[longestEnd].date : null,
  };
}

const LANGUAGES: readonly LanguageShare[] = [
  { name: "TypeScript", color: "#3178c6", percent: 46.2, bytes: 4_812_400 },
  { name: "Rust", color: "#dea584", percent: 21.4, bytes: 2_229_100 },
  { name: "Go", color: "#00add8", percent: 12.7, bytes: 1_322_900 },
  { name: "Python", color: "#3572a5", percent: 9.8, bytes: 1_020_800 },
  { name: "Swift", color: "#f05138", percent: 5.6, bytes: 583_300 },
  { name: "Shell", color: "#89e051", percent: 4.3, bytes: 447_900 },
];

function summary(
  owner: string,
  name: string,
  description: string,
  language: LanguageShare,
  stars: number,
  forks: number,
  pinned: boolean,
): RepoSummary {
  return {
    owner,
    name,
    description,
    stars,
    forks,
    language: { name: language.name, color: language.color },
    isFork: false,
    isArchived: false,
    pinned,
  };
}

function demoRepos(owner: string): RepoSummary[] {
  const [ts, rust, go, python, swift, shell] = LANGUAGES;
  return [
    summary(
      owner,
      "rocket",
      "A fast, friendly build tool for the modern web.",
      ts,
      18_432,
      912,
      true,
    ),
    summary(
      owner,
      "paper-lantern",
      "Tiny terminal UI toolkit with zero dependencies.",
      rust,
      6204,
      301,
      true,
    ),
    summary(
      owner,
      "tide",
      "Background jobs that survive restarts, for Postgres.",
      go,
      2877,
      164,
      true,
    ),
    summary(
      owner,
      "atlas",
      "Offline-first maps for field work and long hikes.",
      swift,
      1342,
      87,
      false,
    ),
    summary(
      owner,
      "quill",
      "Notebook-style documentation from plain Markdown.",
      python,
      968,
      52,
      false,
    ),
    summary(
      owner,
      "dotfiles",
      "My shell, editor and terminal setup.",
      shell,
      411,
      39,
      false,
    ),
  ];
}

function avatarRefs(logins: readonly string[]): AvatarRef[] {
  return logins.map((login) => ({ login, avatarUrl: identicon(login) }));
}

/**
 * A year of weekly commit activity ending in the demo's current week, with
 * commits per weekday. `pace` is the busiest a weekday gets: a repository's
 * own rhythm, or several repositories summed for an organization.
 */
function demoActivity(seed: number, pace: number): CommitActivity {
  const next = prng(seed);
  const start = parseIsoDate("2025-11-16");
  const weeks = Array.from({ length: 52 }, (_, index) => {
    const wave = 0.7 + 0.5 * Math.sin(index / 5.2);
    const days = WEEKDAY_ACTIVITY.map((weight) =>
      Math.floor(next() * pace * weight * wave),
    );
    return {
      week: start ? toIsoDate(addDays(start, index * 7)) : DEMO_FROM,
      commits: days.reduce((sum, count) => sum + count, 0),
      days,
    };
  });
  return {
    total: weeks.reduce((sum, week) => sum + week.commits, 0),
    weeks,
  };
}

/** Share of a year's commits that went to each of the top repositories. */
const TOP_REPO_SHARES = [
  ["mona-demo/rocket", 0.31],
  ["mona-demo/paper-lantern", 0.17],
  ["acme-labs/tide", 0.11],
  ["mona-demo/atlas", 0.07],
  ["mona-demo/quill", 0.04],
] as const;

/** The extras a year in review adds: the year before, and where the commits went. */
function demoYearInReview(year: number, total: number): YearInReview {
  const commits = Math.round(total * 0.71);
  return {
    year,
    // A good year: about a fifth more than the one before.
    previousTotal: Math.round(total / 1.22),
    topRepos: TOP_REPO_SHARES.map(([fullName, share]) => ({
      fullName,
      commits: Math.round(commits * share),
    })),
  };
}

function demoUser(year: number | null): User {
  const calendar = demoCalendar(year === null ? LAST_YEAR : yearRange(year));
  const bestDay = calendar.days.reduce<ContributionDay | null>(
    (best, day) => (day.count > (best?.count ?? 0) ? day : best),
    null,
  );
  return {
    kind: "user",
    login: "mona-demo",
    id: 1,
    name: "Mona Demo",
    avatarUrl: identicon("mona-demo"),
    bio: "Builds developer tools and offline maps. Demo data, not a real account.",
    company: "@acme-labs",
    location: "Lisbon, Portugal",
    websiteUrl: "https://example.com",
    twitter: null,
    pronouns: "she/her",
    createdAt: "2016-03-14T09:26:53Z",
    followers: 1284,
    following: 86,
    stats: {
      contributions: calendar.total,
      commits: Math.round(calendar.total * 0.71),
      pullRequests: Math.round(calendar.total * 0.09),
      issues: Math.round(calendar.total * 0.05),
      reviews: Math.round(calendar.total * 0.13),
      contributedTo: 37,
      repositories: 42,
      stars: 30_234,
    },
    calendar,
    streak: streakOf(calendar.days),
    bestDay,
    years: [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016],
    repos: demoRepos("mona-demo"),
    languages: [...LANGUAGES],
    organizations: avatarRefs(["acme-labs", "northwind-oss", "paper-lantern"]),
    wrapped: year === null ? null : demoYearInReview(year, calendar.total),
    complete: true,
    fetchedAt: FETCHED_AT,
  };
}

function demoOrg(): Org {
  return {
    kind: "org",
    login: "acme-labs",
    id: 2,
    name: "Acme Labs",
    avatarUrl: identicon("acme-labs"),
    description: "Open source tools for people who build the web. Demo data.",
    location: "Remote",
    websiteUrl: "https://example.com",
    twitter: null,
    isVerified: true,
    createdAt: "2014-06-02T08:00:00Z",
    stats: {
      repositories: 128,
      stars: 48_210,
      forks: 5932,
      members: 36,
      followers: 3120,
    },
    repos: demoRepos("acme-labs"),
    languages: [...LANGUAGES],
    activity: demoActivity(7, 96),
    people: avatarRefs(
      Array.from({ length: 24 }, (_, index) => `demo-member-${index + 1}`),
    ),
    fetchedAt: FETCHED_AT,
  };
}

/** Weeks of star history the data layer keeps. */
const STAR_WEEKS = 30;

/**
 * Cumulative stars per week that end at today's count: steady growth with a
 * launch-week jump two thirds of the way in, so the trend line has a shape.
 */
function demoStarHistory(current: number): Repo["starHistory"] {
  const next = prng(11);
  const gains = Array.from({ length: STAR_WEEKS }, (_, index) => {
    const launch = index >= 19 && index <= 21 ? 240 - (index - 19) * 70 : 0;
    return Math.floor(18 + next() * 46) + launch;
  });
  const first = parseIsoDate("2026-04-19");
  let stars = current - gains.reduce((sum, gain) => sum + gain, 0);
  return gains.map((gain, index) => {
    stars += gain;
    return {
      week: first ? toIsoDate(addDays(first, index * 7)) : DEMO_FROM,
      stars,
    };
  });
}

function demoRepo(): Repo {
  const stars = 18_432;
  return {
    kind: "repo",
    owner: {
      login: "acme-labs",
      avatarUrl: identicon("acme-labs"),
      kind: "org",
    },
    name: "rocket",
    fullName: "acme-labs/rocket",
    description: "A fast, friendly build tool for the modern web. Demo data.",
    homepageUrl: "https://example.com",
    stars,
    forks: 912,
    watchers: 187,
    openIssues: 143,
    openPullRequests: 27,
    language: { name: LANGUAGES[0].name, color: LANGUAGES[0].color },
    languages: [...LANGUAGES],
    license: "MIT",
    topics: ["build-tool", "bundler", "typescript", "developer-tools"],
    createdAt: "2021-02-09T10:12:00Z",
    pushedAt: "2026-11-12T18:40:00Z",
    isArchived: false,
    isFork: false,
    latestRelease: {
      tag: "v4.2.0",
      name: "Rocket 4.2",
      publishedAt: "2026-11-03T15:00:00Z",
    },
    commits: 6841,
    activity: demoActivity(3, 26),
    starHistory: demoStarHistory(stars),
    contributors: Array.from({ length: 30 }, (_, index) => ({
      login: `demo-contributor-${index + 1}`,
      avatarUrl: identicon(`demo-contributor-${index + 1}`),
      contributions: Math.round(1900 / (index + 1.4)),
    })),
    contributorCount: 214,
    fetchedAt: FETCHED_AT,
  };
}

/** What to vary in the demo data. */
export interface DemoOptions {
  /**
   * A calendar year for the user: the calendar then covers that year (up to
   * the demo's "today" for 2026) and the year-in-review extras are filled
   * in, as the data layer does when a banner asks for a year. Other kinds
   * ignore it.
   */
  year?: number | null;
}

/**
 * Deterministic synthetic data for one entity kind: "Mona Demo", the
 * organization "acme-labs" or the repository "acme-labs/rocket".
 */
export function demoEntity(kind: "user", options?: DemoOptions): User;
export function demoEntity(kind: "org", options?: DemoOptions): Org;
export function demoEntity(kind: "repo", options?: DemoOptions): Repo;
export function demoEntity(kind: EntityKind, options?: DemoOptions): Entity;
export function demoEntity(kind: EntityKind, options?: DemoOptions): Entity {
  if (kind === "org") return demoOrg();
  if (kind === "repo") return demoRepo();
  const year = options?.year;
  return demoUser(
    typeof year === "number" && Number.isInteger(year) ? year : null,
  );
}

/** The instant the demo data pretends to be fetched at; a fitting `RenderEnv.now`. */
export const DEMO_NOW = FETCHED_AT;
