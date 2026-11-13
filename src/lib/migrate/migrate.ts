/**
 * The README doctor: finds stat-card images that are dead or flaky and swaps
 * them for GitBanners URLs, touching nothing else.
 *
 * Pure and isomorphic: the page runs it in the browser, so a README never
 * leaves the visitor's machine.
 */
import { site } from "@/lib/site";
import { type ConvertContext, convertCard } from "./convert";
import { findImageUrls, type UrlContext } from "./scan";
import {
  CARD_NAMES,
  type CardKind,
  identifyCard,
  SERVICES,
  type ServiceHealth,
  type ServiceId,
} from "./services";

/**
 * - `replace`: the service is down; the doctor swaps the URL.
 * - `optional`: the service still answers; the swap is offered, not made.
 * - `flag`: there is no equivalent, or not enough to build one; left alone.
 */
export type ChangeAction = "replace" | "optional" | "flag";

export interface MigrationChange {
  /** Stable for one input: `change-1`, `change-2`… in order of position. */
  id: string;
  action: ChangeAction;
  /** Whether the output text carries the new URL. */
  applied: boolean;
  service: ServiceId;
  serviceName: string;
  health: ServiceHealth;
  card: CardKind;
  cardName: string;
  context: UrlContext;
  /** Offsets of the old URL in the input text. */
  start: number;
  end: number;
  /** 1-based line and column of the old URL in the input text. */
  line: number;
  column: number;
  /** The old URL as written. */
  from: string;
  /** The new URL as it is (or would be) written, `null` when there is none. */
  to: string | null;
  /** Why the doctor did what it did, in a sentence or two. */
  reason: string;
  /** What carried over, such as "theme=dracula → theme=dracula". */
  carried: readonly string[];
  /** Parameters with no equivalent, by name. */
  dropped: readonly string[];
}

export interface MigrateOptions {
  /** GitHub login used where a card URL names no user. */
  login?: string;
  /** Origin of the new URLs. Default: the canonical site URL. */
  origin?: string;
  /**
   * Optional swaps to make as well: `true` for all of them, or the ids of
   * the ones to make. Default: none.
   */
  acceptOptional?: boolean | ReadonlySet<string>;
}

export interface MigrationResult {
  /** The README with the changes applied. */
  markdown: string;
  /** Every recognised card, applied or not, in order of position. */
  changes: MigrationChange[];
}

function why(
  service: ServiceId,
  health: ServiceHealth,
  kind: CardKind,
): string {
  switch (service) {
    case "readme-stats":
      return kind === "wakatime" || kind === "gist"
        ? "The public github-readme-stats server is paused (it answers 503), so this card shows a broken image."
        : "The public github-readme-stats server is paused: it answers 503 and its README says it is no longer maintained, so this card shows a broken image.";
    case "readme-stats-copy":
      return "A copy of github-readme-stats on another host. It may still work, so switching is up to you.";
    case "trophy":
      return health === "down"
        ? "github-profile-trophy.vercel.app answers 402 (deployment disabled), so the trophy card shows a broken image."
        : "A copy of github-profile-trophy on another host. It may still work, so switching is up to you.";
    case "activity-graph":
      return health === "down"
        ? "The activity graph's server answers 402 (deployment disabled), and its earlier Heroku and Cyclic hosts are gone, so the graph shows a broken image."
        : "A copy of the activity graph on another host. It may still work, so switching is up to you.";
    case "gh-card":
      return "gh-card is discontinued: the card URL now answers with a web page instead of an image.";
    case "streak-stats":
      return health === "up"
        ? "The streak card's server still answers today, so switching is optional."
        : "A copy of the streak card on another host. It may still work, so switching is up to you.";
    case "summary-cards":
      return health === "up"
        ? "The summary cards' server still answers today, so switching is optional."
        : "A copy of the summary cards on another host. It may still work, so switching is up to you.";
  }
}

/**
 * Writes a URL so it survives the place it goes back into: characters that
 * would end a Markdown destination or an HTML attribute are percent-encoded,
 * and `&` becomes `&amp;` when the old URL was written that way.
 */
function escapeFor(url: string, original: string, context: UrlContext): string {
  // In a srcset a comma may read as the end of a candidate.
  const unsafe = context === "srcset" ? /[()'"<>\s,]/g : /[()'"<>\s]/g;
  const safe = url.replace(
    unsafe,
    (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
  return /&amp;/i.test(original) ? safe.replace(/&/g, "&amp;") : safe;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++)
    if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function position(starts: readonly number[], offset: number) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: offset - (starts[low] ?? 0) + 1 };
}

/**
 * Finds every recognised card URL in `markdown` and returns the README with
 * the dead ones replaced, plus a record of each card found.
 *
 * Idempotent: the new URLs are not card URLs, so running the doctor on its
 * own output changes nothing.
 */
export function migrateReadme(
  markdown: string,
  options: MigrateOptions = {},
): MigrationResult {
  const origin = (options.origin ?? site.url).replace(/\/+$/, "");
  const accept = options.acceptOptional ?? false;
  const starts = lineStarts(markdown);
  const changes: MigrationChange[] = [];

  for (const found of findImageUrls(markdown)) {
    const match = identifyCard(found.raw);
    if (!match) continue;
    const id = `change-${changes.length + 1}`;
    const context: ConvertContext = {
      origin,
      login: options.login,
      mode: found.mode,
    };
    const converted = convertCard(match, context);
    const base = {
      id,
      service: match.service,
      serviceName: SERVICES[match.service].name,
      health: match.health,
      card: match.kind,
      cardName: CARD_NAMES[match.kind],
      context: found.context,
      start: found.start,
      end: found.end,
      ...position(starts, found.start),
      from: found.raw,
    };
    if (!converted.ok) {
      changes.push({
        ...base,
        action: "flag",
        applied: false,
        to: null,
        reason:
          match.health === "down"
            ? `${why(match.service, match.health, match.kind)} ${converted.reason}`
            : converted.reason,
        carried: [],
        dropped: [],
      });
      continue;
    }
    const action: ChangeAction =
      match.health === "down" ? "replace" : "optional";
    const applied =
      action === "replace" ||
      accept === true ||
      (accept instanceof Set && accept.has(id));
    const notes =
      converted.notes.length > 0 ? ` ${converted.notes.join(" ")}` : "";
    changes.push({
      ...base,
      action,
      applied,
      to: escapeFor(converted.url, found.raw, found.context),
      reason: `${why(match.service, match.health, match.kind)}${notes}`,
      carried: converted.carried,
      dropped: converted.dropped,
    });
  }

  let output = markdown;
  // From the end, so earlier offsets stay valid.
  for (const change of [...changes].reverse()) {
    if (!change.applied || change.to === null) continue;
    output =
      output.slice(0, change.start) + change.to + output.slice(change.end);
  }
  return { markdown: output, changes };
}
