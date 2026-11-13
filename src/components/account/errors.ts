/**
 * Every error the account API documents, turned into one sentence a person
 * can act on and the action that helps. Pure, so the wording is tested.
 */
import { ApiProblem } from "@/hooks/api";
import { PRO } from "@/lib/pro/entitlements";

/** What the UI offers next to the message. */
export type AccountAction =
  /** "Sign in with GitHub" again: the session is gone or stale. */
  | "sign-in"
  /** "Try again", after `retryAfter` seconds when that is known. */
  | "retry"
  /** Star the repository and check again. */
  | "upgrade"
  /** Nothing the visitor can do here. */
  | "none";

export interface AccountMessage {
  /** Short heading for a banner or dialog. */
  title: string;
  /** One or two sentences: what happened and what to do. */
  message: string;
  action: AccountAction;
  /** Seconds to wait before a retry can succeed, when the server said so. */
  retryAfter: number | null;
}

export interface AccountErrorContext {
  /** Saved banners the visitor's plan allows. */
  max?: number;
  /** `owner/name` of the repository whose star unlocks Pro. */
  repo: string;
  /** The request read data rather than changing it. */
  reading?: boolean;
}

function seconds(count: number): string {
  return count === 1 ? "1 second" : `${count} seconds`;
}

/**
 * The message for an error thrown by `fetchJson` or a mutation. Anything
 * that is not an `ApiProblem` (a bug, a body we could not read) gets the
 * generic retry message.
 */
export function accountError(
  error: unknown,
  context: AccountErrorContext,
): AccountMessage {
  const problem = error instanceof ApiProblem ? error : null;
  const retryAfter = problem?.retryAfter ?? null;
  const reading = context.reading === true;
  switch (problem?.code) {
    case "unauthorized":
      return {
        title: "You are signed out",
        message: reading
          ? "Your session ended. Sign in with GitHub again to see your banners."
          : "Your session ended, so this change was not saved. Sign in with GitHub again to manage your banners.",
        action: "sign-in",
        retryAfter,
      };
    case "login_changed":
      return {
        title: "Your GitHub login changed",
        message:
          "The login you signed in with now belongs to another account. Sign in with GitHub again to continue.",
        action: "sign-in",
        retryAfter,
      };
    case "banner_limit_reached": {
      const limit = context.max ? `all ${context.max}` : "all your";
      return {
        title: "Saved banner limit reached",
        message: `You are using ${limit} saved banners. Delete one to make room, or star ${context.repo} on GitHub for up to ${PRO.maxSavedBanners}.`,
        action: "upgrade",
        retryAfter,
      };
    }
    case "pro_required":
      return {
        title: "This is a Pro feature",
        message: `Choosing the banner served at your profile URL needs Pro. Star ${context.repo} on GitHub, then check again.`,
        action: "upgrade",
        retryAfter,
      };
    case "rate_limited":
      return {
        title: reading ? "Too many requests" : "Too many changes at once",
        message:
          retryAfter !== null
            ? `Wait ${seconds(retryAfter)}, then try again.`
            : "Wait a moment, then try again.",
        action: "retry",
        retryAfter,
      };
    case "accounts_unavailable":
      return {
        title: "Accounts are not set up here",
        message:
          "This deployment has no account database, so nothing can be saved. Public banners work without an account.",
        action: "none",
        retryAfter,
      };
    case "unavailable":
      return {
        title: "Your account cannot be reached",
        message:
          "The account database is not answering right now. Your banners are safe; try again in a few seconds.",
        action: "retry",
        retryAfter,
      };
    case "not_found":
      return {
        title: "Banner not found",
        message:
          "This banner no longer exists, perhaps deleted in another tab. Reload the list to see what is saved.",
        action: "retry",
        retryAfter,
      };
    case "network":
      return {
        title: "No connection",
        message:
          "The request did not reach the server. Check your connection, then try again.",
        action: "retry",
        retryAfter,
      };
    default:
      return {
        title: "Something went wrong",
        message: reading
          ? "Your banners could not be loaded. Try again in a moment; if it keeps failing, reload the page."
          : "The change could not be saved. Try again in a moment; if it keeps failing, reload the page.",
        action: "retry",
        retryAfter,
      };
  }
}
