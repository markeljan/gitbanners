"use no memo";

import {
  type Block,
  boxOf,
  type Ctx,
  textLineHeight,
} from "@/lib/banner/context";
import {
  box,
  compact,
  icon,
  type Node,
  type TextRun,
  textBlock,
  textLine,
} from "@/lib/banner/draw";
import { formatCount } from "@/lib/banner/format";
import { ICONS } from "@/lib/banner/icons";
import { normalizeHex } from "@/lib/banner/options";
import { plainText } from "@/lib/banner/text";
import type { RepoSummary } from "@/lib/github/schema";

/**
 * Repositories as cards, in the look of GitHub's pinned repositories: name in
 * the accent colour, a short description, then language, stars and forks.
 */

export interface ReposSpec {
  width: number;
  /** Height the cards may take; `null` lets them be as tall as they like. */
  maxHeight: number | null;
  /** Most cards to show; `null` shows one row. */
  count: number | null;
  /** Most description lines per card. */
  lines: 0 | 1 | 2;
  /** Keep to one row of cards, whatever `count` says. */
  singleRow: boolean;
  /**
   * `maxHeight` is what the canvas has left and the cards are its main
   * content: show as many of them as fit and shorten descriptions first,
   * instead of dropping rows to keep the descriptions.
   */
  fill?: boolean;
}

/** The cards with how much of what was asked for they show, for layouts that compare candidates. */
export interface ReposPlan extends Block {
  /** 0 when every card and description line asked for is there; rises as they are given up. */
  strain?: number;
}

interface CardMetrics {
  padding: number;
  nameSize: number;
  nameLine: number;
  textSize: number;
  textLine: number;
  /** Gap between the lines of a card. */
  inner: number;
}

function metricsOf(ctx: Ctx): CardMetrics {
  const { ramp } = ctx;
  return {
    padding: Math.round(ramp.small * 1.25),
    nameSize: ramp.body,
    nameLine: textLineHeight(ramp.body),
    textSize: ramp.small,
    textLine: textLineHeight(ramp.small),
    inner: Math.round(ramp.small * 0.6),
  };
}

function cardHeight(m: CardMetrics, descriptionLines: number): number {
  const description = descriptionLines
    ? m.inner + descriptionLines * m.textLine
    : 0;
  return 2 * m.padding + m.nameLine + description + m.inner * 2 + m.textLine;
}

/** Repositories of this banner's owner: users and organizations have them, repositories do not. */
function reposOf(ctx: Ctx): readonly RepoSummary[] {
  const { entity } = ctx;
  return entity.kind === "repo" || !Array.isArray(entity.repos)
    ? []
    : entity.repos;
}

/** `owner/` is only worth showing when the repository belongs to someone else. */
function nameRuns(ctx: Ctx, repo: RepoSummary): TextRun[] {
  const { entity, ramp, palette } = ctx;
  const own =
    entity.kind !== "repo" &&
    plainText(repo.owner).toLowerCase() ===
      plainText(entity.login).toLowerCase();
  const name = {
    text: plainText(repo.name),
    weight: ramp.strong,
    color: palette.colors.accent,
  };
  return own
    ? [name]
    : [
        {
          text: `${plainText(repo.owner)}/`,
          weight: 400,
          color: palette.colors.accent,
        },
        name,
      ];
}

/** Sizes of a card's last line: language, stars, forks. */
interface FootMetrics {
  /** Space between two items. */
  itemGap: number;
  /** The least of it, before a long language name is cut instead. */
  tightGap: number;
  /** Space between a glyph (or the language dot) and its text. */
  glyphGap: number;
  glyph: number;
  dot: number;
}

function footMetricsOf(m: CardMetrics): FootMetrics {
  return {
    itemGap: Math.round(m.textSize * 1.3),
    tightGap: Math.round(m.textSize * 0.7),
    glyphGap: Math.round(m.textSize * 0.35),
    glyph: Math.round(m.textSize * 1.15),
    dot: Math.round(m.textSize * 0.85),
  };
}

