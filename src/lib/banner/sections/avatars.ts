"use no memo";

import type { Block, Ctx } from "@/lib/banner/context";
import { box, compact, image, type Node, textLine } from "@/lib/banner/draw";
import { formatCount } from "@/lib/banner/format";
import { fitFontSize } from "@/lib/banner/metrics";
import type { AvatarRef } from "@/lib/github/schema";

/**
 * People as a grid of round avatars: the contributors of a repository, the
 * public members of an organization. When there are more people than faces,
 * the last place holds a "+N" chip, as under GitHub's own contributor list.
 *
 * Rows are always full and reach both edges of their box, so the grid lines
 * up with the header above it; only a handful of people too few for one row
 * is set left-aligned.
 */

export interface AvatarGridSpec {
  width: number;
  /** Height the grid may take; `null` when the canvas grows with its content. */
  maxHeight: number | null;
  /** Fill `maxHeight` as well as the people allow, instead of taking a natural size. */
  stretch: boolean;
  /** People in the order they are shown. */
  people: readonly AvatarRef[];
  /** How many there are in all, shown or not; `null` when only the listed ones are known. */
  total: number | null;
  /** Most avatars to show; `null` shows as many as fill the rows. */
  count: number | null;
  /** Most rows. */
  rows: number;
}

/** One way of setting the grid. */
interface Shape {
  size: number;
  gap: number;
  perRow: number;
  rows: number;
  /** Places taken, the "+N" chip included. */
  places: number;
  /** Rows are full: spread them to both edges. */
  justified: boolean;
}

/** Share of the avatar size left between two avatars. */
const GAP_SHARE = 1 / 6;
/**
 * Avatar sizes of a grid that fills a box, as the number of them that would
 * span its width: from faces that still read as faces to ones that do not
 * outgrow the banner's own subject.
 */
const MOST_PER_ROW = 24;
const FEWEST_PER_ROW = 10.5;
/**
 * The same limit for a handful of people who cannot fill a row: four faces
 * may be larger than ten, but not posters of their own.
 */
const FEWEST_FACES = 6.5;

function gapFor(size: number): number {
  return Math.max(2, Math.round(size * GAP_SHARE));
}

/**
 * The natural grid: avatars at four lines of small text on a card (48 px on
 * a README), three on a poster, as many per row as fit, grown by the pixel
 * or two that makes the row end exactly at the edge.
 */
function naturalShape(
  ctx: Ctx,
  spec: AvatarGridSpec,
  items: number,
): Shape | null {
  const nominal = Math.round(
    ctx.ramp.small * (ctx.canvas.chrome === "card" ? 4 : 3),
  );
  const gap = gapFor(nominal);
  const perRow = Math.floor((spec.width + gap) / (nominal + gap));
  if (perRow < 1) return null;
  if (items < perRow) {
    return {
      size: nominal,
      gap,
      perRow,
      rows: 1,
      places: items,
      justified: false,
    };
  }
  const size = Math.floor((spec.width - (perRow - 1) * gap) / perRow);
  // Without a count the grid shows whole rows; with one it shows that many
  // people, however the last row ends.
  const rows =
    spec.count === null
      ? Math.min(spec.rows, Math.floor(items / perRow))
      : Math.min(spec.rows, Math.ceil(items / perRow));
  return {
    size,
    gap,
    perRow,
    rows,
    places: Math.min(items, rows * perRow),
    justified: true,
  };
}

/**
 * A box to fill: the grid that covers most of it with whole rows wins,
 * within avatar sizes that read as faces (not dots, and not larger than the
 * banner's own subject).
 */
function filledShape(
  spec: AvatarGridSpec,
  items: number,
  maxHeight: number,
): Shape | null {
  const smallest = Math.round(spec.width / MOST_PER_ROW);
  const largest = Math.round(spec.width / FEWEST_PER_ROW);
  let best: (Shape & { covered: number }) | null = null;
  for (let perRow = 1; perRow <= items; perRow++) {
    // Solve width = perRow * size + (perRow - 1) * size / 6 for the size.
    const estimate = Math.floor((spec.width * 6) / (7 * perRow - 1));
    const gap = gapFor(estimate);
    const size = Math.floor((spec.width - (perRow - 1) * gap) / perRow);
    if (size > largest) continue;
    if (size < smallest) break;
    const rows = Math.min(
      spec.rows,
      Math.floor((maxHeight + gap) / (size + gap)),
      Math.floor(items / perRow),
    );
    if (rows < 1) continue;
    // A grid with a face for everyone needs no "+N": worth slightly smaller faces.
    const everyone = rows * perRow === items && spec.count === null;
    const covered = rows * perRow * size * size * (everyone ? 1.2 : 1);
    if (!best || covered > best.covered) {
      best = {
        size,
        gap,
        perRow,
        rows,
        places: rows * perRow,
        justified: true,
        covered,
      };
    }
  }
  if (best) return best;
  // Too few people for a full row at any size: one short row of faces, as
  // large as that many of them can be without filling the row.
  const size = Math.min(
    maxHeight,
    Math.max(
      largest,
      Math.round(spec.width / Math.max(FEWEST_FACES, items + 1.5)),
    ),
  );
  if (size < smallest) return null;
  const gap = gapFor(size);
  const perRow = Math.floor((spec.width + gap) / (size + gap));
  if (perRow < 1) return null;
  return {
    size,
    gap,
    perRow,
    rows: 1,
    places: Math.min(items, perRow),
    justified: false,
  };
}

/** The grid with how well it fills its box, for layouts that compare candidates. */
export interface AvatarGridPlan extends Block {
  /** 0 when the grid covers its box as well as it could; rises as it has to shrink. */
  strain: number;
}

/**
 * Plans the grid. Returns `null` when there is nobody to show or no room for
 * a single avatar.
 */
