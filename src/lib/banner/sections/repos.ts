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

function drawCard(
  ctx: Ctx,
  repo: RepoSummary,
  m: CardMetrics,
  x: number,
  y: number,
  width: number,
  height: number,
  descriptionLines: number,
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

  // Footer: language, stars, forks, each only while it still fits whole.
  const itemGap = Math.round(m.textSize * 1.3);
  const glyphGap = Math.round(m.textSize * 0.35);
  let cursor = left;
  const right = left + inner;
  const language = plainText(repo.language?.name);
  if (language) {
    const dot = Math.round(m.textSize * 0.85);
    const labelWidth = Math.min(
      boxOf(ctx, language, m.textSize),
      Math.max(0, right - cursor - dot - glyphGap),
    );
    nodes.push(
      box(cursor, centre(dot), dot, dot, {
        borderRadius: dot / 2,
        backgroundColor: normalizeHex(repo.language?.color) ?? muted,
      }),
      textLine({
        x: cursor + dot + glyphGap,
        y: footTop,
        width: labelWidth,
        text: language,
        size: m.textSize,
        line: m.textLine,
        color: muted,
      }),
    );
    cursor += dot + glyphGap + labelWidth + itemGap;
  }
  const counts = [
    { glyph: ICONS.star, value: repo.stars, always: true },
    { glyph: ICONS["repo-forked"], value: repo.forks, always: false },
  ];
  const glyph = Math.round(m.textSize * 1.15);
  for (const item of counts) {
    if (!item.always && !(item.value > 0)) continue;
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

/**
 * Plans the repository cards: as many per row as stay readable, the
 * description shortened (2 lines, 1, none) until the rows fit the height.
 * Returns `null` when the owner has no repositories to show; while they are
 * still loading, placeholder cards keep their place.
 */
export function planRepos(ctx: Ctx, spec: ReposSpec): Block | null {
  const repos = reposOf(ctx);
  const pending = repos.length === 0 && isLoading(ctx);
  if ((repos.length === 0 && !pending) || spec.width <= 0) return null;
  const { ramp } = ctx;
  const m = metricsOf(ctx);
  const gap = Math.round(ramp.small * 1.33);
  const minWidth = ramp.small * 15;
  const perRow = Math.max(
    1,
    Math.min(3, Math.floor((spec.width + gap) / (minWidth + gap))),
  );
  const asked = spec.singleRow ? perRow : (spec.count ?? perRow);
  const wanted = pending ? asked : Math.min(repos.length, asked);

  // Fewer rows first, then shorter descriptions, until it fits.
  let lines: number = spec.lines;
  let rows = Math.ceil(wanted / perRow);
  const total = () => rows * cardHeight(m, lines) + (rows - 1) * gap;
  if (spec.maxHeight !== null) {
    while (total() > spec.maxHeight && rows > 1) rows -= 1;
    while (total() > spec.maxHeight && lines > 0) lines -= 1;
    if (total() > spec.maxHeight) return null;
  }
  const count = Math.min(wanted, rows * perRow);
  const columns = Math.min(perRow, count);
  const cardWidth = Math.floor((spec.width - (columns - 1) * gap) / columns);
  const height = cardHeight(m, lines);

  return {
    width: spec.width,
    height: total(),
    at(x, y) {
      return Array.from({ length: count }, (_, index) => {
        const cardX = x + (index % columns) * (cardWidth + gap);
        const cardY = y + Math.floor(index / columns) * (height + gap);
        const repo = repos[index];
        return repo
          ? drawCard(ctx, repo, m, cardX, cardY, cardWidth, height, lines)
          : drawPlaceholder(ctx, m, cardX, cardY, cardWidth, height, lines);
      }).flat();
    },
  };
}
