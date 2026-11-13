"use no memo";

import {
  boxOf,
  type Ctx,
  finePrint,
  textLineHeight,
  titleLine,
  widthOf,
  withRamp,
} from "@/lib/banner/context";
import {
  baselineOffset,
  box,
  compact,
  image,
  type Node,
  textBlock,
  textLine,
} from "@/lib/banner/draw";
import type { Layout } from "@/lib/banner/layout/types";
import { fitFontSize } from "@/lib/banner/metrics";
import {
  brandOf,
  brandTop,
  fitBrand,
  planBrand,
} from "@/lib/banner/sections/footer";
import { type Identity, identityOf } from "@/lib/banner/sections/header";
import { segmentWidths, sharesOf } from "@/lib/banner/sections/languages";
import {
  drawPill,
  labelColors,
  pillMetrics,
  pillWidth,
} from "@/lib/banner/sections/pill";
import { planTiles, tilesThatFit } from "@/lib/banner/sections/tiles";
import { statIds, statTiles } from "@/lib/banner/stats";
import type { SectionId } from "@/lib/banner/types";

/**
 * The repository social preview: a poster, not a card.
 *
 * GitHub shows this image wherever a repository link is unfurled, usually at
 * a third of its size, so it is built like a title page: the owner's avatar
 * and a line of facts on top, the name as large as its length allows, the
 * description, the numbers at the bottom, and the language mix as a strip
 * along the bottom edge. Measures are those of the 1280 x 640 reference,
 * scaled to the canvas.
 */

/** The canvas the measures below were drawn for. */
const REFERENCE = { width: 1280, height: 640 } as const;
/** From the top edge to the avatar. */
const MARGIN = 64;
const AVATAR = 96;
const META_TYPE = 24;
const TITLE_TYPE = 72;
/** The name shrinks to fit its line, but not below this; then it is cut. */
const TITLE_FLOOR = 44;
const DESCRIPTION_TYPE = 30;
const VALUE_TYPE = 40;
const LABEL_TYPE = 20;
const STRIP = 20;
/** From the title's baseline to the description's. */
const TITLE_TO_DESCRIPTION = 62;
/** From the labels' baseline to the strip (or to where it would be). */
const LABELS_TO_STRIP = 68;
const SEPARATOR = " · ";
/** Languages the strip shows before the rest becomes "Other", unless `count` says. */
const STRIP_LANGUAGES = 6;
/** Sections this layout knows how to draw. With any other it steps aside. */
const DRAWN: ReadonlySet<SectionId> = new Set(["header", "stats", "languages"]);
/** Below this scale poster type stops being poster type. */
const SMALLEST_SCALE = 0.55;
/**
 * Share of the free height that goes above the title: it sits high, like a
 * headline. On the reference canvas this puts its baseline at 268.
 */
const TITLE_RISE = 0.22;

/** The canvas as the poster measures it. */
interface Poster {
  ctx: Ctx;
  /** The context of the numbers row: tiles, state pills and the brand mark at the poster's scale. */
  small: Ctx;
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  /** Width between the side margins. */
  room: number;
  /** A reference measure in canvas pixels. */
  px(value: number): number;
  /**
   * A reference type size for what stands alone (avatar, name, description):
   * scaled like `px`, and larger on canvases taller than the reference.
   */
  display(value: number): number;
  /** How much larger: 1 on the reference's 2:1, 1.4 on a square. */
  lift: number;
}

/** A part of the poster: its leaves and the edge the next part starts from. */
interface Part {
  nodes: (Node | null)[];
  /** Top edge of a part at the bottom, bottom edge of a part at the top. */
  edge: number;
}

