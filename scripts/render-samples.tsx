#!/usr/bin/env bun
/**
 * Renders a matrix of banners to image files for visual checks.
 *
 *   bun scripts/render-samples.tsx [filter] [--out <dir>]
 *
 * `filter` keeps the samples whose file name contains it ("@x", "dracula",
 * "edge-"). Output goes to `--out`, else `$SAMPLES_OUT`, else a folder in the
 * system temp directory. README-sized samples are written as 2x PNG and as
 * SVG; fixed canvases as 1x PNG.
 *
 * The matrix: every preset of every kind on every size in three themes (the
 * year in review once for a calendar year and once for the last 12 months),
 * the default banner in all themes, and the edge cases a layout has to
 * survive. Real snapshots under `src/lib/github/__fixtures__/samples/*.json`
 * are added when they exist, in every preset of their kind.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BannerOptions, BuiltBanner, RenderEnv } from "@/lib/banner";
import {
  bannerText,
  buildBanner,
  buildMessageBanner,
  collectImages,
  DEMO_NOW,
  demoEntity,
  parseOptions,
  presetDefaults,
  presetsFor,
  resolveOptions,
  SIZE_IDS,
  THEMES,
} from "@/lib/banner";
import {
  type Entity,
  EntitySchema,
  type Org,
  type Repo,
  type User,
} from "@/lib/github/schema";
import {
  avatarDataUri,
  fallbackFontsFor,
  renderPng,
  renderSvg,
} from "@/lib/render";

const HOST = "gitbanners.com";
/** Themes of the profile presets: GitHub's own two and a community one. */
const MATRIX_THEMES = ["github-dark", "github-light", "dracula"] as const;
/** Themes of the repository, organization and year-in-review presets. */
const POSTER_THEMES = ["github-dark", "github-light", "tokyo-night"] as const;
/** The calendar year the year-in-review samples are made for. */
const WRAPPED_YEAR = 2026;
const FIXTURES = join(process.cwd(), "src/lib/github/__fixtures__/samples");

interface Sample {
  name: string;
  build(env: RenderEnv): BuiltBanner;
  /** Remote avatars and non-Latin text this sample needs before it can render. */
  entity?: Entity;
  options: BannerOptions;
}

function args(): { filter: string; out: string } {
  const argv = process.argv.slice(2);
  const outIndex = argv.indexOf("--out");
  const out =
    (outIndex >= 0 ? argv[outIndex + 1] : undefined) ??
    process.env.SAMPLES_OUT ??
    join(tmpdir(), "gitbanners-samples");
  const filter =
    argv.find(
      (arg, index) =>
        !arg.startsWith("--") && (outIndex < 0 || index !== outIndex + 1),
    ) ?? "";
  return { filter, out };
}

function entitySample(
  name: string,
  entity: Entity,
  preset: string | null,
  query = "",
): Sample {
  const options = resolveOptions(
    entity.kind,
    preset,
    parseOptions(new URLSearchParams(query)),
  );
  return {
    name,
    entity,
    options,
    build: (env) => buildBanner(entity, options, env),
  };
}

function edgeUser(patch: (user: User) => void, year?: number): User {
  const user = demoEntity("user", { year });
  patch(user);
  return user;
}

function edgeRepo(patch: (repo: Repo) => void): Repo {
  const repo = demoEntity("repo");
  patch(repo);
  return repo;
}

function edgeOrg(patch: (org: Org) => void): Org {
  const org = demoEntity("org");
  patch(org);
  return org;
}