/** Width of a count with its glyph, e.g. the star and "18.4k". */
function countWidth(ctx: Ctx, m: CardMetrics, value: number): number {
  const f = footMetricsOf(m);
  return f.glyph + f.glyphGap + boxOf(ctx, formatCount(value), m.textSize);
}

/**
 * True when the card's last line has room for the fork count after the
 * whole language name and the stars. Cards of one banner decide this
 * together (see `planRepos`): forks on some cards and not on others reads as
 * missing data.
 */
function forksFit(
  ctx: Ctx,
  repo: RepoSummary,
  m: CardMetrics,
  inner: number,
): boolean {
  const f = footMetricsOf(m);
  const language = plainText(repo.language?.name);
  // The gap after the language may tighten to make the room (see `drawCard`).
  const lead = language
    ? f.dot + f.glyphGap + boxOf(ctx, language, m.textSize) + f.tightGap
    : 0;
  return (
    lead +
      countWidth(ctx, m, repo.stars) +
      f.itemGap +
      countWidth(ctx, m, repo.forks) <=
    inner
  );
}

function drawCard(
  ctx: Ctx,
  repo: RepoSummary,
  m: CardMetrics,
  x: number,
  y: number,
  width: number,
  height: number,
  descriptionLines: number,
  showForks: boolean,
): Node[] {
  const { ramp, palette } = ctx;
  const { muted } = palette.colors;
  const inner = width - 2 * m.padding;
  const left = x + m.padding;
  const iconSize = Math.round(m.nameSize * 1.1);
  const iconGap = Math.round(m.nameSize * 0.5);
  const nameTop = y + m.padding;
  const descriptionTop = nameTop + m.nameLine + m.inner;
  const footTop = y + height - m.padding - m.textLine;
  const centre = (size: number) =>
    footTop + Math.round((m.textLine - size) / 2);

  const nodes: (Node | null)[] = [
    box(x, y, width, height, {
      borderRadius: ramp.radius,
      border: `${ramp.hair}px solid ${palette.colors.border}`,
    }),
    icon(
      ICONS.repo,
      left,
      nameTop + Math.round((m.nameLine - iconSize) / 2),
      iconSize,
      muted,
    ),
    textLine({
      x: left + iconSize + iconGap,
      y: nameTop,
      width: inner - iconSize - iconGap,
      text: nameRuns(ctx, repo),
      size: m.nameSize,
      line: m.nameLine,
      color: palette.colors.accent,
    }),
    descriptionLines
      ? textBlock({
          x: left,
          y: descriptionTop,
          width: inner,
          text: plainText(repo.description),
          size: m.textSize,
          line: m.textLine,
          lines: descriptionLines,
          color: muted,
        })
      : null,
  ];

  // Footer: language, stars, forks. Stars are what a repository is ranked
  // by, so on a narrow card they keep their place: the gap before them
  // tightens first, then the language name is cut short. Forks are shown on
  // every card of the banner or on none (`showForks`).
  const { itemGap, tightGap, glyphGap, glyph, dot } = footMetricsOf(m);
  const forks = showForks && repo.forks > 0;
  // What follows the language and must stay whole: the stars, and the forks
  // when this banner shows them.
  const countsWidth =
    countWidth(ctx, m, repo.stars) +
    (forks ? itemGap + countWidth(ctx, m, repo.forks) : 0);
  let cursor = left;
  const right = left + inner;
  const language = plainText(repo.language?.name);
  if (language) {
    const lead = dot + glyphGap;
    const natural = boxOf(ctx, language, m.textSize);
    const beforeStars = right - cursor - lead - tightGap - countsWidth;
    // A name cut to less than a few letters says nothing: then it keeps the
    // line to itself, as far as it goes.
    const labelWidth =
      beforeStars >= Math.min(natural, m.textSize * 3)
        ? Math.min(natural, beforeStars)
        : Math.min(natural, Math.max(0, right - cursor - lead));
    nodes.push(
      box(cursor, centre(dot), dot, dot, {
        borderRadius: dot / 2,
        backgroundColor: normalizeHex(repo.language?.color) ?? muted,
      }),
      textLine({
        x: cursor + lead,
        y: footTop,
        width: labelWidth,
        text: language,
        size: m.textSize,
        line: m.textLine,
        color: muted,
      }),
    );
    cursor += lead + labelWidth;
    cursor += Math.min(
      itemGap,
      Math.max(tightGap, right - cursor - countsWidth),
    );
  }
  const counts = [
    { glyph: ICONS.star, value: repo.stars, shown: true },
    { glyph: ICONS["repo-forked"], value: repo.forks, shown: forks },
  ];
  for (const item of counts) {
    if (!item.shown) continue;
    const text = formatCount(item.value);
    const textWidth = boxOf(ctx, text, m.textSize);
    if (cursor + glyph + glyphGap + textWidth > right) break;
    nodes.push(
      icon(item.glyph, cursor, centre(glyph), glyph, muted),
      textLine({
        x: cursor + glyph + glyphGap,
        y: footTop,
        width: textWidth,
        text,
        size: m.textSize,
        line: m.textLine,
        color: muted,
      }),
    );
    cursor += glyph + glyphGap + textWidth + itemGap;
  }
  return compact(nodes);
}