function posterOf(ctx: Ctx): Poster | null {
  const { canvas } = ctx;
  const width = canvas.width;
  const height = canvas.height ?? 0;
  // A little generous on width: a link preview (1200 x 630) is the same
  // poster, not a 6% smaller one.
  const scale = Math.min(
    (width / REFERENCE.width) * 1.05,
    height / REFERENCE.height,
  );
  const left = canvas.inset.left;
  const right = width - canvas.inset.right;
  if (scale < SMALLEST_SCALE || right <= left) return null;
  const px = (value: number) => Math.round(value * scale);
  // A canvas taller than 2:1 has height to spare, while its width still
  // limits everything set in a row. What stands alone grows into it.
  const lift = Math.min(1.5, Math.max(1, Math.sqrt((2 * height) / width)));
  // The tiles are the engine's own: labels at the smallest type of the
  // canvas, numbers twice that, as in the reference.
  const scaled = withRamp(ctx, Math.max(canvas.minType, px(LABEL_TYPE)));
  return {
    ctx,
    small: {
      ...scaled,
      ramp: {
        ...scaled.ramp,
        title: Math.max(px(VALUE_TYPE), scaled.ramp.small * 2),
      },
    },
    width,
    height,
    left,
    right,
    top: Math.max(canvas.inset.top, px(MARGIN)),
    room: right - left,
    px,
    display: (value) =>
      Math.max(canvas.minType, Math.round(value * scale * lift)),
    lift,
  };
}

/**
 * The language mix along the bottom edge, full bleed. On a rounded canvas a
 * strip along the edge would poke out of the corners: there it becomes a
 * slimmer bar inside the margins. `edge` is its top (the canvas' bottom
 * without languages).
 */
function planStrip(p: Poster, wanted: boolean): Part & { inset: boolean } {
  const { canvas, ramp } = p.ctx;
  const shares = wanted
    ? sharesOf(p.ctx, Math.max(1, p.ctx.options.count ?? STRIP_LANGUAGES))
    : [];
  const inset = canvas.radius > 0;
  if (shares.length === 0) return { nodes: [], edge: p.height, inset };
  const thickness = Math.round(p.px(STRIP) * (inset ? 0.6 : 1));
  const top = inset
    ? p.height - Math.round(canvas.inset.bottom * 0.6) - thickness
    : p.height - thickness;
  const gap = inset ? Math.max(2, ramp.hair * 2) : 0;
  const widths = segmentWidths(shares, inset ? p.room : p.width, gap);
  const round = thickness / 2;
  let cursor = inset ? p.left : 0;
  const nodes = shares.map((share, index) => {
    const first = index === 0;
    const last = index === shares.length - 1;
    const node = box(cursor, top, widths[index] ?? 0, thickness, {
      backgroundColor: share.color,
      // Only the bar inside the margins has ends to round.
      ...(inset
        ? {
            borderTopLeftRadius: first ? round : 0,
            borderBottomLeftRadius: first ? round : 0,
            borderTopRightRadius: last ? round : 0,
            borderBottomRightRadius: last ? round : 0,
          }
        : null),
    });
    cursor += (widths[index] ?? 0) + gap;
    return node;
  });
  return { nodes, edge: top, inset };
}

/**
 * The numbers above the strip, with the brand mark on their label line, or
 * on a line below them when it finds no room there. The labels' baseline is
 * where the reference has it, with or without a strip, so a repository whose
 * languages are still unknown is laid out like any other. `edge` is the top
 * of the row.
 */
