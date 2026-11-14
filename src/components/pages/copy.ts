/**
 * The words of an owner or repository page, built from its GitHub data:
 * the title, the meta description, the sentence under the `<h1>` and the
 * facts block. Pure, so every branch (missing names, missing numbers, an
 * account with no activity) is unit tested.
 *
 * Numbers are written in full ("267,815", never "268k"): the page is where
 * an agent or a search engine reads them.
 */
import { longDate } from "@/content/format";
import { type BannerPreset, defaultPresetId, formatNumber } from "@/lib/banner";
import type {
  Entity,
  LanguageShare,
  Org,
  Repo,
  RepoSummary,
  User,
} from "@/lib/github/schema";

/** What the page calls the entity: the display name, or the login. */
export function displayName(entity: Entity): string {
  if (entity.kind === "repo") return entity.fullName;
  return entity.name?.trim() || entity.login;
}

/** "Linus Torvalds (@torvalds)", "@markeljan", "vercel/next.js". */
export function entityLabel(entity: Entity): string {
  if (entity.kind === "repo") return entity.fullName;
  const name = entity.name?.trim();
  return name ? `${name} (@${entity.login})` : `@${entity.login}`;
}

/** "User", "Organization", "Repository". */
export function kindLabel(entity: Entity): string {
  return entity.kind === "repo"
    ? "Repository"
    : entity.kind === "org"
      ? "Organization"
      : "User";
}

/** The account or repository on github.com. */
export function githubUrl(entity: Entity): string {
  return `https://github.com/${entity.kind === "repo" ? entity.fullName : entity.login}`;
}

/**
 * `<title>` without the site name (the layout appends it):
 * "Linus Torvalds (@torvalds) GitHub banner", and for a preset other than
 * the default "… GitHub banner: Activity".
 */
