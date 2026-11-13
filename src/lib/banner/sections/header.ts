"use no memo";

import {
  type Block,
  boxOf,
  type Ctx,
  textLineHeight,
  titleLine,
  widthOf,
} from "@/lib/banner/context";
import {
  baselineOffset,
  box,
  CAP_HEIGHT,
  capOffset,
  compact,
  image,
  type Node,
  type TextRun,
  textBlock,
  textLine,
} from "@/lib/banner/draw";
import { parseIsoDate } from "@/lib/banner/format";
import { fitFontSize } from "@/lib/banner/metrics";
import { normalizeHex } from "@/lib/banner/options";
import {
  drawPill,
  labelColors,
  type PillMetrics,
  pillMetrics,
  pillWidth,
  topicColors,
} from "@/lib/banner/sections/pill";
import { showsStat } from "@/lib/banner/stats";
import { plainText } from "@/lib/banner/text";

/**
 * The identity block: avatar, name with its state labels, handle with a few
 * facts, bio, topics.
 *
 * Every kind of entity is first reduced to the same `Identity`, so the
 * drawing code does not care whether it shows a person, an organization or a
 * repository.
 */

export interface Fact {
  text: string;
  /** Defaults to the muted colour. */
  color?: string;
  /** Colour of the dot in front of the text: a repository's language. */
  dot?: string;
}

/** A state pill beside the name: "Archived", "Fork", "Verified". */
export interface Label {
  text: string;
  color: string;
}

/** Who a banner is about, whatever kind of entity that is. */
export interface Identity {
  avatarUrl: string | null;
  /** Users are circles, organizations rounded squares. */
  round: boolean;
  /** The headline, possibly in two tones (`owner/` + `name`). */
  title: TextRun[];
  /** What stays on the second line whatever happens: the @handle. */
  handle: Fact | null;
  /** Facts that follow the handle while there is room, most useful first. */
  facts: Fact[];
  /** State pills that follow the headline. */
  labels: Label[];
  bio: string | null;
  /** Topic pills under the bio. */
  topics: string[];
}

/** GitHub shows a handful of topics before "+ more"; a banner keeps to one row of them. */
const MAX_TOPICS = 4;
/** What GitHub answers for a licence file it cannot classify: not worth a place on a banner. */
const UNKNOWN_LICENSE = "NOASSERTION";

const SEPARATOR = " · ";

