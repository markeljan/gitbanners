/**
 * Bundled snapshots of real, PUBLIC GitHub entities in the normalized model:
 * demos, first paint of the studio, tests, and deployments without a GitHub
 * token (previews, hermetic builds).
 *
 * This module is isomorphic: it imports JSON and the schema only, so client
 * components may import it directly (import it as `@/lib/github/samples`,
 * not through the index, which also re-exports the server-side fetchers).
 *
 * Regenerate with `bun scripts/refresh-samples.ts`. The samples are frozen in
 * time: `fetchedAt` says when, and `streak.current` was true on that day.
 */
import type { BannerTarget } from "@/lib/banner/types";
import orgVercel from "./__fixtures__/samples/org.vercel.json";
import repoYoctoQueue from "./__fixtures__/samples/repo.sindresorhus.yocto-queue.json";
import repoNext from "./__fixtures__/samples/repo.vercel.next.js.json";
import userMarkeljan from "./__fixtures__/samples/user.markeljan.json";
import userTorvalds from "./__fixtures__/samples/user.torvalds.json";
import {
  type Entity,
  type Org,
  OrgSchema,
  type Repo,
  RepoSchema,
  type User,
  UserSchema,
} from "./schema";

// Parsed rather than cast: a hand-edited or outdated sample fails loudly at
// import (and in the tests) instead of reaching the renderer half-valid.

/** The product's example profile (`site.exampleLogin`). */
export const SAMPLE_USER: User = UserSchema.parse(userMarkeljan);
/** An organization with repositories, members and activity. */
export const SAMPLE_ORG: Org = OrgSchema.parse(orgVercel);
/** A large, active repository. */
export const SAMPLE_REPO: Repo = RepoSchema.parse(repoNext);

/** Every bundled sample: two users, one organization, two repositories. */
export const SAMPLES: readonly Entity[] = [
  SAMPLE_USER,
  UserSchema.parse(userTorvalds),
  SAMPLE_ORG,
  SAMPLE_REPO,
  RepoSchema.parse(repoYoctoQueue),
];

const owners = new Map<string, User | Org>();
const repos = new Map<string, Repo>();
for (const entity of SAMPLES) {
  if (entity.kind === "repo") repos.set(entity.fullName.toLowerCase(), entity);
  else owners.set(entity.login.toLowerCase(), entity);
}

/**
 * The bundled sample for a banner target, or `null` when there is none.
 * Logins and repository names match case-insensitively, like on GitHub. An
 * owner target only ever yields a user or organization, a repository target
 * only a repository.
 */
export function getSample(target: BannerTarget): Entity | null {
  if (target.kind === "owner") {
    return owners.get(target.login.toLowerCase()) ?? null;
  }
  return repos.get(`${target.owner}/${target.name}`.toLowerCase()) ?? null;
}
