/**
 * The repository whose stargazers are Pro, in one place for the server check
 * and for every sentence that tells people what to star.
 *
 * Plain module with no server imports, but `PRO_REPO` is a server variable:
 * in a browser bundle it is undefined and this would fall back to the
 * product's repository. Client Components therefore never call it; they read
 * `useProRepo()` from `@/components/providers`, which the root layout fills
 * from this module on the server.
 */
import { LOGIN_RE, REPO_NAME_RE } from "@/lib/github/schema";
import { site } from "@/lib/site";

/** A repository as `owner` and `name`, both already validated. */
export interface StarRepo {
  owner: string;
  name: string;
}

/** What copy needs to name the Pro repository and link to it. */
export interface ProRepoLink {
  /** `owner/name`. */
  slug: string;
  /** `https://github.com/owner/name`. */
  url: string;
}

/**
 * The repository whose stargazers are Pro: `PRO_REPO` when set, the product's
 * own repository otherwise. `null` when the value is not `owner/name`, in
 * which case only the allowlist can grant Pro.
 */
export function proRepo(): StarRepo | null {
  const [owner, name, ...rest] = (process.env.PRO_REPO || site.repo.slug).split(
    "/",
  );
  if (rest.length > 0 || !owner || !name) return null;
  if (!LOGIN_RE.test(owner) || !REPO_NAME_RE.test(name)) return null;
  return { owner, name };
}

/**
 * "owner/name" of the repository to star, for messages. Falls back to the
 * product's own repository when `PRO_REPO` is unusable.
 */
export function proRepoSlug(): string {
  const repo = proRepo();
  return repo ? `${repo.owner}/${repo.name}` : site.repo.slug;
}

/** The repository to star, as a slug and a link. */
export function proRepoLink(): ProRepoLink {
  const slug = proRepoSlug();
  return { slug, url: `https://github.com/${slug}` };
}
