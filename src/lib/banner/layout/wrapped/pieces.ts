"use no memo";

import { type Block, type Ctx, lineOf, noteLine } from "@/lib/banner/context";
import { baselineOffset, type Node } from "@/lib/banner/draw";
import type { YearReview } from "@/lib/banner/review";
import {
  type Brand,
  brandTop,
  fitBrand,
  planBrand,
} from "@/lib/banner/sections/footer";
import { planHeader } from "@/lib/banner/sections/header";
import { planHero, planYearMark } from "@/lib/banner/sections/wrapped/hero";
import {
  languageEntries,
  listLabelWidth,
  planListColumn,
  planListLine,
  repoEntries,
} from "@/lib/banner/sections/wrapped/lists";

/**
 * Compositions the arrangements of the year in review share: the opening
 * (who, when, how much) and the closing (where the work went, and the brand
 * mark).
 */

/** Entries a list shows when the `count` option does not say. */
const DEFAULT_COUNT = 3;
const REPOS_LABEL = "Top repositories";
const LANGUAGES_LABEL = "Top languages";

/** Which closing lists to print, and how long they may be. */
export interface Lists {
  repos: boolean;
  languages: boolean;
  /** Most entries per list. */
  count: number;
}

/** The number of entries the banner asks for in each list. */
export function listCount(ctx: Ctx): number {
  return Math.max(1, ctx.options.count ?? DEFAULT_COUNT);
}

/** Both lists at the length the banner asks for. */
export function fullLists(ctx: Ctx): Lists {
  return { repos: true, languages: true, count: listCount(ctx) };
}

/** True when the year has top repositories to list (the extras were fetched). */
export function hasRepos(review: YearReview): boolean {
  return review.topRepos.length > 0;
}

/**
 * Identity on the left with the total under it, the year on the right. Where
 * the two overlap in height the total keeps clear of the year: of its large
 * line while that lasts, then only of the quiet line under it.
 */
export function planTop(
  ctx: Ctx,
  review: YearReview,
  width: number,
  breakdown: boolean,
): Block {
  const { ramp } = ctx;
  const clearance = ramp.small * 2;
  // Beside a name there is only room for the year on canvases of some width.
  const mark =
    width >= ramp.small * 30
      ? planYearMark(ctx, review, Math.round(width * 0.36))
      : null;
  const header = planHeader(ctx, {
    width,
    reserve: mark ? mark.width + clearance : 0,
    bioLines: 0,
  });
  const heroTop = header.height + Math.round(ramp.small * 0.6);
  const beside = !mark
    ? 0
    : heroTop < mark.bigHeight
      ? mark.width
      : heroTop < mark.height
        ? mark.subWidth
        : 0;
  const hero = planHero(
    ctx,
    review,
    width - (beside ? beside + clearance : 0),
    breakdown,
  );
  return {
    width,
    height: Math.max(heroTop + hero.height, mark?.height ?? 0),
    at: (x, y) => [
      ...header.at(x, y),
      ...hero.at(x, y + heroTop),
      ...(mark ? mark.at(x + width - mark.width, y) : []),
    ],
  };
}

/**
 * The closing as lines: top repositories and top languages, each on a line
 * of its own, with the brand mark at the right end of the last one (or, with
 * `markBelow`, on a line under them: for canvases with height to spare).
 * `null` when there is nothing to print at all.
 */
