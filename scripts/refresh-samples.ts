#!/usr/bin/env bun
/**
 * Regenerates the bundled sample entities under
 * `src/lib/github/__fixtures__/samples/` by running the real fetchers once.
 *
 *   bun scripts/refresh-samples.ts
 *
 * Needs a GitHub token: `GITHUB_TOKEN`, or a signed-in `gh` CLI in
 * development. Nothing is written unless every sample is complete, passes
 * the schema, and is provably public:
 *
 * - the queries only ask for public data, whoever owns the token (see the
 *   privacy notes in `src/lib/github/queries.ts`);
 * - on top of that, every user's calendar is compared with the one GitHub
 *   serves to anonymous visitors: a token that belongs to a sampled user and
 *   carries the `read:user` scope is documented to include that user's
 *   private contributions.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchPublicCalendar } from "@/lib/github/fallback";
import { isStatisticsPending } from "@/lib/github/normalize";
import { fetchOwner } from "@/lib/github/owner";
import { fetchRepo } from "@/lib/github/repo";
import { type Entity, EntitySchema, type User } from "@/lib/github/schema";
import { hasGitHubToken } from "@/lib/github/token";

const SAMPLES_DIR = join(
  import.meta.dir,
  "../src/lib/github/__fixtures__/samples",
);

/** GitHub computes weekly statistics on first request; give it a moment. */
const ATTEMPTS = 5;
const RETRY_DELAY_MS = 3_000;

interface SampleSpec {
  file: string;
  kind: Entity["kind"];
  load: () => Promise<Entity | null>;
}

const SAMPLES: SampleSpec[] = [
  {
    file: "user.markeljan.json",
    kind: "user",
    load: () => fetchOwner("markeljan"),
  },
  {
    file: "user.torvalds.json",
    kind: "user",
    load: () => fetchOwner("torvalds"),
  },
  { file: "org.vercel.json", kind: "org", load: () => fetchOwner("vercel") },
  {
    file: "repo.vercel.next.js.json",
    kind: "repo",
    load: () => fetchRepo("vercel", "next.js"),
  },
  {
    file: "repo.sindresorhus.yocto-queue.json",
    kind: "repo",
    load: () => fetchRepo("sindresorhus", "yocto-queue"),
  },
];

/** Why an entity is not good enough to bundle, or `null` when it is. */
function shortcoming(entity: Entity): string | null {
  if (isStatisticsPending(entity))
    return "GitHub is still computing statistics";
  switch (entity.kind) {
    case "user":
      return entity.complete ? null : "the slow path did not complete";
    case "org":
      if (entity.activity === null) return "activity is missing";
      return entity.people.length > 0 ? null : "public members are missing";
    case "repo":
      if (entity.activity === null) return "activity is missing";
      return entity.starHistory === null ? "star history is missing" : null;
  }
}

async function loadSample(spec: SampleSpec): Promise<Entity> {
  let problem = "not fetched";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const entity = await spec.load();
    if (!entity) throw new Error(`${spec.file}: not found on GitHub`);
    if (entity.kind !== spec.kind) {
      throw new Error(
        `${spec.file}: expected a ${spec.kind}, got ${entity.kind}`,
      );
    }
    problem = shortcoming(entity) ?? "";
    if (!problem) return EntitySchema.parse(entity);
    await Bun.sleep(RETRY_DELAY_MS);
  }
  throw new Error(`${spec.file}: ${problem} after ${ATTEMPTS} attempts`);
}

/**
 * Throws unless the user's calendar equals the anonymous public one. The two
 * newest days are skipped: they can change between the two requests.
 */
async function assertPublicCalendar(user: User): Promise<void> {
  const anonymous = await fetchPublicCalendar(user.login);
  if (!anonymous) {
    throw new Error(`${user.login}: the public calendar could not be fetched`);
  }
  const settled = (days: User["calendar"]["days"]) =>
    JSON.stringify(days.slice(0, -2));
  if (
    user.calendar.days.length !== anonymous.days.length ||
    settled(user.calendar.days) !== settled(anonymous.days)
  ) {
    throw new Error(
      `${user.login}: the calendar differs from the public one, so the token may be adding private contributions. Use a token that does not belong to this account.`,
    );
  }
}

if (!hasGitHubToken()) {
  console.error(
    "No GitHub token: set GITHUB_TOKEN or sign in with `gh auth login`.",
  );
  process.exit(1);
}

// Fetch everything first: a failure must not leave a half-refreshed set.
const entities: Entity[] = [];
for (const spec of SAMPLES) {
  const entity = await loadSample(spec);
  if (entity.kind === "user") await assertPublicCalendar(entity);
  entities.push(entity);
}

await mkdir(SAMPLES_DIR, { recursive: true });
for (const [index, spec] of SAMPLES.entries()) {
  const body = `${JSON.stringify(entities[index])}\n`;
  await writeFile(join(SAMPLES_DIR, spec.file), body);
  process.stdout.write(`${spec.file}  ${body.length} bytes\n`);
}

// The repository's formatter decides the final layout, so a refresh never
// shows up as a lint failure.
const format = Bun.spawnSync(
  ["bunx", "biome", "format", "--write", SAMPLES_DIR],
  { stdout: "inherit", stderr: "inherit" },
);
if (format.exitCode !== 0) {
  console.error("biome format failed: run `bun run format` before committing.");
  process.exit(1);
}