export function planAvatarGrid(
  ctx: Ctx,
  spec: AvatarGridSpec,
): AvatarGridPlan | null {
  const { ramp, palette, canvas } = ctx;
  const people = spec.people.filter(
    (person) => person && typeof person.avatarUrl === "string",
  );
  if (people.length === 0 || spec.width <= 0) return null;
  const wanted = Math.min(people.length, Math.max(1, spec.count ?? Infinity));
  const total = Math.max(people.length, spec.total ?? 0);
  // One more place for the "+N" chip when not everyone gets a face.
  const items = wanted + (total > wanted ? 1 : 0);
  const shape =
    spec.maxHeight !== null && spec.stretch
      ? filledShape(spec, items, spec.maxHeight)
      : naturalShape(ctx, spec, items);
  if (!shape) return null;
  const { size, gap, perRow, rows, places } = shape;
  const height = rows * size + (rows - 1) * gap;
  if (spec.maxHeight !== null && height > spec.maxHeight) return null;

  // The chip takes the last place whenever someone is left out, unless that
  // place is the only one: a lone "+N" would show nobody at all.
  const faces = total > places && places > 1 ? places - 1 : places;
  const hidden = total - faces;
  const rowWidth = perRow * size + (perRow - 1) * gap;
  const xOf = (col: number) =>
    shape.justified && perRow > 1
      ? Math.round((col * (spec.width - size)) / (perRow - 1))
      : col * (size + gap);
  const chip = hidden > 0 && faces < places ? `+${formatCount(hidden)}` : null;
  const chipSize = chip
    ? fitFontSize(
        chip,
        size - Math.round(size * 0.24),
        Math.round(size * 0.3),
        Math.min(canvas.minType, Math.round(size * 0.3)),
        { weight: ramp.strong, mono: ctx.font.id === "mono" },
      )
    : 0;

  const at = (x: number, y: number): Node[] => {
    const nodes: (Node | null)[] = [];
    for (let index = 0; index < places; index++) {
      const left = x + xOf(index % perRow);
      const top = y + Math.floor(index / perRow) * (size + gap);
      const person = index < faces ? people[index] : undefined;
      if (person) {
        nodes.push(
          image({
            src: ctx.image(person.avatarUrl, size),
            x: left,
            y: top,
            size,
            radius: size / 2,
            ring: palette.colors.border,
            ringWidth: ramp.hair,
            placeholder: palette.colors.surface,
          }),
        );
      } else if (chip) {
        nodes.push(
          box(left, top, size, size, {
            borderRadius: size / 2,
            backgroundColor: palette.colors.surface,
            border: `${ramp.hair}px solid ${palette.colors.border}`,
          }),
          textLine({
            x: left,
            y: top,
            width: size,
            text: chip,
            size: chipSize,
            line: size,
            weight: ramp.strong,
            color: palette.colors.muted,
            align: "center",
          }),
        );
      }
    }
    return compact(nodes);
  };

  const ideal =
    spec.width * spec.rows * Math.round(spec.width / FEWEST_PER_ROW) * 1.2;
  return {
    width: shape.justified ? spec.width : Math.min(spec.width, rowWidth),
    height,
    at,
    strain: spec.stretch
      ? 1 - Math.min(1, (places * size * size) / Math.max(1, ideal))
      : 0,
  };
}

/** Rows a card shows when `count` does not say how many people to show. */
const CARD_ROWS = { people: 1, contributors: 2 } as const;
/** Rows a fixed canvas may use, by how much detail the layout is giving up. */
const POSTER_ROWS = [3, 2, 1] as const;

export interface PeopleSpec {
  width: number;
  maxHeight: number | null;
  compact: 0 | 1 | 2;
  stretch?: boolean;
}

function rowsFor(
  ctx: Ctx,
  spec: PeopleSpec,
  section: keyof typeof CARD_ROWS,
): number {
  // Filling a box, the grid may use every row; otherwise the level decides.
  if (spec.maxHeight !== null)
    return POSTER_ROWS[spec.stretch ? 0 : spec.compact];
  // An explicit count may need more rows than a card shows by default.
  return ctx.options.count === null ? CARD_ROWS[section] : 30;
}

/** An organization's public members. `null` for anything else, and for a hidden roster. */
export function planPeople(ctx: Ctx, spec: PeopleSpec): AvatarGridPlan | null {
  const { entity } = ctx;
  if (entity.kind !== "org" || !Array.isArray(entity.people)) return null;
  return planAvatarGrid(ctx, {
    width: spec.width,
    maxHeight: spec.maxHeight,
    stretch: spec.maxHeight !== null && spec.stretch === true,
    people: entity.people,
    total: entity.stats?.members ?? null,
    count: ctx.options.count,
    rows: rowsFor(ctx, spec, "people"),
  });
}

/** A repository's contributors, the most active first. `null` for anything else. */
export function planContributors(
  ctx: Ctx,
  spec: PeopleSpec,
): AvatarGridPlan | null {
  const { entity } = ctx;
  if (entity.kind !== "repo" || !Array.isArray(entity.contributors)) {
    return null;
  }
  const byCommits = entity.contributors
    .filter((person) => person && typeof person === "object")
    .map((person, index) => ({ person, index }))
    .sort(
      (a, b) =>
        (b.person.contributions || 0) - (a.person.contributions || 0) ||
        a.index - b.index,
    )
    .map((entry) => entry.person);
  return planAvatarGrid(ctx, {
    width: spec.width,
    maxHeight: spec.maxHeight,
    stretch: spec.maxHeight !== null && spec.stretch === true,
    people: byCommits,
    total: entity.contributorCount ?? null,
    count: ctx.options.count,
    rows: rowsFor(ctx, spec, "contributors"),
  });
}
