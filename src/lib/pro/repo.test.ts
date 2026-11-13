import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setEnv } from "../../../tests/e2e/auth/helpers";
import { site } from "../site";
import { proRepoLink, proRepoSlug } from "./repo";

let restore = () => {};
afterEach(() => restore());

describe("the repository named for Pro is the one the server checks", () => {
  test("the product repository by default", () => {
    restore = setEnv({ PRO_REPO: undefined });
    expect(proRepoLink()).toEqual({ slug: site.repo.slug, url: site.repo.url });
  });

  test("PRO_REPO moves the copy and the link with the check", () => {
    restore = setEnv({ PRO_REPO: "acme/stars" });
    expect(proRepoSlug()).toBe("acme/stars");
    expect(proRepoLink()).toEqual({
      slug: "acme/stars",
      url: "https://github.com/acme/stars",
    });
  });

  test("an unusable PRO_REPO falls back to the product repository", () => {
    restore = setEnv({ PRO_REPO: "not a repo" });
    expect(proRepoLink().slug).toBe(site.repo.slug);
  });
});

/** Every `.ts` and `.tsx` file below `dir`, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name),
    )
    .map((entry) => join(entry.parentPath, entry.name));
}

test("copy never names the product repository as the one to star", () => {
  // Client Components cannot read PRO_REPO, so `site.repo.slug` there could
  // name another repository than the server checks. They use `useProRepo()`;
  // server copy uses `proRepoLink()`.
  const root = join(import.meta.dir, "../..");
  const offenders = [
    ...sources(join(root, "components")),
    ...sources(join(root, "content")),
  ].filter((file) => readFileSync(file, "utf8").includes("site.repo.slug"));
  expect(offenders).toEqual([]);
});