function matrix(): Sample[] {
  const user = demoEntity("user");
  const samples: Sample[] = [];
  for (const preset of presetsFor("user")) {
    if (preset.id === "wrapped") continue;
    for (const size of SIZE_IDS) {
      for (const theme of MATRIX_THEMES) {
        samples.push(
          entitySample(
            `user-${preset.id}@${size}.${theme}`,
            user,
            preset.id,
            `size=${size}&theme=${theme}`,
          ),
        );
      }
    }
  }
  for (const theme of THEMES) {
    samples.push(
      entitySample(`theme-${theme.id}`, user, "overview", `theme=${theme.id}`),
    );
  }
  // The year in review: a calendar year with its extras, and the default range.
  const year = demoEntity("user", { year: WRAPPED_YEAR });
  for (const size of SIZE_IDS) {
    for (const theme of POSTER_THEMES) {
      samples.push(
        entitySample(
          `user-wrapped@${size}.${theme}`,
          year,
          "wrapped",
          `size=${size}&theme=${theme}&year=${WRAPPED_YEAR}`,
        ),
        entitySample(
          `user-wrapped-12-months@${size}.${theme}`,
          user,
          "wrapped",
          `size=${size}&theme=${theme}`,
        ),
      );
    }
  }
  for (const kind of ["repo", "org"] as const) {
    const entity = demoEntity(kind);
    for (const preset of presetsFor(kind)) {
      for (const size of SIZE_IDS) {
        for (const theme of POSTER_THEMES) {
          samples.push(
            entitySample(
              `${kind}-${preset.id}@${size}.${theme}`,
              entity,
              preset.id,
              `size=${size}&theme=${theme}`,
            ),
          );
        }
      }
    }
  }
  return samples;
}