function planNumbers(
  p: Poster,
  wanted: boolean,
  strip: Part & { inset: boolean },
): Part {
  const { ctx, small } = p;
  const { canvas, entity } = ctx;
  const all = wanted
    ? statTiles(entity, statIds(entity, ctx.options), ctx.now)
    : [];
  const tiles = all.slice(0, tilesThatFit(small, all, p.room));
  const brand = brandOf(ctx);
  const spacing = small.ramp.small * 2;
  const full = fitBrand(small, brand, p.room, true);
  const plan = planTiles(small, tiles, {
    width: p.room,
    align: "left",
    keepFree: full ? full.width + spacing : 0,
  });
  const markLine = Math.round(finePrint(small) * 1.4);
  const anchored = strip.inset && strip.edge < p.height;
  const baseline = Math.min(
    (anchored ? strip.edge : p.height - p.px(STRIP)) - p.px(LABELS_TO_STRIP),
    // Never inside the bottom margin.
    p.height - canvas.inset.bottom - Math.round(finePrint(small) * 0.3),
  );
  const markAt = (mark: { text: string; width: number }, top: number) =>
    planBrand(small, mark.text, mark.width).at(p.right - mark.width, top);

  if (!plan) {
    const mark = fitBrand(small, brand, p.room);
    const top = brandTop(small, baseline);
    return mark
      ? { nodes: markAt(mark, top), edge: top }
      : { nodes: [], edge: Math.min(strip.edge, baseline + markLine) };
  }
  const beside = fitBrand(small, brand, p.room - plan.tailX - spacing);
  const below = beside ? null : fitBrand(small, brand, p.room);
  const top = Math.round(
    baseline -
      plan.labelBaseline -
      (below ? markLine + Math.round(small.ramp.small * 0.9) : 0),
  );
  return {
    edge: top,
    nodes: [
      ...plan.at(p.left, top),
      ...(beside
        ? markAt(beside, top + brandTop(small, plan.labelBaseline))
        : []),
      ...(below ? markAt(below, brandTop(small, baseline)) : []),
    ],
  };
}

/**
 * The top row: the owner's avatar on the left; on the right the facts
 * (language, licence, release), as many whole ones as fit, with the state
 * pills before them. `edge` is the bottom of the row.
 */
function planHead(p: Poster, identity: Identity): Part {
  const { ctx, small } = p;
  const { palette } = ctx;
  const avatar = ctx.hide.has("avatar") ? 0 : Math.round(p.px(AVATAR) * p.lift);
  const size = p.display(META_TYPE);
  const line = textLineHeight(size);
  const height = Math.max(avatar, line);
  const from = p.left + (avatar ? avatar + size : 0);
  const facts: string[] = [];
  for (const fact of identity.facts) {
    const next = [...facts, fact.text].join(SEPARATOR);
    if (widthOf(ctx, next, size) > p.right - from - 2) break;
    facts.push(fact.text);
  }
  const meta = facts.join(SEPARATOR);
  const metaWidth = meta ? boxOf(ctx, meta, size) : 0;
  const nodes: (Node | null)[] = [
    avatar
      ? image({
          src: ctx.image(identity.avatarUrl, avatar),
          x: p.left,
          y: p.top,
          size: avatar,
          radius: identity.round ? avatar / 2 : Math.round(avatar / 8),
          ring: palette.colors.border,
          ringWidth: ctx.ramp.hair,
          placeholder: palette.colors.surface,
        })
      : null,
    textLine({
      x: p.right - metaWidth,
      y: p.top + Math.round((height - line) / 2),
      width: metaWidth,
      text: meta,
      size,
      line,
      color: palette.colors.muted,
      align: "right",
    }),
  ];
  // Pills from the right, so the last state sits next to the facts.
  const pill = pillMetrics(small, "label");
  let end = p.right - metaWidth - (metaWidth ? size : 0);
  for (const label of [...identity.labels].reverse()) {
    const own = pillWidth(small, label.text, pill);
    if (end - own < from) break;
    nodes.push(
      ...drawPill(
        small,
        label.text,
        end - own,
        p.top + Math.round((height - pill.height) / 2),
        own,
        pill,
        labelColors(ctx, label.color),
      ),
    );
    end -= own + pill.gap;
  }
  return { nodes, edge: p.top + height };
}

/**
 * The name, as large as it fits, and the description under it, placed in
 * the space between `from` and `to`. `owner/name` shares a line while it
 * fits at the smallest size; a longer one is set the way GitHub's own cards
 * set it, the owner on a quiet line of its own and the whole width for the
 * name. `null` when the space is too low for a poster.
 */
