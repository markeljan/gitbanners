/**
 * Saved banners from the studio's side: the account API calls and what each
 * of their answers means to the person saving. No React in here.
 */
import { type BannerTarget, canonicalQuery } from "@/lib/banner";
import { parseTargetSlug } from "@/lib/embed";
import { BANNER_ID_RE } from "./state";

/** A saved banner as `/api/banners` returns it. */
export interface SavedBanner {
  id: string;
  name: string;
  target: BannerTarget;
  preset: string | null;
  /** Canonical option query without "?". */
  query: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Body of a create or update request. */
export interface SaveInput {
  name: string;
  target: BannerTarget;
  preset: string | null;
  query: string;
  isDefault?: boolean;
}

/** A refused account request, with the problem's code and limits. */
export class SaveProblem extends Error {
  override readonly name = "SaveProblem";
  readonly status: number;
  readonly code: string;
  /** `banner_limit_reached`: how many banners the plan allows. */
  readonly limit: number | null;
  /** Seconds the server asked to wait. */
  readonly retryAfter: number | null;

  constructor(
    status: number,
    code: string,
    detail: string,
    extra: { limit?: number | null; retryAfter?: number | null } = {},
  ) {
    super(detail);
    this.status = status;
    this.code = code;
    this.limit = extra.limit ?? null;
    this.retryAfter = extra.retryAfter ?? null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readTarget(value: unknown): BannerTarget | null {
  if (!isRecord(value)) return null;
  if (value.kind === "owner" && typeof value.login === "string") {
    return parseTargetSlug(value.login);
  }
  if (
    value.kind === "repo" &&
    typeof value.owner === "string" &&
    typeof value.name === "string"
  ) {
    return parseTargetSlug(`${value.owner}/${value.name}`);
  }
  return null;
}

/** Validates one saved banner. Throws when the value is not one. */
export function parseSavedBanner(value: unknown): SavedBanner {
  const target = isRecord(value) ? readTarget(value.target) : null;
  if (
    !isRecord(value) ||
    target === null ||
    typeof value.id !== "string" ||
    !BANNER_ID_RE.test(value.id) ||
    typeof value.name !== "string" ||
    !(value.preset === null || typeof value.preset === "string") ||
    typeof value.query !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new SaveProblem(502, "unreadable", "Unexpected saved banner body.");
  }
  return {
    id: value.id,
    name: value.name,
    target,
    preset: value.preset,
    query: value.query,
    isDefault: value.isDefault === true,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

/** The problem for a non-2xx answer, from whatever body came with it. */
export function problemOf(
  status: number,
  body: unknown,
  retryAfter: string | null = null,
): SaveProblem {
  const record = isRecord(body) ? body : {};
  const code =
    typeof record.code === "string" && record.code
      ? record.code
      : status === 401
        ? "unauthorized"
        : status === 429
          ? "rate_limited"
          : status >= 500
            ? "unavailable"
            : `http_${status}`;
  const detail =
    typeof record.detail === "string" && record.detail
      ? record.detail
      : `Request failed with status ${status}`;
  const limit =
    typeof record.limit === "number" && Number.isFinite(record.limit)
      ? record.limit
      : null;
  const wait =
    retryAfter && /^\d{1,6}$/.test(retryAfter.trim())
      ? Number(retryAfter.trim())
      : null;
  return new SaveProblem(status, code, detail, { limit, retryAfter: wait });
}

async function request(
  url: string,
  init: { method: "GET" | "POST" | "PATCH"; body?: SaveInput | object },
): Promise<SavedBanner> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new SaveProblem(0, "network", "The request did not reach the server.");
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // An empty or broken body is described by the status below.
  }
  if (!response.ok) {
    throw problemOf(response.status, body, response.headers.get("retry-after"));
  }
  return parseSavedBanner(isRecord(body) ? body.banner : null);
}

/** One of the signed-in user's saved banners. */
export function loadBanner(id: string): Promise<SavedBanner> {
  return request(`/api/banners/${encodeURIComponent(id)}`, { method: "GET" });
}

/** Saves a new banner. */
export function createBanner(input: SaveInput): Promise<SavedBanner> {
  return request("/api/banners", {
    method: "POST",
    body: { ...input, query: canonicalQuery(input.query) },
  });
}

/** Changes a saved banner. */
export function updateBanner(
  id: string,
  input: SaveInput,
): Promise<SavedBanner> {
  return request(`/api/banners/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { ...input, query: canonicalQuery(input.query) },
  });
}

/** What the person can do about a refused save. */
export type SaveRemedy =
  /** Send the same request again. */
  | "retry"
  /** Sign in with GitHub again and come back here. */
  | "sign-in"
  /** Star the repository, then sign in again to pick up Pro. */
  | "pro"
  /** Make room in the dashboard. */
  | "dashboard"
  /** Start over as a new banner. */
  | "save-as-new"
  | null;

export interface SaveMessage {
  title: string;
  description: string;
  remedy: SaveRemedy;
}

/**
 * The sentence and the action for a refused save, by the problem's code.
 * `limit` is the plan's quota as the session reports it, used when the
 * answer does not carry one.
 */
export function saveMessage(
  problem: SaveProblem,
  context: { limit: number; isPro: boolean },
): SaveMessage {
  switch (problem.code) {
    case "banner_limit_reached": {
      const limit = problem.limit ?? context.limit;
      return context.isPro
        ? {
            title: "Saved banner limit reached",
            description: `You have saved ${limit} banners, the most Pro allows. Delete one in your dashboard to make room.`,
            remedy: "dashboard",
          }
        : {
            title: "Saved banner limit reached",
            description: `The free plan keeps ${limit} saved banners. Delete one in your dashboard, or star the repository to unlock Pro and save up to 50.`,
            remedy: "pro",
          };
    }
    case "pro_required":
      return {
        title: "This needs Pro",
        description:
          "Only Pro accounts can choose the banner served at their profile URL. Star the repository, then check again.",
        remedy: "pro",
      };
    case "rate_limited":
      return {
        title: "Too many saves at once",
        description: problem.retryAfter
          ? `Wait ${problem.retryAfter} seconds, then try again. Your banner is kept in this page's address.`
          : "Wait a minute, then try again. Your banner is kept in this page's address.",
        remedy: "retry",
      };
    case "unauthorized":
    case "login_changed":
      return {
        title: "Your session ended",
        description:
          "Sign in with GitHub again to save. Your banner is kept in this page's address and comes back after you sign in.",
        remedy: "sign-in",
      };
    case "not_found":
      return {
        title: "This saved banner is gone",
        description:
          "It was deleted, perhaps in another tab. Save your changes as a new banner instead.",
        remedy: "save-as-new",
      };
    case "accounts_unavailable":
    case "unavailable":
    case "network":
      return {
        title: "Saving is unavailable right now",
        description:
          "Your banner is kept in this page's address. Try again in a few minutes.",
        remedy: "retry",
      };
    default:
      return {
        title: "The banner was not saved",
        description: problem.message,
        remedy: "retry",
      };
  }
}
