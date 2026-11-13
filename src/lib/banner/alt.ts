"use no memo";

import { formatNumber } from "@/lib/banner/format";
import { plainText } from "@/lib/banner/text";
import type { BannerOptions } from "@/lib/banner/types";
import type { Entity } from "@/lib/github/schema";

function count(
  n: number | null | undefined,
  one: string,
  many: string,
): string | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

function sentence(lead: string, facts: (string | null)[]): string {
  const listed = facts.filter((fact): fact is string => Boolean(fact));
  return listed.length ? `${lead}: ${listed.join(", ")}.` : `${lead}.`;
}

/**
 * Plain-text description of a banner for `alt` and `aria-label`. It states
 * who the banner is about and its headline numbers in full (no "1.2k"), so a
 * screen reader gets what a sighted reader gets at a glance.
 */
export function altText(
  entity: Entity,
  options: Pick<BannerOptions, "year">,
): string {
  if (entity.kind === "repo") {
    const description = plainText(entity.description).replace(/[.!?]+$/, "");
    const lead = description
      ? `${entity.fullName}: ${description}.`
      : `${entity.fullName}.`;
    const facts = [
      count(entity.stars, "star", "stars"),
      count(entity.forks, "fork", "forks"),
    ].filter(Boolean);
    return facts.length ? `${lead} ${facts.join(", ")}.` : lead;
  }
  const name = plainText(entity.name);
  const who = name ? `${name} (@${entity.login})` : `@${entity.login}`;
  const lead = `GitHub banner for ${who}`;
  if (entity.kind === "org") {
    return sentence(lead, [
      count(
        entity.stats.repositories,
        "public repository",
        "public repositories",
      ),
      count(entity.stats.stars, "star", "stars"),
      count(entity.stats.members, "public member", "public members"),
    ]);
  }
  const period = options.year ? `in ${options.year}` : "in the last year";
  const contributions = count(
    entity.stats.contributions,
    "contribution",
    "contributions",
  );
  return sentence(lead, [
    contributions ? `${contributions} ${period}` : null,
    count(entity.stats.stars, "star", "stars"),
    count(entity.followers, "follower", "followers"),
  ]);
}