/** Repositories, organizations and years a layout has to survive. */
function posterEdges(): Sample[] {
  const longName = edgeRepo((r) => {
    r.name = "a-repository-name-of-exactly-forty-chars";
    r.owner = { ...r.owner, login: "an-organization-with-a-very-long-login" };
    r.fullName = `${r.owner.login}/${r.name}`;
  });
  const noDescription = edgeRepo((r) => {
    r.description = null;
  });
  const noLanguage = edgeRepo((r) => {
    r.language = null;
    r.languages = [];
  });
  const computing = edgeRepo((r) => {
    r.activity = null;
  });
  const weeklyOnly = edgeRepo((r) => {
    if (!r.activity) return;
    r.activity = {
      ...r.activity,
      weeks: r.activity.weeks.map((week) => ({ ...week, days: null })),
    };
  });
  const nobody = edgeRepo((r) => {
    r.contributors = [];
    r.contributorCount = 0;
  });
  const fewPeople = edgeRepo((r) => {
    r.contributors = r.contributors.slice(0, 4);
    r.contributorCount = 4;
  });
  const archivedFork = edgeRepo((r) => {
    r.isArchived = true;
    r.isFork = true;
  });
  const bare = edgeRepo((r) => {
    r.description = null;
    r.language = null;
    r.languages = [];
    r.license = null;
    r.topics = [];
    r.latestRelease = null;
    r.commits = null;
    r.activity = null;
    r.starHistory = null;
    r.contributors = [];
    r.contributorCount = null;
  });
  const personal = edgeRepo((r) => {
    r.owner = { ...r.owner, login: "mona-demo", kind: "user" };
    r.fullName = "mona-demo/rocket";
  });
  const hiddenRoster = edgeOrg((o) => {
    o.people = [];
    o.stats = { ...o.stats, members: null };
  });
  const quietOrg = edgeOrg((o) => {
    o.activity = null;
    o.isVerified = false;
    o.description = null;
  });
  const fewRepos = edgeOrg((o) => {
    o.repos = o.repos.slice(0, 2);
    o.people = o.people.slice(0, 5);
    o.stats = { ...o.stats, members: 5 };
  });
  const quietYear = edgeUser((u) => {
    const kept = new Map([
      [40, 1],
      [41, 2],
      [200, 1],
    ]);
    u.calendar = {
      ...u.calendar,
      total: 4,
      days: u.calendar.days.map((day, index) => {
        const count = kept.get(index) ?? 0;
        return { ...day, count, level: count > 1 ? 4 : count };
      }),
    };
    u.stats = {
      ...u.stats,
      contributions: 4,
      commits: 3,
      pullRequests: 1,
      issues: 0,
      reviews: 0,
    };
    u.wrapped = { year: WRAPPED_YEAR, previousTotal: 0, topRepos: [] };
  }, WRAPPED_YEAR);
  const emptyYear = edgeUser((u) => {
    u.calendar = {
      ...u.calendar,
      total: 0,
      days: u.calendar.days.map((day) => ({ ...day, count: 0, level: 0 })),
    };
    u.stats = { ...u.stats, contributions: 0, commits: 0, pullRequests: 0 };
    u.wrapped = null;
    u.languages = [];
  }, 2025);
  const slowerYear = edgeUser((u) => {
    if (!u.wrapped) return;
    u.wrapped = {
      ...u.wrapped,
      previousTotal: Math.round(u.calendar.total * 1.4),
      topRepos: [
        {
          fullName: "an-organization-with-a-very-long-login/a-long-repository",
          commits: 1,
        },
        ...u.wrapped.topRepos,
      ],
    };
  }, 2025);
  const year = `year=${WRAPPED_YEAR}`;
  return [
    entitySample("edge-repo-no-description", noDescription, "overview"),
    entitySample(
      "edge-repo-no-description@social",
      noDescription,
      "social",
      "theme=github-light",
    ),
    entitySample("edge-repo-no-language", noLanguage, "overview"),
    entitySample("edge-repo-no-language@social", noLanguage, "social"),
    entitySample("edge-repo-activity-computing", computing, "activity"),
    entitySample(
      "edge-repo-activity-computing@og",
      computing,
      "activity",
      "size=og",
    ),
    entitySample("edge-repo-release-computing", computing, "release"),
    entitySample(
      "edge-repo-release-computing@x",
      computing,
      "release",
      "size=x",
    ),
    entitySample("edge-repo-activity-weekly-only", weeklyOnly, "activity"),
    entitySample(
      "edge-repo-activity-weekly-only@og",
      weeklyOnly,
      "activity",
      "size=og",
    ),
    entitySample(
      "edge-repo-activity-narrow",
      demoEntity("repo"),
      "activity",
      "width=495",
    ),
    entitySample("edge-repo-no-contributors", nobody, "contributors"),
    entitySample(
      "edge-repo-no-contributors@og",
      nobody,
      "contributors",
      "size=og",
    ),
    entitySample("edge-repo-four-contributors", fewPeople, "contributors"),
    entitySample(
      "edge-repo-four-contributors@square",
      fewPeople,
      "contributors",
      "size=square",
    ),
    entitySample(
      "edge-repo-contributors-count-10",
      demoEntity("repo"),
      "contributors",
      "count=10",
    ),
    entitySample("edge-repo-archived-fork", archivedFork, "overview"),
    entitySample("edge-repo-archived-fork@social", archivedFork, "social"),
    entitySample(
      "edge-repo-archived-fork@x",
      archivedFork,
      "activity",
      "size=x",
    ),
    entitySample("edge-repo-long-name", longName, "overview"),
    entitySample("edge-repo-long-name-release", longName, "release"),
    entitySample("edge-repo-long-name@social", longName, "social"),
    entitySample("edge-repo-long-name@og", longName, "contributors", "size=og"),
    entitySample("edge-repo-long-name@x", longName, "overview", "size=x"),
    entitySample("edge-repo-bare", bare, "overview"),
    entitySample("edge-repo-bare-activity", bare, "activity"),
    entitySample("edge-repo-bare@social", bare, "social"),
    entitySample("edge-repo-personal@social", personal, "social"),
    entitySample(
      "edge-repo-social-rounded",
      demoEntity("repo"),
      "social",
      "radius=40&border=1&theme=tokyo-night",
    ),
    entitySample(
      "edge-repo-hide-everything",
      demoEntity("repo"),
      "overview",
      "hide=avatar,description,meta,topics",
    ),
    entitySample("edge-org-hidden-roster", hiddenRoster, "overview"),
    entitySample(
      "edge-org-hidden-roster@og",
      hiddenRoster,
      "overview",
      "size=og",
    ),
    entitySample("edge-org-no-activity", quietOrg, "activity"),
    entitySample("edge-org-no-activity@x", quietOrg, "activity", "size=x"),
    entitySample("edge-org-two-repos", fewRepos, "repos"),
    entitySample("edge-org-two-repos@square", fewRepos, "repos", "size=square"),
    entitySample("edge-org-five-people", fewRepos, "overview"),
    entitySample(
      "edge-org-people-count-24",
      demoEntity("org"),
      "overview",
      "count=24",
    ),
    entitySample("edge-wrapped-quiet-year", quietYear, "wrapped", year),
    entitySample(
      "edge-wrapped-quiet-year@square",
      quietYear,
      "wrapped",
      `${year}&size=square`,
    ),
    entitySample(
      "edge-wrapped-quiet-year@x",
      quietYear,
      "wrapped",
      `${year}&size=x`,
    ),
    entitySample(
      "edge-wrapped-quiet-year@readme",
      quietYear,
      "wrapped",
      `${year}&size=readme`,
    ),
    entitySample("edge-wrapped-empty-year", emptyYear, "wrapped", "year=2025"),
    entitySample(
      "edge-wrapped-empty-year@square",
      emptyYear,
      "wrapped",
      "year=2025&size=square",
    ),
    entitySample(
      "edge-wrapped-slower-year",
      slowerYear,
      "wrapped",
      "year=2025",
    ),
    entitySample(
      "edge-wrapped-slower-year@square",
      slowerYear,
      "wrapped",
      "year=2025&size=square",
    ),
    entitySample(
      "edge-wrapped-narrow-card",
      demoEntity("user", { year: WRAPPED_YEAR }),
      "wrapped",
      `${year}&size=readme&width=495`,
    ),
    entitySample(
      "edge-wrapped-mono",
      demoEntity("user", { year: WRAPPED_YEAR }),
      "wrapped",
      `${year}&font=mono&theme=vercel`,
    ),
    entitySample(
      "edge-wrapped-count-5@square",
      demoEntity("user", { year: WRAPPED_YEAR }),
      "wrapped",
      `${year}&size=square&count=5`,
    ),
  ];
}

