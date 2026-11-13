"use no memo";

import type { Block, Ctx } from "@/lib/banner/context";
import { planActivity } from "@/lib/banner/sections/activity";
import { planContributors, planPeople } from "@/lib/banner/sections/avatars";
import type { Brand } from "@/lib/banner/sections/footer";
import { planLanguages } from "@/lib/banner/sections/languages";
import { planOrgs } from "@/lib/banner/sections/orgs";
import { planRepos } from "@/lib/banner/sections/repos";
import { planStreak } from "@/lib/banner/sections/streak";
import type { SectionId } from "@/lib/banner/types";

/** The box a content section is planned for. */
export interface SectionSpace {
  width: number;
  /** Height the section may take; `null` when the canvas grows with its content. */
  maxHeight: number | null;
  /**
   * How much secondary detail to give up, 0 (none) to 2 (all of it). Fixed
   * canvases raise it before they shrink the type: repository cards lose
   * their description lines, for example.
   */
  compact: 0 | 1 | 2;
}

/** A planned content section, with what a layout may ask of it beyond its box. */
export interface SectionBlock extends Block {
  /**
   * How cramped the block is, 0 = comfortable. A fixed canvas does not grow
   * its type when that would raise it.
   */
  strain?: number;
  /**
   * The same block with the brand mark on its own last line, or `null` when
   * the mark does not fit there. Sections that end in a quiet line (a
   * caption) offer it, so a card does not need a line just for the mark.
   */
  withBrand?(brand: Brand): Block | null;
}

/**
 * Plans one content section for a box. Returns `null` when the section has
 * nothing to show for this entity (wrong kind, no data) or cannot fit: the
 * layout then simply leaves it out.
 */
export type SectionPlanner = (
  ctx: Ctx,
  space: SectionSpace,
) => SectionBlock | null;

/**
 * Sections that fill the height a fixed canvas has left instead of asking
 * for a fixed one: a chart or an avatar grid is as large as its box allows.
 */
export const FLEXIBLE_SECTIONS: ReadonlySet<SectionId> = new Set([
  "activity",
  "people",
  "contributors",
]);

/**
 * Content sections that stack as plain blocks. `header`, `stats` and
 * `heatmap` are not here: layouts place those themselves (tiles merge into
 * the header, the heatmap decides the measure of a card).
 *
 * To add a section, write its planner and register it under its id. An id
 * without a planner is skipped, never an error.
 */
export const SECTION_PLANNERS: Partial<Record<SectionId, SectionPlanner>> = {
  streak: (ctx, space) =>
    planStreak(ctx, { width: space.width, maxHeight: space.maxHeight }),
  repos: (ctx, space) =>
    planRepos(ctx, {
      width: space.width,
      maxHeight: space.maxHeight,
      count: ctx.options.count,
      lines: (2 - space.compact) as 0 | 1 | 2,
      singleRow: space.compact > 0,
    }),
  languages: (ctx, space) =>
    planLanguages(ctx, { width: space.width, count: ctx.options.count }),
  orgs: (ctx, space) => planOrgs(ctx, { width: space.width }),
  people: planPeople,
  activity: planActivity,
  contributors: planContributors,
};