function hostOf(url: string | null | undefined): string {
  return plainText(url)
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/[/?#].*$/, "");
}

function facts(items: (Fact | string | null | false)[]): Fact[] {
  const list: Fact[] = [];
  for (const item of items) {
    if (item === null || item === false) continue;
    const fact = typeof item === "string" ? { text: plainText(item) } : item;
    if (fact.text) list.push(fact);
  }
  return list;
}

function topicsOf(ctx: Ctx, topics: unknown): string[] {
  if (ctx.hide.has("topics") || !Array.isArray(topics)) return [];
  return topics.map(plainText).filter(Boolean).slice(0, MAX_TOPICS);
}

/** Reduces the banner's entity to what an identity block shows. */
export function identityOf(ctx: Ctx): Identity {
  const { entity, palette, ramp, hide } = ctx;
  const strong = { color: palette.colors.text, weight: ramp.strong };
  if (entity.kind === "repo") {
    const language = plainText(entity.language?.name);
    const license = plainText(entity.license);
    return {
      avatarUrl: entity.owner.avatarUrl,
      round: entity.owner.kind === "user",
      title: [
        {
          text: `${plainText(entity.owner.login)}/`,
          color: palette.colors.muted,
          weight: 400,
        },
        { text: plainText(entity.name), ...strong },
      ],
      handle: null,
      facts: hide.has("meta")
        ? []
        : facts([
            language
              ? {
                  text: language,
                  dot:
                    normalizeHex(entity.language?.color) ??
                    palette.colors.muted,
                }
              : null,
            license === UNKNOWN_LICENSE ? null : license,
            // A release tile already carries the tag, larger and with its date.
            showsStat(entity, ctx.options, "release")
              ? null
              : (entity.latestRelease?.tag ?? null),
          ]),
      labels: [
        ...(entity.isArchived
          ? [{ text: "Archived", color: palette.warning }]
          : []),
        ...(entity.isFork
          ? [{ text: "Fork", color: palette.colors.muted }]
          : []),
      ],
      bio: hide.has("description")
        ? null
        : plainText(entity.description) || null,
      topics: topicsOf(ctx, entity.topics),
    };
  }
  const login = plainText(entity.login);
  const name = plainText(entity.name) || login;
  // Without a display name the login already is the headline: no need to
  // print it twice.
  const handle =
    name.toLowerCase() === login.toLowerCase() ? null : { text: `@${login}` };
  if (entity.kind === "org") {
    return {
      avatarUrl: entity.avatarUrl,
      round: false,
      title: [{ text: name, ...strong }],
      handle,
      facts: hide.has("meta")
        ? []
        : facts([entity.location, hostOf(entity.websiteUrl)]),
      labels: entity.isVerified
        ? [{ text: "Verified", color: palette.success }]
        : [],
      bio: plainText(entity.description) || null,
      topics: [],
    };
  }
  const joined = parseIsoDate(entity.createdAt)?.year;
  return {
    avatarUrl: entity.avatarUrl,
    round: true,
    title: [{ text: name, ...strong }],
    handle,
    facts: hide.has("meta")
      ? []
      : facts([
          entity.location,
          entity.company,
          joined ? `Joined ${joined}` : null,
        ]),
    labels: [],
    bio: plainText(entity.bio) || null,
    topics: [],
  };
}

/** The second line of the identity, ready to draw. */
interface SecondLine {
  runs: TextRun[];
  /** Colour of the dot in front of the first run, when that run is a language. */
  dot: string | null;
  /** Width the dot and its gap take before the text. */
  lead: number;
  dotSize: number;
}

/**
 * The second line: the handle, then as many whole facts as fit. A fact is
 * never cut in half; one that does not fit is skipped and the next is tried.
 * A language keeps its Linguist dot only at the start of the line, where its
 * place does not depend on how wide the renderer sets the text before it.
 */
function secondLine(
  ctx: Ctx,
  identity: Identity,
  size: number,
  width: number,
): SecondLine {
  const { muted } = ctx.palette.colors;
  const separator = widthOf(ctx, SEPARATOR, size);
  const dotSize = Math.round(size * 0.8);
  const dotLead = dotSize + Math.round(size * 0.45);
  const runs: TextRun[] = [];
  let dot: string | null = null;
  let used = 0;
  const all = identity.handle
    ? [identity.handle, ...identity.facts]
    : identity.facts;
  all.forEach((fact, index) => {
    const mandatory = index === 0 && identity.handle !== null;
    const leads = runs.length === 0 && fact.dot !== undefined;
    const needed =
      widthOf(ctx, fact.text, size) +
      (runs.length ? separator : 0) +
      (leads ? dotLead : 0);
    if (!mandatory && used + needed > width - 2) return;
    if (runs.length) runs.push({ text: SEPARATOR, color: muted });
    if (leads) dot = fact.dot ?? null;
    runs.push({ text: fact.text, color: fact.color ?? muted });
    used += needed;
  });
  return { runs, dot, lead: dot ? dotLead : 0, dotSize };
}

/** GitHub rounds organization avatars by 6 px up to 100 px, and in proportion above. */
export function squareRadius(size: number): number {
  return Math.max(
    Math.round(size * 0.06),
    Math.min(6, Math.round(size * 0.16)),
  );
}

/** A row of pills that fit their box, with the width they take together. */
interface PillRow {
  items: { text: string; width: number; color: string }[];
  width: number;
  m: PillMetrics;
}

/**
 * As many of `texts` as fit `room` side by side, in order. It stops at the
 * first that does not fit: a pill is never cut, and skipping one to show a
 * later one would reorder what the owner chose.
 */
function pillRow(
  ctx: Ctx,
  kind: "label" | "topic",
  entries: readonly { text: string; color: string }[],
  room: number,
): PillRow | null {
  const m = pillMetrics(ctx, kind);
  const items: PillRow["items"] = [];
  let width = 0;
  for (const entry of entries) {
    const own = pillWidth(ctx, entry.text, m);
    const next = width + (items.length ? m.gap : 0) + own;
    if (next > room) break;
    items.push({ text: entry.text, width: own, color: entry.color });
    width = next;
  }
  return items.length ? { items, width, m } : null;
}

export interface HeaderSpec {
  width: number;
  /** Width kept free on the right of the name and handle lines (merged tiles, a headline number). */
  reserve: number;
  /** Lines the bio may take; 0 hides it, and the topics with it. */
  bioLines: number;
}

export interface HeaderPlan extends Block {
  /** Top of the name's line box, relative to the block: things beside the name align to it. */
  titleTop: number;
  /**
   * Bottom of the lowest line box, relative to the block. The block's height
   * ends where the ink does (so the space under it looks even), which is a
   * few pixels above this: a box that must hold every line box, such as the
   * strip above a profile photo, has to be at least this tall.
   */
  extent: number;
  /**
   * How much the name had to give to fit its line: 0 when it is set at full
   * size, up to 1 when it is shrunk to the floor and still cut.
   */
  strain: number;
}

/** Usual avatar edge for the current type scale. */
export function avatarSize(ctx: Ctx): number {
  const { small } = ctx.ramp;
  return Math.round(
    ctx.canvas.chrome === "card" ? (small * 14) / 3 : small * 3,
  );
}

/** Where the text column starts: after the avatar, when there is one. */
function textStart(ctx: Ctx): { avatar: number; textX: number } {
  const { ramp } = ctx;
  const avatar = ctx.hide.has("avatar") ? 0 : avatarSize(ctx);
  const gap = ctx.canvas.chrome === "card" ? 4 / 3 : 0.85;
  return { avatar, textX: avatar ? avatar + Math.round(ramp.small * gap) : 0 };
}

/** Space between the name and the first state pill after it. */
function labelLead(ctx: Ctx): number {
  return Math.round(ctx.ramp.small * 0.67);
}

/** Width the state pills want after the name, lead included; 0 without pills. */
function labelsWidth(ctx: Ctx, identity: Identity): number {
  const row = pillRow(ctx, "label", identity.labels, Number.POSITIVE_INFINITY);
  return row ? row.width + labelLead(ctx) : 0;
}

/**
 * Width the identity wants when nothing limits it: the avatar, then the
 * wider of the name (with its state pills) and the handle. The facts after
 * the handle do not count: they come and go with the room there is.
 */
export function identityWidth(ctx: Ctx): number {
  const { ramp } = ctx;
  const identity = identityOf(ctx);
  const { textX } = textStart(ctx);
  const title = identity.title.map((run) => run.text).join("");
  const name =
    boxOf(ctx, title, ramp.title, ramp.strong) + labelsWidth(ctx, identity);
  const handle = identity.handle
    ? boxOf(ctx, identity.handle.text, ramp.body)
    : 0;
  return textX + Math.max(name, handle);
}

/**
 * Width that tiles or a headline number may take beside the name, once the
 * name has what it needs: its full width (state pills included) when that is
 * modest, never more than 55% of the line. A long `owner/repository` title
 * therefore sends the tiles to a row of their own instead of being cut to
 * make room for them.
 *
 * With `squeeze` the name only keeps its minimum: for layouts that have no
 * other place for what goes beside it.
 */
export function roomBesideName(
  ctx: Ctx,
  width: number,
  squeeze = false,
): number {
  const { ramp } = ctx;
  const { textX } = textStart(ctx);
  const line = Math.max(0, width - textX);
  const identity = identityOf(ctx);
  const title = identity.title.map((run) => run.text).join("");
  const least = ramp.small * 10;
  const natural =
    boxOf(ctx, title, ramp.title, ramp.strong) + labelsWidth(ctx, identity);
  const needed = squeeze
    ? least
    : Math.min(Math.max(natural, least), Math.round(line * 0.55));
  return Math.max(0, line - needed - ramp.small * 2);
}

/** Plans the identity block for a box of the given width. */
export function planHeader(ctx: Ctx, spec: HeaderSpec): HeaderPlan {
  const { ramp, palette, hide } = ctx;
  const identity = identityOf(ctx);
  const { avatar, textX } = textStart(ctx);
  const lineWidth = Math.max(0, spec.width - textX - spec.reserve);

  const nameLine = titleLine(ramp.title);
  const fitting = { weight: ramp.strong, mono: ctx.font.id === "mono" };
  const floor = Math.round(ramp.title * 0.72);
  const whole = identity.title.map((run) => run.text).join("");
  // `owner/name` that would be cut even at the smallest size gives up the
  // owner, not the end of the name: the name is what the banner is about.
  // The owner moves to the head of the facts.
  const [prefix, ...rest] = identity.title;
  const dropped =
    prefix !== undefined &&
    rest.length > 0 &&
    widthOf(ctx, whole, floor, ramp.strong) > lineWidth
      ? prefix
      : null;
  const title = dropped ? rest : identity.title;
  const titleText = title.map((run) => run.text).join("");
  // State pills follow the name, in the room it leaves at its full size: a
  // name is never shrunk or cut to make room for one.
  const lead = labelLead(ctx);
  const labels = pillRow(
    ctx,
    "label",
    identity.labels,
    lineWidth - lead - boxOf(ctx, titleText, ramp.title, ramp.strong),
  );
  const titleRoom = lineWidth - (labels ? labels.width + lead : 0);
  const nameSize = fitFontSize(
    titleText,
    titleRoom,
    ramp.title,
    floor,
    fitting,
  );
  // With pills after it the name's box ends where its text does.
  const nameWidth = labels
    ? Math.min(titleRoom, boxOf(ctx, titleText, nameSize, ramp.strong))
    : lineWidth;
  const subSize = ramp.body;
  const subLine = textLineHeight(subSize);
  // What found no room on the name's line is still said, at the head of the
  // facts: the owner, then the states (in their colours).
  const displaced: Fact[] = [
    ...(dropped ? [{ text: dropped.text.replace(/\/$/, "") }] : []),
    ...identity.labels.slice(labels?.items.length ?? 0),
  ];
  const sub = secondLine(
    ctx,
    { ...identity, facts: [...displaced, ...identity.facts] },
    subSize,
    lineWidth,
  );
  const subTop = nameLine + ramp.lead;

  const bioSize = ramp.body;
  const bioLine = textLineHeight(bioSize);
  const bioWidth = Math.max(0, spec.width - textX);
  const bio = !hide.has("bio") && spec.bioLines > 0 ? identity.bio : null;
  const bioEstimate = bio ? widthOf(ctx, bio, bioSize) * 1.04 : 0;
  const bioLines = bio
    ? Math.max(
        1,
        Math.min(spec.bioLines, Math.ceil(bioEstimate / Math.max(1, bioWidth))),
      )
    : 0;
  // What sits beside the name (tiles, a headline number) is two lines tall:
  // the bio starts below both, even when the identity has no second line.
  const linesBottom =
    sub.runs.length || spec.reserve > 0 ? subTop + subLine : nameLine;
  const bioTop = linesBottom + Math.round(ramp.small / 3);
  const topics =
    spec.bioLines > 0
      ? pillRow(
          ctx,
          "topic",
          identity.topics.map((text) => ({ text, color: palette.link })),
          bioWidth,
        )
      : null;
  const topicsTop =
    (bioLines ? bioTop + bioLines * bioLine : linesBottom) +
    Math.round(ramp.small * 0.67);

  // Centre the ink of name + handle (cap top to descender) on the avatar.
  const inkTop = capOffset(ramp.title, nameLine);
  const inkBottom = sub.runs.length
    ? subTop + baselineOffset(subSize, subLine) + subSize * 0.2
    : baselineOffset(ramp.title, nameLine) + ramp.title * 0.1;
  const titleTop = Math.round(
    avatar ? (avatar - (inkBottom - inkTop)) / 2 - inkTop : -inkTop,
  );
  const contentBottom = topics
    ? topicsTop + topics.m.height
    : bioLines
      ? bioTop + bioLines * bioLine
      : Math.ceil(inkBottom);
  const height = Math.max(avatar, titleTop + contentBottom);
  // A shrunk name keeps the baseline of a full-size one: its line box loses
  // height from the top only, so it never reaches into the line below.
  const nameShift = Math.round(
    2 *
      (baselineOffset(ramp.title, nameLine) -
        baselineOffset(nameSize, nameLine)),
  );
  // State pills sit on the middle of the name's capitals.
  const capMiddle =
    baselineOffset(ramp.title, nameLine) - (CAP_HEIGHT * nameSize) / 2;

  const at = (x: number, y: number): Node[] => {
    const nodes: (Node | null)[] = [
      avatar
        ? image({
            src: ctx.image(identity.avatarUrl, avatar),
            x,
            y,
            size: avatar,
            radius: identity.round ? avatar / 2 : squareRadius(avatar),
            ring: palette.colors.border,
            ringWidth: ramp.hair,
            placeholder: palette.colors.surface,
          })
        : null,
      textLine({
        x: x + textX,
        y: y + titleTop + nameShift,
        width: nameWidth,
        text: title,
        size: nameSize,
        line: nameLine - nameShift,
        weight: ramp.strong,
        color: palette.colors.text,
      }),
      sub.dot
        ? box(
            x + textX,
            y + titleTop + subTop + Math.round((subLine - sub.dotSize) / 2),
            sub.dotSize,
            sub.dotSize,
            { borderRadius: sub.dotSize / 2, backgroundColor: sub.dot },
          )
        : null,
      textLine({
        x: x + textX + sub.lead,
        y: y + titleTop + subTop,
        width: lineWidth - sub.lead,
        text: sub.runs,
        size: subSize,
        line: subLine,
        color: palette.colors.muted,
      }),
      bio
        ? textBlock({
            x: x + textX,
            y: y + titleTop + bioTop,
            width: bioWidth,
            text: bio,
            size: bioSize,
            line: bioLine,
            lines: bioLines,
            color: palette.colors.text,
          })
        : null,
    ];
    if (labels) {
      let cursor = x + textX + nameWidth + lead;
      // Never below the name's line box: the line under it starts there.
      const top =
        y +
        titleTop +
        Math.max(
          0,
          Math.min(
            Math.round(capMiddle - labels.m.height / 2),
            nameLine - labels.m.height,
          ),
        );
      for (const item of labels.items) {
        nodes.push(
          ...drawPill(
            ctx,
            item.text,
            cursor,
            top,
            item.width,
            labels.m,
            labelColors(ctx, item.color),
          ),
        );
        cursor += item.width + labels.m.gap;
      }
    }
    if (topics) {
      let cursor = x + textX;
      for (const item of topics.items) {
        nodes.push(
          ...drawPill(
            ctx,
            item.text,
            cursor,
            y + titleTop + topicsTop,
            item.width,
            topics.m,
            topicColors(ctx),
          ),
        );
        cursor += item.width + topics.m.gap;
      }
    }
    return compact(nodes);
  };

  const cut =
    widthOf(ctx, titleText, nameSize, ramp.strong) > titleRoom ? 0.5 : 0;
  // The description of a repository or an organization says what the banner
  // is about: type that grows until it is cut has grown too far. (A person's
  // bio is a tagline; an ellipsis there is no loss worth smaller type.)
  const clipped =
    ctx.entity.kind !== "user" && bio && bioEstimate > bioLines * bioWidth
      ? 0.25
      : 0;
  return {
    width: spec.width,
    height,
    at,
    titleTop,
    extent: Math.max(
      height,
      titleTop + (sub.runs.length ? subTop + subLine : nameLine),
    ),
    strain: (ramp.title - nameSize) / ramp.title + cut + clipped,
  };
}