function edges(): Sample[] {
  const user = demoEntity("user");
  const longBio =
    "Maintainer of far too many small packages. I write about build tools, type systems and the occasional bread recipe; I answer issues slowly but I do answer them. Previously infrastructure at three companies you have heard of and two you have not. Currently exploring offline-first software, typography on the web, and how to make continuous integration boring again. Opinions are mine. Always happy to review a pull request.";
  const quiet = edgeUser((u) => {
    u.calendar = {
      ...u.calendar,
      total: 0,
      days: u.calendar.days.map((day) => ({ ...day, count: 0, level: 0 })),
    };
    u.stats.contributions = 0;
    u.streak = {
      current: 0,
      currentStart: null,
      longest: 0,
      longestStart: null,
      longestEnd: null,
    };
    u.bestDay = null;
  });
  const intl = edgeUser((u) => {
    u.name = "山田 太郎 🚀 Ünïcödé";
    u.bio = "オープンソースが好きです 👩‍💻 мир, труд, код · مرحبا بالعالم";
    u.location = "東京, 日本";
    u.company = "株式会社サンプル";
  });
  const huge = edgeUser((u) => {
    u.name = "Wolfeschlegelsteinhausenbergerdorff The Third Of His Name";
    u.login = "a-login-that-uses-all-thirty-nine-chars";
    u.followers = 12_345_678;
    u.stats = {
      contributions: 1_234_567,
      commits: 987_654,
      pullRequests: 99_949,
      issues: 99_950,
      reviews: 999_499,
      contributedTo: 999_500,
      repositories: 10_000,
      stars: 987_654_321,
    };
    u.calendar = { ...u.calendar, total: 1_234_567 };
    u.streak = { ...u.streak, current: 3650, longest: 3650 };
  });
  const loading = edgeUser((u) => {
    u.complete = false;
    u.stats = {
      ...u.stats,
      commits: null,
      pullRequests: null,
      issues: null,
      reviews: null,
      contributedTo: null,
      stars: null,
    };
    u.repos = [];
    u.languages = [];
  });
  const sparse = edgeUser((u) => {
    u.name = null;
    u.bio = null;
    u.company = null;
    u.location = null;
    u.repos = u.repos.slice(0, 1);
    u.languages = u.languages.slice(0, 1);
    u.organizations = [];
  });
  return [
    entitySample("edge-no-contributions", quiet, "overview"),
    entitySample("edge-no-contributions-streak", quiet, "streak"),
    entitySample(
      "edge-long-bio",
      edgeUser((u) => {
        u.bio = longBio;
      }),
      "overview",
    ),
    entitySample(
      "edge-long-bio@og",
      edgeUser((u) => {
        u.bio = longBio;
      }),
      "overview",
      "size=og",
    ),
    entitySample("edge-cjk-emoji", intl, "overview"),
    entitySample("edge-cjk-emoji@x", intl, "overview", "size=x"),
    entitySample("edge-one-repo", sparse, "repos"),
    entitySample("edge-one-language", sparse, "languages"),
    entitySample("edge-huge-numbers", huge, "overview"),
    entitySample("edge-huge-numbers-stats", huge, "stats"),
    entitySample("edge-huge-numbers@x", huge, "overview", "size=x"),
    entitySample("edge-loading", loading, "stats"),
    entitySample("edge-loading-overview", loading, "overview"),
    entitySample("edge-loading-repos", loading, "repos"),
    entitySample("edge-loading-languages", loading, "languages"),
    entitySample("edge-loading-repos@x", loading, "repos", "size=x"),
    entitySample(
      "edge-title-stats",
      user,
      "stats",
      "title=Open%20source%20in%20numbers",
    ),
    entitySample(
      "edge-title-languages@og",
      user,
      "languages",
      "title=What%20I%20write&size=og",
    ),
    entitySample(
      "edge-custom-320x120",
      user,
      "overview",
      "width=320&height=120",
    ),
    entitySample("edge-custom-495", user, "overview", "width=495"),
    entitySample("edge-custom-495-activity", user, "activity", "width=495"),
    entitySample(
      "edge-custom-3000x1000",
      user,
      "overview",
      "width=3000&height=1000",
    ),
    entitySample("edge-custom-x-3000", user, "overview", "size=x&width=3000"),
    entitySample("edge-custom-495x195", user, "card", "width=495&height=195"),
    entitySample(
      "edge-hide-labels-legend",
      user,
      "overview",
      "hide=labels,legend",
    ),
    entitySample(
      "edge-hide-avatar-bio-meta",
      user,
      "overview",
      "hide=avatar,bio,meta",
    ),
    entitySample("edge-hide-title", user, "activity", "hide=title"),
    entitySample(
      "edge-show-all",
      user,
      "overview",
      "show=header,stats,streak,repos,languages,orgs,heatmap",
    ),
    entitySample(
      "edge-show-stats-heatmap",
      user,
      "overview",
      "show=stats,heatmap",
    ),
    entitySample(
      "edge-show-unknown-sections",
      user,
      "overview",
      "show=people,contributors",
    ),
    entitySample("edge-heat-one-colour", user, "overview", "heat=ff7b72"),
    entitySample(
      "edge-heat-light-bg",
      user,
      "overview",
      "bg=fffdf5&text=2b2118&muted=7a6a58&border_color=e6dcc8&surface=f4ecda&heat=d9480f&accent=d9480f",
    ),
    entitySample(
      "edge-title-year",
      user,
      "activity",
      "title=Shipping%20every%20day&year=2025",
    ),
    entitySample("edge-mono-font", user, "overview", "font=mono"),
    entitySample(
      "edge-no-brand-radius",
      user,
      "overview",
      "brand=0&radius=0&border=0",
    ),
    entitySample("edge-count-6-repos", user, "repos", "count=6"),
    {
      name: "message-not-found",
      options: resolveOptions("user", null),
      build: (env) =>
        buildMessageBanner(
          { title: "No GitHub account named mona-missing" },
          resolveOptions("user", null),
          env,
        ),
    },
    {
      name: "message-github-down@x",
      options: resolveOptions("user", null, {
        size: "x",
        theme: "github-light",
      }),
      build: (env) =>
        buildMessageBanner(
          {
            title: "GitHub is not answering. Retrying soon.",
            detail: "This banner refreshes on its own.",
          },
          resolveOptions("user", null, { size: "x", theme: "github-light" }),
          env,
        ),
    },
  ];
}