export function pageTitle(entity: Entity, preset: BannerPreset): string {
  const base = `${entityLabel(entity)} GitHub banner`;
  return preset.id === defaultPresetId(entity.kind)
    ? base
    : `${base}: ${preset.name}`;
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

/** "A", "A and B", "A, B and C". */
export function listing(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function topLanguages(languages: readonly LanguageShare[], max: number) {
  return languages.slice(0, max).map((language) => language.name);
}

function mostStarred(repos: readonly RepoSummary[]): RepoSummary | null {
  let best: RepoSummary | null = null;
  for (const repo of repos) {
    if (repo.stars > 0 && (!best || repo.stars > best.stars)) best = repo;
  }
  return best;
}

function userSummary(user: User): string {
  const who = displayName(user);
  const { stats, streak } = user;
  const sentences: string[] = [];
  if (user.calendar.total > 0) {
    const commits =
      stats.commits !== null && stats.commits * 2 >= user.calendar.total
        ? `, ${formatNumber(stats.commits)} of them commits`
        : "";
    const longest =
      streak.longest >= 2
        ? `, with a longest streak of ${count(streak.longest, "day")}`
        : "";
    sentences.push(
      `${who} made ${count(user.calendar.total, "contribution")} on GitHub in the last year${commits}${longest}.`,
    );
  } else {
    sentences.push(`${who} has no public contributions on GitHub this year.`);
  }
  const languages = topLanguages(user.languages, 2);
  if (languages.length > 0) {
    sentences.push(
      `Most of the code in their public repositories is ${listing(languages)}.`,
    );
  }
  const top = mostStarred(user.repos);
  if (top) {
    sentences.push(
      `Their most-starred repository is ${top.name}, with ${count(top.stars, "star")}.`,
    );
  }
  return sentences.join(" ");
}

function orgSummary(org: Org): string {
  const who = displayName(org);
  const { stats } = org;
  const people = stats.members ?? (org.people.length || null);
  const sentences = [
    `${who} is ${org.isVerified ? "a verified" : "a"} GitHub organization with ${count(stats.repositories, "public repository", "public repositories")}${
      people ? ` and ${count(people, "public member")}` : ""
    }.`,
  ];
  const top = mostStarred(org.repos);
  if (stats.stars > 0 && top) {
    sentences.push(
      `Its top repositories have ${count(stats.stars, "star")} between them, led by ${top.name} with ${formatNumber(top.stars)}.`,
    );
  }
  const languages = topLanguages(org.languages, 3);
  if (languages.length > 0) {
    sentences.push(`Most of that code is ${listing(languages)}.`);
  }
  return sentences.join(" ");
}

function repoSummary(repo: Repo): string {
  const language = repo.language ? `${repo.language.name} ` : "";
  const owner =
    repo.owner.kind === "org"
      ? `of the ${repo.owner.login} organization`
      : `by ${repo.owner.login}`;
  const sentences = [
    `${repo.fullName} is ${repo.isArchived ? "an archived" : /^[AEIOU]/i.test(language) ? "an" : "a"} ${language}repository ${owner} with ${count(repo.stars, "star")} and ${count(repo.forks, "fork")}.`,
  ];
  if (repo.contributorCount) {
    const commits =
      repo.activity && repo.activity.total > 0
        ? `, and ${count(repo.activity.total, "commit")} landed in the last year`
        : "";
    sentences.push(
      `${count(repo.contributorCount, "person has", "people have")} contributed to it${commits}.`,
    );
  }
  if (repo.latestRelease) {
    const date = repo.latestRelease.publishedAt
      ? `, published ${longDate(repo.latestRelease.publishedAt)}`
      : "";
    sentences.push(`The latest release is ${repo.latestRelease.tag}${date}.`);
  }
  return sentences.join(" ");
}

/**
 * One to three sentences of real, specific text about the entity, for the
 * paragraph under the `<h1>`. Different for every account: it quotes the
 * numbers, languages and repositories that make it what it is.
 */
export function summary(entity: Entity): string {
  if (entity.kind === "repo") return repoSummary(entity);
  if (entity.kind === "org") return orgSummary(entity);
  return userSummary(entity);
}

/** Shortened at a word boundary, with a full stop. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > 0 ? cut.slice(0, at) : cut).replace(/[,;:]$/, "")}…`;
}

/**
 * Meta description, at most 160 characters: the first sentence of the
 * summary and what the page offers.
 */
export function pageDescription(entity: Entity, preset: BannerPreset): string {
  const first = summary(entity).split(/(?<=\.)\s/)[0] ?? "";
  const offer =
    preset.id === defaultPresetId(entity.kind)
      ? "Live banner as SVG and PNG."
      : `${preset.name} banner as SVG and PNG.`;
  return clip(`${first} ${offer}`, 160);
}

export interface Fact {
  label: string;
  value: string;
}

function fact(label: string, value: number | null | undefined): Fact | null {
  return typeof value === "number"
    ? { label, value: formatNumber(value) }
    : null;
}

function text(label: string, value: string | null | undefined): Fact | null {
  const trimmed = value?.trim();
  return trimmed ? { label, value: trimmed } : null;
}

function kept(facts: readonly (Fact | null)[]): Fact[] {
  return facts.filter((item): item is Fact => item !== null);
}

/** The headline numbers, in full, as label and value pairs. */
export function headlineFacts(entity: Entity): Fact[] {
  if (entity.kind === "repo") {
    return kept([
      fact("Stars", entity.stars),
      fact("Forks", entity.forks),
      fact("Watchers", entity.watchers),
      fact("Open issues", entity.openIssues),
      fact("Open pull requests", entity.openPullRequests),
      fact("Commits on the default branch", entity.commits),
      fact("Commits in the last year", entity.activity?.total),
      fact("Contributors", entity.contributorCount),
      entity.latestRelease
        ? {
            label: "Latest release",
            value: entity.latestRelease.publishedAt
              ? `${entity.latestRelease.tag}, ${longDate(entity.latestRelease.publishedAt)}`
              : entity.latestRelease.tag,
          }
        : null,
      text("License", entity.license),
      { label: "Created", value: longDate(entity.createdAt) },
      entity.pushedAt
        ? { label: "Last push", value: longDate(entity.pushedAt) }
        : null,
    ]);
  }
  if (entity.kind === "org") {
    const { stats } = entity;
    return kept([
      fact("Public repositories", stats.repositories),
      fact("Stars on its top repositories", stats.stars),
      fact("Forks of its top repositories", stats.forks),
      fact("Public members", stats.members ?? (entity.people.length || null)),
      fact("Followers", stats.followers),
      fact(
        "Commits in the last year, top repositories",
        entity.activity?.total,
      ),
      { label: "Verified domain", value: entity.isVerified ? "Yes" : "No" },
      text("Location", entity.location),
      { label: "On GitHub since", value: longDate(entity.createdAt) },
    ]);
  }
  const { stats, streak, calendar } = entity;
  return kept([
    {
      label: `Contributions, ${longDate(calendar.from)} to ${longDate(calendar.to)}`,
      value: formatNumber(calendar.total),
    },
    fact("Commits", stats.commits),
    fact("Pull requests opened", stats.pullRequests),
    fact("Issues opened", stats.issues),
    fact("Pull request reviews", stats.reviews),
    fact("Repositories contributed to", stats.contributedTo),
    fact("Current streak, days", streak.current),
    fact("Longest streak, days", streak.longest),
    entity.bestDay && entity.bestDay.count > 0
      ? {
          label: "Busiest day",
          value: `${count(entity.bestDay.count, "contribution")} on ${longDate(entity.bestDay.date)}`,
        }
      : null,
    fact("Public repositories", stats.repositories),
    fact("Stars received", stats.stars),
    fact("Followers", entity.followers),
    fact("Following", entity.following),
    text("Company", entity.company),
    text("Location", entity.location),
    { label: "On GitHub since", value: longDate(entity.createdAt) },
  ]);
}

/** "TypeScript 62.1%, JavaScript 20%": the language bar as words. */
export function languageFacts(entity: Entity): string[] {
  return entity.languages.map(
    (language) => `${language.name} ${language.percent}%`,
  );
}