/**
 * A card that holds a place while the repositories are still loading: same
 * box, bars where the text will be. The studio streams data in, and a banner
 * that changes height when it arrives would jump under the reader's eyes.
 */
function drawPlaceholder(
  ctx: Ctx,
  m: CardMetrics,
  x: number,
  y: number,
  width: number,
  height: number,
  descriptionLines: number,
): Node[] {
  const { ramp, palette } = ctx;
  const inner = width - 2 * m.padding;
  const left = x + m.padding;
  const bar = (top: number, share: number, line: number, size: number) => {
    const thickness = Math.max(2, Math.round(size * 0.55));
    return box(
      left,
      top + Math.round((line - thickness) / 2),
      Math.max(1, Math.round(inner * share)),
      thickness,
      { borderRadius: thickness / 2, backgroundColor: palette.colors.surface },
    );
  };
  const nameTop = y + m.padding;
  const descriptionTop = nameTop + m.nameLine + m.inner;
  const footTop = y + height - m.padding - m.textLine;
  return [
    box(x, y, width, height, {
      borderRadius: ramp.radius,
      border: `${ramp.hair}px solid ${palette.colors.border}`,
    }),
    bar(nameTop, 0.42, m.nameLine, m.nameSize),
    ...Array.from({ length: descriptionLines }, (_, line) =>
      bar(
        descriptionTop + line * m.textLine,
        line === descriptionLines - 1 ? 0.6 : 0.9,
        m.textLine,
        m.textSize,
      ),
    ),
    bar(footTop, 0.3, m.textLine, m.textSize),
  ];
}

/** True while a user's repositories and languages have not arrived yet. */
function isLoading(ctx: Ctx): boolean {
  return ctx.entity.kind === "user" && ctx.entity.complete === false;
}

/** What a card is worth to the reader: its name, and more with each line that says what it is for. */
function cardWorth(lines: number): number {
  return 1 + 0.45 * lines;
}

/** One way of setting the cards: how many per row, how many rows, how many description lines. */
interface Filling {
  perRow: number;
  rows: number;
  lines: number;
}

/**
 * The way of filling a box of `maxHeight` that shows the most: every option
 * (cards per row, with the most description lines it may use) is tried with
 * fewer rows and fewer lines until it fits. A card counts, and a card that
 * says what the repository is for counts for more. The first best wins, so
 * earlier options are preferred on a tie. `null` when not one card fits.
 */
