/**
 * The pure parts of the target combobox: what the list offers, how the
 * highlight moves and how pasted text is read. No React, no DOM.
 */
import type { BannerTarget } from "@/lib/banner";
import { parseTargetSlug, targetSlug } from "@/lib/embed";
import type { Suggestion } from "@/lib/github/schema";

/** One row of the list: a suggestion, a recent target or a popular example. */
export interface TargetOption {
  /** `login` or `owner/name`. */
  slug: string;
  kind: "user" | "org" | "repo";
  /** Display name or repository description. */
  title: string | null;
  avatarUrl: string | null;
  stars: number | null;
}

export interface TargetOptionGroup {
  id: "recent" | "popular" | "results";
  /** Visible group label, `null` for search results. */
  label: string | null;
  options: readonly TargetOption[];
}

/** GitHub serves any account's avatar from this stable URL, without the API. */
export function avatarOf(login: string): string {
  return `https://github.com/${encodeURIComponent(login)}.png?size=64`;
}

function example(slug: string, kind: TargetOption["kind"]): TargetOption {
  const [owner = slug] = slug.split("/");
  return { slug, kind, title: null, avatarUrl: avatarOf(owner), stars: null };
}

/** Offered when the field is empty: one of each kind, all well known. */
export const POPULAR_TARGETS: readonly TargetOption[] = [
  example("torvalds", "user"),
  example("vercel/next.js", "repo"),
  example("vercel", "org"),
  example("facebook/react", "repo"),
  example("sindresorhus", "user"),
];

export const KIND_LABELS: Record<TargetOption["kind"], string> = {
  user: "User",
  org: "Organization",
  repo: "Repository",
};

/**
 * What the list shows. An empty field offers recent targets and popular
 * examples (without repeating a recent one); any text offers the search
 * results for it.
 */
export function buildOptionGroups(input: {
  text: string;
  suggestions: readonly Suggestion[];
  recents: readonly TargetOption[];
  popular: readonly TargetOption[];
}): TargetOptionGroup[] {
  if (input.text.trim() !== "") {
    return input.suggestions.length > 0
      ? [{ id: "results", label: null, options: input.suggestions }]
      : [];
  }
  const recent = new Set(input.recents.map((item) => item.slug.toLowerCase()));
  const popular = input.popular.filter(
    (item) => !recent.has(item.slug.toLowerCase()),
  );
  const groups: TargetOptionGroup[] = [];
  if (input.recents.length > 0) {
    groups.push({ id: "recent", label: "Recent", options: input.recents });
  }
  if (popular.length > 0) {
    groups.push({ id: "popular", label: "Popular", options: popular });
  }
  return groups;
}

/**
 * The highlighted row after an arrow key: from "none" the first (down) or
 * last (up) row, then one step at a time, wrapping at both ends. -1 when the
 * list is empty.
 */
export function moveActive(
  current: number,
  count: number,
  direction: 1 | -1,
): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
}

const GITHUB_URL_RE =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#\s]+)(?:\/([^/?#\s]+))?/i;

/**
 * The target a pasted github.com address points at, ignoring whatever
 * follows the repository (`/tree/main`, `/issues/42`, a query, a hash).
 * `null` for anything that is not a github.com URL of an account or
 * repository; plain slugs are left to normal typing.
 */
export function targetFromUrl(text: string): BannerTarget | null {
  const match = GITHUB_URL_RE.exec(text.trim());
  if (!match) return null;
  const [, first, second] = match;
  // github.com/orgs/vercel/people is the organization "vercel".
  if (first.toLowerCase() === "orgs") {
    return second ? parseTargetSlug(second) : null;
  }
  return parseTargetSlug(second ? `${first}/${second}` : first);
}

/** The option behind a typed target, when the list has one for it. */
export function findOption(
  options: readonly TargetOption[],
  target: BannerTarget,
): TargetOption | null {
  const slug = targetSlug(target).toLowerCase();
  return options.find((option) => option.slug.toLowerCase() === slug) ?? null;
}

/** What to remember of a committed target when the list knows nothing of it. */
export function optionForTarget(target: BannerTarget): TargetOption {
  const slug = targetSlug(target);
  return target.kind === "repo"
    ? example(slug, "repo")
    : // Users and organizations cannot be told apart from a login alone.
      example(slug, "user");
}
