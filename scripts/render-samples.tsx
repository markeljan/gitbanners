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
 * The matrix: every user preset on every size in three themes, the default
 * banner in all themes, the generic organization and repository banners, and
 * the edge cases a layout has to survive. Real snapshots under
 * `src/lib/github/__fixtures__/samples/*.json` are added when they exist.
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
  presetsFor,
  resolveOptions,
  SIZE_IDS,
  THEMES,
} from "@/lib/banner";
import { type Entity, EntitySchema, type User } from "@/lib/github/schema";
import {
  avatarDataUri,
  fallbackFontsFor,
  renderPng,
  renderSvg,
} from "@/lib/render";

const HOST = "gitbanners.vercel.app";
const MATRIX_THEMES = ["github-dark", "github-light", "dracula"] as const;
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

function edgeUser(patch: (user: User) => void): User {
  const user = demoEntity("user");
  patch(user);
  return user;
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
  for (const kind of ["org", "repo"] as const) {
    for (const size of ["readme", "x", "og"] as const) {
      samples.push(
        entitySample(
          `${kind}-overview@${size}`,
          demoEntity(kind),
          null,
          `size=${size}`,
        ),
      );
    }
  }
  return samples;
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
const samples = [...matrix(), ...edges(), ...(await fixtures())].filter(
  (sample) => sample.name.includes(filter),
);

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
        `${sample.name}.png`.padEnd(46),
        `${built.width}x${built.height}`.padEnd(10),
        String(png.byteLength).padStart(8),
        `${(performance.now() - started).toFixed(0)} ms`.padStart(7),
      ].join("  "),
    );
  } catch (error) {
    failures += 1;
    rows.push(`${sample.name.padEnd(46)}  FAILED  ${String(error)}`);
  }
}
console.log(
  [
    `${"file".padEnd(46)}  ${"pixels".padEnd(10)}  ${"bytes".padStart(8)}  ${"time".padStart(7)}`,
    ...rows,
  ].join("\n"),
);
console.log(
  `\n${samples.length - failures} of ${samples.length} rendered to ${out}`,
);
if (failures > 0) process.exitCode = 1;