export function planLines(
  ctx: Ctx,
  review: YearReview,
  width: number,
  lists: Lists,
  brand: Brand | null,
  markBelow = false,
): Block | null {
  const { ramp } = ctx;
  const repos = lists.repos ? repoEntries(review, lists.count) : [];
  const languages = lists.languages ? languageEntries(ctx, lists.count) : [];
  const printed = [
    ...(repos.length
      ? [{ label: REPOS_LABEL, entries: repos, notes: false }]
      : []),
    ...(languages.length
      ? [{ label: LANGUAGES_LABEL, entries: languages, notes: true }]
      : []),
  ];
  const labelWidth = listLabelWidth(
    ctx,
    printed.map((list) => list.label),
  );
  const line = lineOf(ramp.small, 1.4);
  const lineGap = Math.round(ramp.small * 0.3);
  const last = printed[printed.length - 1];
  // Beside the last list the mark may take half the line: in full, or as
  // the host alone when that lets more of the list show.
  const limit = markBelow ? width : Math.round(width * 0.5);
  const marks = brand
    ? [
        fitBrand(ctx, brand, limit, true),
        fitBrand(ctx, { full: brand.short, short: brand.short }, limit),
      ].filter((item) => item !== null)
    : [];
  type Mark = (typeof marks)[number];
  const tail = (mark: Mark | null) =>
    last
      ? planListLine(ctx, {
          width: width - (mark && !markBelow ? mark.width + ramp.small * 2 : 0),
          labelWidth,
          ...last,
        })
      : null;
  const shown = (mark: Mark) => tail(mark)?.shown ?? 0;
  // More entries win; between equals the fuller mark does.
  const mark = marks.reduce<Mark | null>(
    (best, item) => (best && shown(best) >= shown(item) ? best : item),
    null,
  );
  const planned = [
    ...printed
      .slice(0, -1)
      .map((list) => planListLine(ctx, { width, labelWidth, ...list })),
    tail(mark),
  ].filter((item) => item !== null);
  if (planned.length === 0 && !mark) return null;
  const ownLine = mark !== null && (markBelow || planned.length === 0);
  const rows = planned.length + (ownLine ? 1 : 0);
  const markGap = ownLine && planned.length ? Math.round(ramp.small * 0.5) : 0;
  return {
    width,
    height: rows * line + Math.max(0, rows - 1) * lineGap + markGap,
    at(x, y) {
      const nodes: Node[] = [];
      planned.forEach((item, index) => {
        nodes.push(...item.at(x, y + index * (line + lineGap)));
      });
      if (mark) {
        const lastTop = y + (rows - 1) * (line + lineGap) + markGap;
        nodes.push(
          ...planBrand(ctx, mark.text, mark.width).at(
            x + width - mark.width,
            lastTop + brandTop(ctx, baselineOffset(ramp.small, line)),
          ),
        );
      }
      return nodes;
    },
  };
}

/**
 * The closing as two small tables side by side (repositories with their
 * commits, languages with their shares) and the brand mark on a line under
 * them: for canvases with height to spare. `null` when there is nothing to
 * print at all.
 */
export function planTables(
  ctx: Ctx,
  review: YearReview,
  width: number,
  lists: Lists,
  brand: Brand | null,
): Block | null {
  const { ramp } = ctx;
  const gutter = ramp.small * 3;
  const column = Math.floor((width - gutter) / 2);
  const tables = [
    lists.repos
      ? planListColumn(ctx, {
          width: column,
          heading: REPOS_LABEL,
          unit: "commits",
          entries: repoEntries(review, lists.count),
        })
      : null,
    lists.languages
      ? planListColumn(ctx, {
          width: column,
          heading: LANGUAGES_LABEL,
          entries: languageEntries(ctx, lists.count),
        })
      : null,
  ].filter((table) => table !== null);
  const mark = fitBrand(ctx, brand, width);
  if (tables.length === 0 && !mark) return null;
  const tablesHeight = Math.max(0, ...tables.map((table) => table.height));
  const markLine = noteLine(ctx);
  const markSpace = mark
    ? markLine + (tables.length ? Math.round(ramp.small * 0.8) : 0)
    : 0;
  return {
    width,
    height: tablesHeight + markSpace,
    at(x, y) {
      const nodes: Node[] = [];
      tables.forEach((table, index) => {
        nodes.push(...table.at(x + index * (column + gutter), y));
      });
      if (mark) {
        nodes.push(
          ...planBrand(ctx, mark.text, mark.width).at(
            x + width - mark.width,
            y + tablesHeight + markSpace - markLine,
          ),
        );
      }
      return nodes;
    },
  };
}