async function fixtures(): Promise<Sample[]> {
  let files: string[];
  try {
    files = (await readdir(FIXTURES)).filter((file) => file.endsWith(".json"));
  } catch {
    return [];
  }
  const samples: Sample[] = [];
  for (const file of files.sort()) {
    try {
      const parsed = EntitySchema.safeParse(
        JSON.parse(await readFile(join(FIXTURES, file), "utf8")),
      );
      if (!parsed.success) continue;
      const slug = file.replace(/\.json$/, "");
      for (const size of ["readme", "x"] as const) {
        samples.push(
          entitySample(
            `real-${slug}@${size}`,
            parsed.data,
            null,
            `size=${size}`,
          ),
        );
      }
      // Every other preset of the kind: at its own size, as a card and as a
      // link preview. Profile presets other than the year in review are
      // covered by the demo matrix.
      for (const preset of presetsFor(parsed.data.kind).slice(1)) {
        if (parsed.data.kind === "user" && preset.id !== "wrapped") continue;
        const own = presetDefaults(parsed.data.kind, preset.id)?.size;
        for (const size of new Set([own ?? "readme", "readme", "og"])) {
          samples.push(
            entitySample(
              `real-${slug}-${preset.id}@${size}`,
              parsed.data,
              preset.id,
              `size=${size}`,
            ),
          );
        }
      }
    } catch {
      // A snapshot another task is still writing: skip it this run.
    }
  }
  return samples;
}