function planTitle(
  p: Poster,
  identity: Identity,
  from: number,
  to: number,
): (Node | null)[] | null {
  const { ctx } = p;
  const { canvas, palette, ramp } = ctx;
  const fitting = { weight: ramp.strong, mono: ctx.font.id === "mono" };
  const smallest = Math.max(canvas.minType, p.px(TITLE_FLOOR));
  const whole = identity.title.map((run) => run.text).join("");
  const [owner, ...name] = identity.title;
  const stacked =
    owner !== undefined &&
    name.length > 0 &&
    widthOf(ctx, whole, smallest, ramp.strong) > p.room;
  const title = stacked ? name : identity.title;
  const titleSize = fitFontSize(
    title.map((run) => run.text).join(""),
    p.room,
    p.display(TITLE_TYPE),
    smallest,
    fitting,
  );
  const titleHeight = titleLine(titleSize);
  const quiet = p.display(DESCRIPTION_TYPE);
  const quietLine = textLineHeight(quiet);
  const ownerSpace = stacked ? quietLine : 0;
  const description = ctx.hide.has("bio") ? null : identity.bio;
  const lines = description
    ? Math.min(
        2,
        Math.max(
          1,
          Math.ceil((widthOf(ctx, description, quiet) * 1.04) / p.room),
        ),
      )
    : 0;
  // Baseline to baseline, as in the reference; never closer than the two
  // line boxes allow.
  const descriptionTop = Math.max(
    titleHeight,
    Math.round(
      baselineOffset(titleSize, titleHeight) +
        p.px(TITLE_TO_DESCRIPTION) * p.lift -
        baselineOffset(quiet, quietLine),
    ),
  );
  const height =
    ownerSpace + (lines ? descriptionTop + lines * quietLine : titleHeight);
  const free = to - from - height;
  if (free < p.display(META_TYPE)) return null;
  const top = from + Math.round(free * TITLE_RISE);
  return [
    stacked && owner
      ? textLine({
          x: p.left,
          y: top,
          width: p.room,
          text: owner.text,
          size: quiet,
          line: quietLine,
          color: palette.colors.muted,
        })
      : null,
    textLine({
      x: p.left,
      y: top + ownerSpace,
      width: p.room,
      text: title,
      size: titleSize,
      line: titleHeight,
      weight: ramp.strong,
      color: palette.colors.text,
    }),
    description
      ? textBlock({
          x: p.left,
          y: top + ownerSpace + descriptionTop,
          width: p.room,
          text: description,
          size: quiet,
          line: quietLine,
          lines,
          color: palette.colors.muted,
        })
      : null,
  ];
}

/**
 * Lays the poster out, or returns `null` when it does not apply: other
 * kinds and presets, canvases that follow their content or have a
 * profile-photo zone, extra sections, or a canvas too small for it. The
 * caller then falls back to the general layout, which handles all of those.
 */
export function layoutSocial(
  ctx: Ctx,
  sections: readonly SectionId[],
): Layout | null {
  const { canvas, entity } = ctx;
  if (entity.kind !== "repo" || ctx.options.preset !== "social") return null;
  if (canvas.height === null || canvas.safeZone) return null;
  if (!sections.includes("header") || sections.some((id) => !DRAWN.has(id))) {
    return null;
  }
  const poster = posterOf(ctx);
  if (!poster) return null;
  const identity = identityOf(ctx);
  const strip = planStrip(poster, sections.includes("languages"));
  const numbers = planNumbers(poster, sections.includes("stats"), strip);
  const head = planHead(poster, identity);
  const title = planTitle(poster, identity, head.edge, numbers.edge);
  if (!title) return null;
  return {
    width: poster.width,
    height: poster.height,
    nodes: compact([...strip.nodes, ...numbers.nodes, ...head.nodes, ...title]),
    heatmap: null,
  };
}