function bestFilling(
  m: CardMetrics,
  gap: number,
  wanted: number,
  maxHeight: number,
  options: readonly { perRow: number; lines: number }[],
): Filling | null {
  let best: (Filling & { worth: number }) | null = null;
  for (const option of options) {
    for (let rows = Math.ceil(wanted / option.perRow); rows >= 1; rows--) {
      for (let lines = option.lines; lines >= 0; lines--) {
        if (rows * cardHeight(m, lines) + (rows - 1) * gap > maxHeight) {
          continue;
        }
        const cards = Math.min(wanted, rows * option.perRow);
        const worth = cards * cardWorth(lines);
        if (!best || worth > best.worth) {
          best = { perRow: option.perRow, rows, lines, worth };
        }
      }
    }
  }
  return best;
}

/**
 * Plans the repository cards: as many per row as stay readable, the
 * description shortened (2 lines, 1, none) until the rows fit the height.
 * Returns `null` when the owner has no repositories to show; while they are
 * still loading, placeholder cards keep their place.
 */
export function planRepos(ctx: Ctx, spec: ReposSpec): ReposPlan | null {
  const repos = reposOf(ctx);
  const pending = repos.length === 0 && isLoading(ctx);
  if ((repos.length === 0 && !pending) || spec.width <= 0) return null;
  const { ramp } = ctx;
  const m = metricsOf(ctx);
  const gap = Math.round(ramp.small * 1.33);
  const minWidth = ramp.small * 15;
  const perRowOf = (narrowest: number) =>
    Math.max(
      1,
      Math.min(3, Math.floor((spec.width + gap) / (narrowest + gap))),
    );
  let perRow = perRowOf(minWidth);
  const asked = spec.singleRow && !spec.fill ? perRow : (spec.count ?? perRow);
  const wanted = pending ? asked : Math.min(repos.length, asked);

  let lines: number = spec.lines;
  let rows = Math.ceil(wanted / perRow);
  const total = () => rows * cardHeight(m, lines) + (rows - 1) * gap;
  if (spec.maxHeight !== null && spec.fill) {
    // Cards that only carry a name may be a little narrower, which can fit
    // one more of them per row.
    const dense = perRowOf(Math.round(minWidth * 0.9));
    const filling = bestFilling(m, gap, wanted, spec.maxHeight, [
      { perRow, lines: spec.lines },
      ...(dense > perRow ? [{ perRow: dense, lines: 0 }] : []),
    ]);
    if (!filling) return null;
    ({ perRow, rows, lines } = filling);
  } else if (spec.maxHeight !== null) {
    // Fewer rows first, then shorter descriptions, until it fits.
    while (total() > spec.maxHeight && rows > 1) rows -= 1;
    while (total() > spec.maxHeight && lines > 0) lines -= 1;
    if (total() > spec.maxHeight) return null;
  }
  const count = Math.min(wanted, rows * perRow);
  const columns = Math.min(perRow, count);
  const cardWidth = Math.floor((spec.width - (columns - 1) * gap) / columns);
  const height = cardHeight(m, lines);
  // One answer for the whole set: a fork count on some cards only would
  // look like the others have none.
  const showForks = repos
    .slice(0, count)
    .every(
      (repo) =>
        !(repo.forks > 0) || forksFit(ctx, repo, m, cardWidth - 2 * m.padding),
    );

  return {
    width: spec.width,
    height: total(),
    // Measured the way fillings are weighed, so type never grows into a
    // layout that shows less.
    ...(spec.fill
      ? {
          strain:
            1 -
            (count * cardWorth(lines)) /
              Math.max(1, wanted * cardWorth(spec.lines)),
        }
      : null),
    at(x, y) {
      return Array.from({ length: count }, (_, index) => {
        const cardX = x + (index % columns) * (cardWidth + gap);
        const cardY = y + Math.floor(index / columns) * (height + gap);
        const repo = repos[index];
        return repo
          ? drawCard(
              ctx,
              repo,
              m,
              cardX,
              cardY,
              cardWidth,
              height,
              lines,
              showForks,
            )
          : drawPlaceholder(ctx, m, cardX, cardY, cardWidth, height, lines);
      }).flat();
    },
  };
}