async function environment(sample: Sample): Promise<RenderEnv> {
  const now = new Date(DEMO_NOW);
  const images = new Map<string, string>();
  if (sample.entity) {
    const wanted = collectImages(sample.entity, sample.options, {
      now,
      host: HOST,
    });
    await Promise.all(
      wanted.map(async ({ url, px }) => {
        images.set(url, (await avatarDataUri(url, px * 2)) ?? "");
      }),
    );
  }
  return { now, host: HOST, image: (url) => images.get(url) ?? "" };
}

const { filter, out } = args();
await mkdir(out, { recursive: true });
const samples = [
  ...matrix(),
  ...edges(),
  ...posterEdges(),
  ...(await fixtures()),
].filter((sample) => sample.name.includes(filter));

const rows: string[] = [];
let failures = 0;
for (const sample of samples) {
  const started = performance.now();
  try {
    const env = await environment(sample);
    const built = sample.build(env);
    const text = sample.entity ? bannerText(sample.entity, sample.options) : "";
    const fonts = await fallbackFontsFor(text);
    const size = { width: built.width, height: built.height, fonts };
    const card = built.width < 1000;
    const png = await renderPng(built.element, {
      ...size,
      scale: card ? 2 : 1,
    });
    await writeFile(join(out, `${sample.name}.png`), png);
    if (card) {
      await writeFile(
        join(out, `${sample.name}.svg`),
        await renderSvg(built.element, size),
      );
    }
    rows.push(
      [
        `${sample.name}.png`.padEnd(58),
        `${built.width}x${built.height}`.padEnd(10),
        String(png.byteLength).padStart(8),
        `${(performance.now() - started).toFixed(0)} ms`.padStart(7),
      ].join("  "),
    );
  } catch (error) {
    failures += 1;
    rows.push(`${sample.name.padEnd(58)}  FAILED  ${String(error)}`);
  }
}
console.log(
  [
    `${"file".padEnd(58)}  ${"pixels".padEnd(10)}  ${"bytes".padStart(8)}  ${"time".padStart(7)}`,
    ...rows,
  ].join("\n"),
);
console.log(
  `\n${samples.length - failures} of ${samples.length} rendered to ${out}`,
);
if (failures > 0) process.exitCode = 1;
