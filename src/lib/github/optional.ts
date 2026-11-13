/**
 * The parts of an entity a banner can live without.
 *
 * The core request of a fetcher must succeed. Everything around it
 * (contributors, statistics, organizations, ...) is optional: when one of
 * those requests fails the entity is still returned, with that part `null`
 * or empty, because a banner missing one section beats an error image.
 */
import { isLocalRefusal } from "./client";
import { isGitHubError } from "./errors";

/**
 * Awaits an optional part and turns its failure into `null`. Never rejects,
 * so it is safe to start a part before knowing whether it will be needed.
 *
 * The failure is logged: it degrades the output and nothing else would show
 * it. Only public identifiers (logins, repository names) reach the log.
 * Requests the client refused locally during a known rate limit stay quiet:
 * the response that announced the limit was already logged once.
 *
 * @param what The part, for the log line, e.g. "UserTotals".
 * @param subject The public login or `owner/name` the part belongs to.
 */
export async function optional<T>(
  what: string,
  subject: string,
  part: Promise<T | null>,
): Promise<T | null> {
  try {
    return await part;
  } catch (error) {
    if (isLocalRefusal(error)) return null;
    if (isGitHubError(error)) {
      console.warn(
        `[github] ${what} unavailable for ${subject}: ${error.code} (${error.message})`,
      );
    } else {
      // Not a GitHub failure: a bug on our side. Keep the banner, shout louder.
      console.error(`[github] ${what} failed for ${subject}`, error);
    }
    return null;
  }
}
