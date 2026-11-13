import { describe, expect, test } from "bun:test";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { altText } from "@/lib/banner/alt";
import {
  bannerText,
  buildBanner,
  buildMessageBanner,
  collectImages,
} from "@/lib/banner/build";
import { resolveCanvas } from "@/lib/banner/canvas";
import { DEMO_NOW, demoEntity } from "@/lib/banner/demo";
import { parseOptions, resolveOptions, SIZE_IDS } from "@/lib/banner/options";
import { PRESETS, presetsFor } from "@/lib/banner/presets";
import { THEMES } from "@/lib/banner/themes";
import type {
  BannerOptions,
  BuiltBanner,
  EntityKind,
  RenderEnv,
} from "@/lib/banner/types";
import type { Entity, Org, Repo, User } from "@/lib/github/schema";

const ENV: RenderEnv = {
  image: (url, px) => `${url}?s=${px}`,
  now: new Date(DEMO_NOW),
  host: "gitbanners.test",
};

const KINDS: EntityKind[] = ["user", "org", "repo"];
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/;
const ALLOWED_TAGS = new Set(["div", "span", "img", "svg", "path"]);
/** Style values that are lengths: whole pixels, never negative. */
const BOX_KEYS = ["left", "top", "width", "height"] as const;

type Styled = ReactElement<{
  style?: CSSProperties;
  children?: ReactNode;
  className?: string;
  src?: string;
}>;

interface Leaf {
  tag: string;
  style: CSSProperties;
  text: string;
  /** Source of an `<img>`. */
  src: string | null;
  /** Number of direct children: the paths of an `<svg>`. */
  children: number;
  /** The box as drawn, without the clip padding of text lines. */
  box: { x: number; y: number; w: number; h: number } | null;
}

function options(
  kind: EntityKind,
  preset: string | null,
  query = "",
): BannerOptions {
  return resolveOptions(kind, preset, parseOptions(new URLSearchParams(query)));
}

function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as Styled).props.children);
  }
  return "";
}

/** Walks the tree, checks every element, and returns the root's direct children as leaves. */
function inspect(built: BuiltBanner): { leaves: Leaf[]; problems: string[] } {
  const problems: string[] = [];
  const leaves: Leaf[] = [];
  const visit = (node: ReactNode, depth: number): void => {
    if (node === null || node === undefined || typeof node === "boolean")
      return;
    if (typeof node === "string" || typeof node === "number") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth);
      return;
    }
    const element = node as Styled;
    const tag = typeof element.type === "string" ? element.type : "(component)";
    if (!ALLOWED_TAGS.has(tag)) problems.push(`element <${tag}>`);
    if (element.props.className !== undefined) problems.push("className");
    const style = element.props.style ?? {};
    for (const [key, value] of Object.entries(style)) {
      if (typeof value === "number") {
        if (!Number.isFinite(value)) problems.push(`${key}: ${value}`);
        else if (value < 0) problems.push(`${key}: ${value} is negative`);
      } else if (typeof value !== "string") {
        problems.push(`${key}: ${String(value)}`);
      } else if (/NaN|undefined|null|Infinity/.test(value)) {
        problems.push(`${key}: "${value}"`);
      }
    }
    for (const key of BOX_KEYS) {
      const value = style[key];
      if (value !== undefined && !Number.isInteger(value)) {
        problems.push(`${key}: ${String(value)} is not a whole pixel`);
      }
    }
    for (const key of ["color", "backgroundColor"] as const) {
      const value = style[key];
      if (value !== undefined && !HEX.test(String(value))) {
        problems.push(`${key}: ${String(value)}`);
      }
    }
    if (typeof style.border === "string") {
      if (!/^\d+px solid #(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(style.border)) {
        problems.push(`border: ${style.border}`);
      }
    }
    if (tag === "img" && typeof element.props.src !== "string") {
      problems.push("img without src");
    }
    if (depth === 1) {
      const pad = typeof style.paddingTop === "number" ? style.paddingTop : 0;
      const positioned =
        typeof style.left === "number" &&
        typeof style.top === "number" &&
        typeof style.width === "number" &&
        typeof style.height === "number";
      if (style.position !== "absolute" || !positioned) {
        problems.push(`<${tag}> is not absolutely positioned with a size`);
      }
      leaves.push({
        tag,
        style,
        text: textOf(element),
        src: typeof element.props.src === "string" ? element.props.src : null,
        children: Array.isArray(element.props.children)
          ? element.props.children.length
          : element.props.children
            ? 1
            : 0,
        box: positioned
          ? {
              x: style.left as number,
              y: (style.top as number) + pad,
              w: style.width as number,
              h: (style.height as number) - 2 * pad,
            }
          : null,
      });
    }
    visit(element.props.children, depth + 1);
  };
  visit(built.element, 0);
  return { leaves, problems };
}

function overlaps(
  a: NonNullable<Leaf["box"]>,
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/** Everything a correct banner satisfies, whatever it shows. */
function problemsOf(built: BuiltBanner, opts: BannerOptions): string[] {
  const { leaves, problems } = inspect(built);
  const root = (built.element as Styled).props.style ?? {};
  if (!Number.isInteger(built.width) || !Number.isInteger(built.height)) {
    problems.push(`size ${built.width}x${built.height}`);
  }
  if (built.width <= 0 || built.height <= 0) problems.push("empty canvas");
  if (root.width !== built.width || root.height !== built.height) {
    problems.push(`root is ${root.width}x${root.height}`);
  }
  if ((built.element as Styled).type !== "div") problems.push("root tag");

  const canvas = resolveCanvas(opts);
  if (built.width !== canvas.width) problems.push("width differs from canvas");
  if (canvas.height !== null && built.height !== canvas.height) {
    problems.push("height differs from canvas");
  }
  for (const leaf of leaves) {
    if (!leaf.box) continue;
    const { x, y, w, h } = leaf.box;
    if (x < 0 || y < 0 || x + w > built.width || y + h > built.height) {
      problems.push(
        `${leaf.tag} "${leaf.text.slice(0, 24)}" leaves the canvas: ${x},${y} ${w}x${h}`,
      );
    }
    if (
      canvas.safeZone &&
      overlaps(leaf.box, {
        x: canvas.safeZone.x,
        y: canvas.safeZone.y,
        w: canvas.safeZone.width,
        h: canvas.safeZone.height,
      })
    ) {
      // The outline of the canvas is the one box that may cross the zone.
      const outline = w === built.width && h === built.height;
      if (!outline) {
        problems.push(
          `${leaf.tag} "${leaf.text.slice(0, 24)}" is in the safe zone`,
        );
      }
    }
  }
  // Text never sits on top of other text.
  const texts = leaves.filter((leaf) => leaf.text && leaf.box);
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i];
      const b = texts[j];
      if (a.box && b.box && overlaps(a.box, { ...b.box })) {
        problems.push(
          `"${a.text.slice(0, 20)}" overlaps "${b.text.slice(0, 20)}"`,
        );
      }
    }
  }
  if (built.heatmap) {
    const { cell, colors, cells } = built.heatmap;
    const drawn = leaves.filter(
      (leaf) =>
        leaf.tag === "div" &&
        leaf.style.width === cell &&
        leaf.style.height === cell &&
        leaf.style.border === undefined &&
        colors.includes(String(leaf.style.backgroundColor)),
    ).length;
    // Themes that stroke their cells draw rings instead of plain squares.
    if (drawn !== cells && drawn !== 0) {
      problems.push(`heatmap says ${cells} cells, ${drawn} drawn`);
    }
    if (!(cell >= 2) || !(cells > 0)) problems.push("heatmap geometry");
    for (const color of colors) {
      if (!HEX.test(color)) problems.push(`heat colour ${color}`);
    }
  }
  if (!built.alt || /undefined|null|NaN/.test(built.alt)) {
    problems.push(`alt: ${built.alt}`);
  }
  return [...new Set(problems)];
}

function check(entity: Entity, opts: BannerOptions): BuiltBanner {
  const built = buildBanner(entity, opts, ENV);
  expect(problemsOf(built, opts)).toEqual([]);
  return built;
}

// ── hostile data ────────────────────────────────────────────────────────────

const LONG = "Wolfeschlegelsteinhausenbergerdorff ".repeat(12).trim();
const MIXED =
  "山田 太郎 🚀👩‍💻🇯🇵 مرحبا بالعالم שלום Привет Ünïcödé Z͑ͫ͗a̴l̷g̵o " +
  String.fromCharCode(0x202e) +
  "reversed" +
  String.fromCharCode(7) +
  String.fromCharCode(0xd83d);
const HUGE = Number.MAX_SAFE_INTEGER;

function hostileUsers(): Record<string, User> {
  const base = () => demoEntity("user");
  const empty = base();
  Object.assign(empty, {
    login: "x",
    name: "",
    bio: "",
    company: "",
    location: "",
    websiteUrl: "",
    createdAt: "",
    followers: 0,
    following: 0,
    stats: {
      contributions: 0,
      commits: 0,
      pullRequests: 0,
      issues: 0,
      reviews: 0,
      contributedTo: 0,
      repositories: 0,
      stars: 0,
    },
    calendar: { total: 0, from: "", to: "", days: [] },
    streak: {
      current: 0,
      currentStart: null,
      longest: 0,
      longestStart: null,
      longestEnd: null,
    },
    bestDay: null,
    years: [],
    repos: [],
    languages: [],
    organizations: [],
  });

  const long = base();
  Object.assign(long, {
    login: "a".repeat(39),
    name: LONG,
    bio: `${LONG} ${LONG}`.slice(0, 400),
    company: LONG,
    location: LONG,
    followers: HUGE,
    stats: {
      contributions: HUGE,
      commits: HUGE,
      pullRequests: 99_949,
      issues: 99_950,
      reviews: 999_499,
      contributedTo: 999_500,
      repositories: HUGE,
      stars: HUGE,
    },
    streak: {
      current: HUGE,
      currentStart: "2026-10-27",
      longest: HUGE,
      longestStart: "1970-01-01",
      longestEnd: "2026-11-13",
    },
  });
  long.calendar = { ...long.calendar, total: HUGE };
  long.repos = long.repos.map((repo) => ({
    ...repo,
    owner: "someone-else-entirely",
    name: "a-repository-name-that-goes-on-and-on-".repeat(3).slice(0, 100),
    description: LONG,
    stars: HUGE,
    forks: HUGE,
    language: { name: LONG.slice(0, 60), color: "not-a-colour" },
  }));
  long.languages = Array.from({ length: 20 }, (_, index) => ({
    name: `${LONG.slice(0, 30)} ${index}`,
    color: index % 2 ? "#12345" : "",
    percent: index === 0 ? 250 : index === 1 ? Number.NaN : 5 - index / 4,
    bytes: HUGE,
  }));

  const mixed = base();
  Object.assign(mixed, {
    name: MIXED,
    bio: `${MIXED} ${MIXED}`,
    company: MIXED,
    location: MIXED,
  });
  mixed.repos = mixed.repos.map((repo) => ({
    ...repo,
    name: MIXED,
    description: MIXED,
    language: { name: MIXED, color: "#ABCDEF" },
  }));
  mixed.languages = mixed.languages.map((language) => ({
    ...language,
    name: MIXED,
  }));

  const loading = base();
  loading.complete = false;
  loading.stats = {
    ...loading.stats,
    commits: null,
    pullRequests: null,
    issues: null,
    reviews: null,
    contributedTo: null,
    stars: null,
  };
  loading.repos = [];
  loading.languages = [];
  loading.organizations = [];

  const brokenCalendar = base();
  brokenCalendar.calendar = {
    total: 12,
    from: "not-a-date",
    to: "2026-99-99",
    days: [
      { date: "garbage", count: 3, level: 9 },
      { date: "2026-11-12", count: 1, level: -4 },
      { date: "", count: 8, level: Number.NaN },
    ],
  };
  brokenCalendar.streak = {
    current: 3,
    currentStart: "nope",
    longest: 3,
    longestStart: null,
    longestEnd: "also nope",
  };

  const endless = base();
  endless.calendar = {
    ...endless.calendar,
    days: Array.from({ length: 5000 }, (_, index) => ({
      date: `20${String(10 + Math.floor(index / 365)).padStart(2, "0")}-01-01`,
      count: index % 9,
      level: index % 5,
    })),
  };

  const leapYear = base();
  // A leap year that starts on a Saturday: 54 week columns.
  leapYear.calendar = {
    total: 366,
    from: "2000-01-01",
    to: "2000-12-31",
    days: Array.from({ length: 366 }, (_, index) => {
      const date = new Date(Date.UTC(2000, 0, 1 + index));
      return {
        date: date.toISOString().slice(0, 10),
        count: 1,
        level: (index % 4) + 1,
      };
    }),
  };

  const remote = base();
  remote.avatarUrl = "https://avatars.githubusercontent.com/u/1?v=4";
  remote.organizations = Array.from({ length: 12 }, (_, index) => ({
    login: `org-${index}`,
    avatarUrl: `https://avatars.githubusercontent.com/u/${100 + index}?v=4`,
  }));

  return {
    empty,
    long,
    mixed,
    loading,
    brokenCalendar,
    endless,
    leapYear,
    remote,
  };
}

function hostileOrgs(): Record<string, Org> {
  const long = demoEntity("org");
  Object.assign(long, {
    name: LONG,
    description: `${MIXED} ${LONG}`,
    location: LONG,
    websiteUrl: "not a url at all /?#",
    stats: {
      repositories: HUGE,
      stars: HUGE,
      forks: HUGE,
      members: null,
      followers: null,
    },
    repos: [],
    languages: [],
    activity: null,
    people: [],
  });

  const crowded = demoEntity("org");
  Object.assign(crowded, {
    isVerified: true,
    name: MIXED,
    stats: { ...crowded.stats, members: HUGE, followers: 0 },
    people: Array.from({ length: 200 }, (_, index) => ({
      login: `member-${index}`,
      avatarUrl:
        index % 3 ? `https://avatars.githubusercontent.com/u/${index}` : "",
    })),
    repos: crowded.repos.map((repo) => ({
      ...repo,
      owner: "another-owner",
      name: LONG.slice(0, 100),
      description: null,
      language: null,
      stars: HUGE,
      forks: HUGE,
    })),
  });

  const broken = demoEntity("org");
  Object.assign(broken, {
    name: "",
    description: "",
    stats: { repositories: 0, stars: 0, forks: 0, members: 0, followers: 0 },
    people: [null, { login: 7 }, { login: "x", avatarUrl: 9 }],
    activity: {
      total: Number.NaN,
      weeks: [
        null,
        { week: "garbage", commits: -1, days: [1, 2, 3] },
        { week: "2026-11-08", commits: HUGE, days: [HUGE, 0, 0, 0, 0, 0, 0] },
      ],
    },
  });
  return { long, crowded, broken };
}

function hostileRepos(): Record<string, Repo> {
  const long = demoEntity("repo");
  Object.assign(long, {
    owner: { login: "o".repeat(39), avatarUrl: "", kind: "user" },
    name: "n".repeat(100),
    fullName: `${"o".repeat(39)}/${"n".repeat(100)}`,
    description: `${MIXED} ${LONG}`,
    stars: HUGE,
    forks: HUGE,
    watchers: HUGE,
    openIssues: HUGE,
    openPullRequests: HUGE,
    language: null,
    languages: [],
    license: null,
    topics: Array.from({ length: 30 }, () => LONG.slice(0, 40)),
    isArchived: true,
    isFork: true,
    latestRelease: {
      tag: "@scope/a-very-long-package-name@12.345.678-canary.20261113.1",
      name: null,
      publishedAt: null,
    },
    commits: null,
    activity: null,
    starHistory: null,
    contributors: [],
    contributorCount: null,
  });

  const mixed = demoEntity("repo");
  Object.assign(mixed, {
    name: MIXED.slice(0, 40),
    description: MIXED,
    language: { name: MIXED, color: "javascript:alert(1)" },
    license: "NOASSERTION",
    topics: [MIXED, "", "  ", "ok", LONG, "another-topic"],
    isArchived: true,
    latestRelease: { tag: MIXED, name: MIXED, publishedAt: "not a date" },
    contributorCount: HUGE,
    contributors: Array.from({ length: 300 }, (_, index) => ({
      login: MIXED,
      avatarUrl:
        index % 2 ? "" : `https://avatars.githubusercontent.com/u/${index}`,
      contributions: index % 7 ? index : Number.NaN,
    })),
    starHistory: Array.from({ length: 400 }, (_, index) => ({
      week: "nope",
      stars: index % 5 ? index * index : Number.NaN,
    })),
  });

  const flat = demoEntity("repo");
  Object.assign(flat, {
    stars: 0,
    forks: 0,
    watchers: 0,
    openIssues: 0,
    openPullRequests: 0,
    commits: 0,
    contributorCount: 0,
    contributors: [],
    topics: [],
    description: "",
    // A history that never moved, and a year without a single commit.
    starHistory: Array.from({ length: 30 }, () => ({ week: "", stars: 7 })),
    activity: {
      total: 0,
      weeks: Array.from({ length: 52 }, (_, index) => ({
        week: `2025-${String((index % 12) + 1).padStart(2, "0")}-01`,
        commits: 0,
        days: [0, 0, 0, 0, 0, 0, 0],
      })),
    },
  });

  const weekly = demoEntity("repo");
  Object.assign(weekly, {
    activity: {
      total: HUGE,
      weeks: Array.from({ length: 90 }, (_, index) => ({
        week: "",
        commits: index === 40 ? HUGE : index % 9,
        days: null,
      })),
    },
  });

  const garbage = demoEntity("repo");
  Object.assign(garbage, {
    activity: { total: "many", weeks: [1, "two", { days: "all" }, {}] },
    starHistory: "rising",
    contributors: [null, 4, { login: "a" }, { avatarUrl: "b" }],
    topics: "all of them",
    owner: { login: "", avatarUrl: 5, kind: "robot" },
    latestRelease: { tag: "", name: null, publishedAt: null },
  });
  return { long, mixed, flat, weekly, garbage };
}

const CUSTOM_CANVASES = [
  "width=320",
  "width=495",
  "width=3000",
  "width=320&height=120",
  "width=3000&height=3000",
  "width=3000&height=120",
  "width=320&height=3000",
  "width=495&height=195",
  "size=x&width=320",
  "size=x&width=3000",
  "size=linkedin&height=120",
  "size=square&width=320",
];

// ── tests ───────────────────────────────────────────────────────────────────

describe("buildBanner", () => {
  test("every preset of every kind on every size in every theme", () => {
    let count = 0;
    for (const preset of PRESETS) {
      const entity = demoEntity(preset.kind);
      for (const size of SIZE_IDS) {
        for (const theme of THEMES) {
          const opts = options(
            preset.kind,
            preset.id,
            `size=${size}&theme=${theme.id}`,
          );
          const built = buildBanner(entity, opts, ENV);
          expect({
            preset: `${preset.kind}/${preset.id}`,
            size,
            theme: theme.id,
            problems: problemsOf(built, opts),
          }).toEqual({
            preset: `${preset.kind}/${preset.id}`,
            size,
            theme: theme.id,
            problems: [],
          });
          expect(built.theme.id).toBe(theme.id);
          count += 1;
        }
      }
    }
    expect(PRESETS).toHaveLength(16);
    expect(count).toBe(16 * 6 * THEMES.length);
  });

  test("the year in review for a calendar year, on every size and theme", () => {
    for (const year of [2026, 2025, 2012]) {
      const user = demoEntity("user", { year });
      for (const size of SIZE_IDS) {
        for (const theme of THEMES) {
          check(
            user,
            options(
              "user",
              "wrapped",
              `size=${size}&theme=${theme.id}&year=${year}`,
            ),
          );
        }
      }
    }
  });

  test("custom canvases", () => {
    for (const kind of KINDS) {
      for (const preset of presetsFor(kind)) {
        for (const query of CUSTOM_CANVASES) {
          check(demoEntity(kind), options(kind, preset.id, query));
        }
      }
    }
  });

  test("hostile users on every preset, size and custom canvas", () => {
    for (const [name, user] of Object.entries(hostileUsers())) {
      for (const preset of presetsFor("user")) {
        for (const query of [
          ...SIZE_IDS.map((size) => `size=${size}`),
          ...CUSTOM_CANVASES,
        ]) {
          const opts = options("user", preset.id, query);
          const built = buildBanner(user, opts, ENV);
          expect({
            name,
            preset: preset.id,
            query,
            problems: problemsOf(built, opts),
          }).toEqual({
            name,
            preset: preset.id,
            query,
            problems: [],
          });
        }
      }
    }
  });

  test("hostile organizations and repositories on every preset, size and custom canvas", () => {
    const entities: [string, Entity][] = [
      ...Object.entries(hostileOrgs()),
      ...Object.entries(hostileRepos()),
    ];
    for (const [name, entity] of entities) {
      for (const preset of presetsFor(entity.kind)) {
        for (const query of [
          ...SIZE_IDS.map((size) => `size=${size}`),
          ...CUSTOM_CANVASES,
          "theme=github-light-high-contrast&font=mono",
          "size=og&hide=avatar,description,meta,topics,title,legend,labels",
          "size=square&count=30&stats=stars,release,contributors,totalCommits,watchers,forks,openIssues,openPullRequests,members,followers,repositories",
        ]) {
          const opts = options(entity.kind, preset.id, query);
          const built = buildBanner(entity, opts, ENV);
          expect({
            name,
            preset: preset.id,
            query,
            problems: problemsOf(built, opts),
          }).toEqual({ name, preset: preset.id, query, problems: [] });
        }
      }
    }
  });

  test("a hostile year in review", () => {
    const user = demoEntity("user", { year: 2026 });
    const cases: Record<string, unknown> = {
      garbage: { year: "soon", previousTotal: "many", topRepos: "none" },
      huge: {
        year: 2026,
        previousTotal: 1,
        topRepos: Array.from({ length: 50 }, () => ({
          fullName: `${LONG.slice(0, 39)}/${LONG.slice(0, 100)}`,
          commits: HUGE,
        })),
      },
      mixed: {
        year: 2026,
        previousTotal: HUGE,
        topRepos: [
          { fullName: MIXED, commits: 3 },
          { fullName: "", commits: 9 },
          null,
        ],
      },
    };
    for (const [name, wrapped] of Object.entries(cases)) {
      const hostile = { ...user, wrapped } as User;
      for (const query of [
        ...SIZE_IDS.map((size) => `size=${size}&year=2026`),
        ...CUSTOM_CANVASES,
        "count=30&size=square",
        "font=mono&size=x",
      ]) {
        const opts = options("user", "wrapped", query);
        const built = buildBanner(hostile, opts, ENV);
        expect({ name, query, problems: problemsOf(built, opts) }).toEqual({
          name,
          query,
          problems: [],
        });
      }
    }
  });

  test("hide, show, colours, fonts and the other options", () => {
    const user = demoEntity("user");
    const queries = [
      "hide=avatar,bio,meta,title,legend,labels,topics,description",
      "hide=legend,labels&size=x",
      "hide=title&size=og",
      "hide=avatar&size=linkedin",
      "show=heatmap",
      "show=stats",
      "show=stats,heatmap&size=x",
      "show=header",
      "show=streak,repos,languages,orgs,stats,header,heatmap",
      "show=streak,repos,languages,orgs,stats,header,heatmap&size=square",
      "show=orgs&size=x",
      "show=people,activity,contributors,wrapped",
      "show=people,activity,contributors,wrapped&size=x",
      "stats=streak,stars,forks,members,release&show=header,stats",
      "stats=contributions,commits,pullRequests,issues,reviews,contributedTo,followers,streak,stars,repositories&size=og",
      "count=1&show=header,repos",
      "count=30&show=header,repos,languages&size=square",
      "heat=ff7b72",
      "heat=000&bg=000&surface=000&text=fff",
      "heat=fff,ccc,999,666,333&theme=github-light",
      "bg=fffdf5&text=2b2118&muted=7a6a58&border_color=e6dcc8&surface=f4ecda&accent=d9480f",
      "font=mono",
      "font=mono&size=x",
      "radius=0&border=0",
      "radius=64&border=1&size=og",
      "brand=0",
      "brand=0&size=x",
      "title=Shipping%20every%20day&year=2025",
      `title=${encodeURIComponent(LONG.slice(0, 80))}&size=x`,
      "year=2025&size=og",
    ];
    for (const preset of presetsFor("user")) {
      for (const query of queries)
        check(user, options("user", preset.id, query));
    }
  });

  test("hand-built options are re-validated, not trusted", () => {
    const user = demoEntity("user");
    const junk = {
      preset: "nope",
      sections: ["header", "nope", 7],
      size: "billboard",
      width: Number.NaN,
      height: -50,
      theme: "nope",
      colors: { bg: "url(javascript:alert(1))", text: 7, heat: ["#fff"] },
      font: "comic",
      radius: 1e9,
      border: "yes",
      title: { toString: () => "x" },
      year: "soon",
      stats: "all",
      count: Number.POSITIVE_INFINITY,
      hide: null,
      brand: "false",
      animate: 1,
    } as unknown as BannerOptions;
    const built = buildBanner(user, junk, ENV);
    expect(problemsOf(built, resolveOptions("user", null))).toEqual([]);
    expect(built.theme.id).toBe("github-dark");
    expect(built.font.id).toBe("mona");
    for (const nothing of [null, undefined, {}]) {
      expect(() =>
        buildBanner(user, nothing as unknown as BannerOptions, ENV),
      ).not.toThrow();
    }
  });

  test("a hostile environment cannot break a banner", () => {
    const user = hostileUsers().remote;
    const opts = options("user", "overview", "show=header,orgs,heatmap");
    const throwing = buildBanner(user, opts, {
      ...ENV,
      image: () => {
        throw new Error("no network");
      },
    });
    expect(problemsOf(throwing, opts)).toEqual([]);
    const odd = buildBanner(user, opts, {
      image: () => undefined as unknown as string,
      now: new Date(Number.NaN),
      host: "",
    });
    expect(problemsOf(odd, opts)).toEqual([]);
    expect(JSON.stringify(odd.element)).not.toContain("gitbanners");
  });

  test("is deterministic and does not read the clock", () => {
    const user = demoEntity("user");
    const opts = options("user", "overview", "size=x");
    const first = JSON.stringify(buildBanner(user, opts, ENV).element);
    const realNow = Date.now;
    Date.now = () => {
      throw new Error("the engine must use env.now");
    };
    try {
      expect(JSON.stringify(buildBanner(user, opts, ENV).element)).toBe(first);
    } finally {
      Date.now = realNow;
    }
    expect(JSON.stringify(demoEntity("user"))).toBe(JSON.stringify(user));
  });

  test("the README height follows the content", () => {
    const user = demoEntity("user");
    const overview = check(user, options("user", "overview"));
    const activity = check(user, options("user", "activity"));
    const all = check(
      user,
      options(
        "user",
        "overview",
        "show=header,stats,streak,repos,languages,heatmap",
      ),
    );
    expect(overview.width).toBe(846);
    expect(activity.height).toBeLessThan(overview.height);
    expect(all.height).toBeGreaterThan(overview.height);
    expect(check(user, options("user", "card")).width).toBe(495);
  });

  test("fixed sizes are exactly their size", () => {
    const user = demoEntity("user");
    const sizes = {
      x: [1500, 500],
      linkedin: [1584, 396],
      og: [1200, 630],
      social: [1280, 640],
      square: [1080, 1080],
    };
    for (const [size, [width, height]] of Object.entries(sizes)) {
      for (const preset of presetsFor("user")) {
        const built = check(user, options("user", preset.id, `size=${size}`));
        expect([built.width, built.height]).toEqual([width, height]);
      }
    }
    const scaled = check(
      user,
      options("user", "overview", "size=x&width=3000"),
    );
    expect([scaled.width, scaled.height]).toEqual([3000, 1000]);
  });

  test("reports the theme, the font and the heatmap it drew", () => {
    const user = demoEntity("user");
    const built = check(
      user,
      options("user", "overview", "theme=dracula&font=mono&bg=101010"),
    );
    expect(built.theme.id).toBe("dracula");
    expect(built.theme.colors.bg).toBe("#101010");
    expect(built.font).toEqual({
      id: "mono",
      name: "Mona Sans Mono",
      family: "Mona Sans Mono",
    });
    expect(built.heatmap).toMatchObject({
      cell: 11,
      gap: 3,
      cells: user.calendar.days.length,
    });
    expect(built.heatmap?.colors).toHaveLength(5);
    expect(check(user, options("user", "stats")).heatmap).toBeNull();
    expect(check(demoEntity("repo"), options("repo", null)).heatmap).toBeNull();
    // Shortest lower-case hex: that is how the SVG writer prints fills.
    const custom = check(
      user,
      options("user", "activity", "heat=FFFFFF,AABBCC,112233,123456,000000"),
    );
    expect(custom.heatmap?.colors).toEqual([
      "#fff",
      "#abc",
      "#123",
      "#123456",
      "#000",
    ]);
  });

  test("tiles show a dash while loading and disappear once complete", () => {
    const loading = hostileUsers().loading;
    const text = bannerText(loading, options("user", "stats"));
    expect(text).toContain("–");
    expect(text).toContain("Commits");
    const settled = { ...loading, complete: true };
    const settledText = bannerText(settled, options("user", "stats"));
    expect(settledText).not.toContain("–");
    expect(settledText).not.toContain("Commits");
    expect(settledText).toContain("Followers");
  });
});

describe("what a banner shows", () => {
  const user = demoEntity("user");
  const text = (entity: Entity, preset: string | null, query = "") =>
    buildBannerText(entity, options(entity.kind, preset, query));

  function buildBannerText(entity: Entity, opts: BannerOptions): string {
    return JSON.stringify(buildBanner(entity, opts, ENV).element);
  }

  test("the brand mark is the host and the banner's own path", () => {
    expect(text(user, "overview")).toContain("gitbanners.test/mona-demo");
    expect(text(demoEntity("repo"), null)).toContain(
      "gitbanners.test/acme-labs/rocket",
    );
    expect(text(user, "overview", "brand=0")).not.toContain("gitbanners.test");
    // Reserved logins keep their escape, and a full URL is cut down to its host.
    const reserved = { ...user, login: "docs" };
    const built = buildBanner(reserved, options("user", "activity"), {
      ...ENV,
      host: "https://gitbanners.test/some/path?x=1",
    });
    expect(JSON.stringify(built.element)).toContain("gitbanners.test/@docs");
    expect(JSON.stringify(built.element)).not.toContain("https://");
  });

  test("a login is not printed twice when there is no display name", () => {
    const named = text(user, "overview");
    expect(named).toContain("Mona Demo");
    expect(named).toContain("@mona-demo");
    const unnamed = bannerText(
      { ...user, name: null },
      options("user", "overview", "brand=0"),
    );
    expect(unnamed).toContain("mona-demo");
    expect(unnamed).not.toContain("@mona-demo");
  });

  test("the caption follows the range, the title option and hide=title", () => {
    const total = user.calendar.total.toLocaleString("en-US");
    expect(text(user, "activity")).toContain(
      `${total} contributions in the last year`,
    );
    expect(text(user, "activity", "year=2025")).toContain(
      `${total} contributions in 2025`,
    );
    expect(text(user, "activity", "title=Shipping%20every%20day")).toContain(
      "Shipping every day",
    );
    expect(
      text(user, "activity", "title=Shipping%20every%20day"),
    ).not.toContain("contributions in");
    expect(text(user, "activity", "hide=title")).not.toContain(
      "contributions in",
    );
    expect(text(user, "streak")).toContain("longest in the last 12 months");
    expect(text(user, "streak", "year=2025")).toContain("longest in 2025");
    const quiet = { ...user, calendar: { ...user.calendar, total: 0 } };
    expect(text(quiet, "activity")).toContain(
      "No public contributions in the last year",
    );
  });

  test("a custom title heads banners that have no graph to caption", () => {
    for (const query of ["", "size=x", "size=og", "size=square"]) {
      const shown = text(
        user,
        "stats",
        `title=Open%20source%20in%20numbers&${query}`,
      );
      expect(shown).toContain("Open source in numbers");
      expect(
        text(user, "languages", `title=What%20I%20write&hide=title&${query}`),
      ).not.toContain("What I write");
    }
  });

  test("hidden parts are gone", () => {
    expect(text(user, "overview")).toContain("Less");
    expect(text(user, "overview", "hide=legend")).not.toContain("Less");
    expect(text(user, "overview")).toContain("Mon");
    expect(text(user, "overview", "hide=labels")).not.toContain('Mon"');
    expect(text(user, "overview")).toContain("Lisbon, Portugal");
    expect(text(user, "overview", "hide=meta")).not.toContain(
      "Lisbon, Portugal",
    );
    expect(text(user, "overview", "hide=avatar")).not.toContain("<img");
    expect(text(user, "overview", "hide=avatar")).not.toContain("data:image");
  });

  test("a banner does not change size while its data streams in", () => {
    const loading: User = {
      ...user,
      complete: false,
      stats: {
        ...user.stats,
        commits: null,
        pullRequests: null,
        issues: null,
        reviews: null,
        contributedTo: null,
        stars: null,
      },
      repos: [],
      languages: [],
    };
    for (const preset of ["overview", "stats", "repos", "languages", "card"]) {
      const before = buildBanner(loading, options("user", preset), ENV);
      const after = buildBanner(user, options("user", preset), ENV);
      expect({ preset, height: before.height }).toEqual({
        preset,
        height: after.height,
      });
      expect(problemsOf(before, options("user", preset))).toEqual([]);
    }
    // Once the data is complete an owner without repositories has no cards.
    const none = { ...loading, complete: true };
    expect(
      buildBanner(none, options("user", "repos"), ENV).height,
    ).toBeLessThan(buildBanner(user, options("user", "repos"), ENV).height);
  });

  test("organizations and repositories get their own identity line", () => {
    const org = text(demoEntity("org"), null);
    expect(org).toContain("Acme Labs");
    expect(org).toContain("Verified");
    expect(text(demoEntity("org"), null, "size=og")).toContain("example.com");
    const repo = text(demoEntity("repo"), null);
    expect(repo).toContain("acme-labs/");
    expect(repo).toContain("rocket");
    expect(repo).toContain("MIT");
    expect(repo).toContain("v4.2.0");
    const archived = { ...demoEntity("repo"), isArchived: true, isFork: true };
    expect(text(archived, null)).toContain("Archived");
  });
});

describe("altText", () => {
  test("users, organizations and repositories", () => {
    const user = demoEntity("user");
    expect(buildBanner(user, options("user", null), ENV).alt).toBe(
      `GitHub banner for Mona Demo (@mona-demo): ${user.calendar.total.toLocaleString("en-US")} contributions in the last year, 30,234 stars, 1,284 followers.`,
    );
    expect(altText(user, { year: 2025 })).toContain("contributions in 2025");
    expect(
      altText(
        { ...user, name: null, stats: { ...user.stats, stars: null } },
        { year: null },
      ),
    ).toBe(
      `GitHub banner for @mona-demo: ${user.calendar.total.toLocaleString("en-US")} contributions in the last year, 1,284 followers.`,
    );
    expect(altText(demoEntity("org"), { year: null })).toBe(
      "GitHub banner for Acme Labs (@acme-labs): 128 public repositories, 48,210 stars, 36 public members.",
    );
    expect(altText(demoEntity("repo"), { year: null })).toBe(
      "acme-labs/rocket: A fast, friendly build tool for the modern web. Demo data. 18,432 stars, 912 forks.",
    );
    const bare = {
      ...demoEntity("repo"),
      description: null,
      stars: 1,
      forks: 1,
    };
    expect(altText(bare, { year: null })).toBe(
      "acme-labs/rocket. 1 star, 1 fork.",
    );
  });
});

describe("collectImages", () => {
  test("lists remote images once, with the largest size they are drawn at", () => {
    const user = hostileUsers().remote;
    const env = { now: ENV.now, host: ENV.host };
    const images = collectImages(
      user,
      options("user", "overview", "show=header,orgs,heatmap"),
      env,
    );
    expect(images[0]).toEqual({ url: user.avatarUrl, px: 56 });
    expect(images).toHaveLength(9);
    expect(new Set(images.map((image) => image.url)).size).toBe(images.length);
    for (const image of images) {
      expect(image.url.startsWith("https://")).toBe(true);
      expect(image.px).toBeGreaterThan(0);
      expect(Number.isInteger(image.px)).toBe(true);
    }
    expect(
      collectImages(user, options("user", "overview", "hide=avatar"), env),
    ).toEqual([]);
    expect(
      collectImages(user, options("user", "overview", "size=x"), env),
    ).toEqual([{ url: user.avatarUrl, px: 72 }]);
  });

  test("inline images need no fetching", () => {
    const env = { now: ENV.now, host: ENV.host };
    for (const kind of KINDS) {
      expect(collectImages(demoEntity(kind), options(kind, null), env)).toEqual(
        [],
      );
    }
  });

  test("the banner draws what the environment returns", () => {
    const user = hostileUsers().remote;
    const built = buildBanner(user, options("user", "overview"), {
      ...ENV,
      image: (url, px) => `data:image/png;base64,${btoa(`${url}@${px}`)}`,
    });
    expect(JSON.stringify(built.element)).toContain(
      `data:image/png;base64,${btoa(`${user.avatarUrl}@56`)}`,
    );
  });
});

describe("bannerText", () => {
  test("is the text of the image, nothing more", () => {
    const user = demoEntity("user");
    const overview = bannerText(user, options("user", "overview"));
    expect(overview).toContain("Mona Demo");
    expect(overview).toContain("@mona-demo");
    expect(overview).toContain(user.bio ?? "");
    expect(overview).toContain("Lisbon, Portugal");
    expect(overview).toContain("Contributions");
    expect(overview).not.toContain("paper-lantern");
    expect(
      bannerText(user, options("user", "overview", "hide=bio")),
    ).not.toContain(user.bio ?? "");
    const repos = bannerText(user, options("user", "repos"));
    expect(repos).toContain("paper-lantern");
    expect(repos).toContain("Tiny terminal UI toolkit");
    expect(
      bannerText(user, options("user", "activity", "title=%E6%97%A5%E6%9C%AC")),
    ).toContain("日本");
  });

  test("carries the scripts the base font cannot draw", () => {
    const text = bannerText(hostileUsers().mixed, options("user", "repos"));
    for (const sample of ["山田", "مرحبا", "Привет", "🚀"])
      expect(text).toContain(sample);
    // Control characters and bidi overrides never reach the renderer.
    expect(text).not.toContain(String.fromCharCode(7));
    expect(text).not.toContain(String.fromCharCode(0x202e));
    expect(text.isWellFormed()).toBe(true);
  });
});

describe("buildMessageBanner", () => {
  test("draws a message in the requested theme and size", () => {
    const message = { title: "No GitHub account named mona-missing" };
    const card = buildMessageBanner(message, resolveOptions("user", null), ENV);
    expect(card.width).toBe(846);
    expect(card.height).toBeLessThan(120);
    expect(card.alt).toBe(message.title);
    expect(card.heatmap).toBeNull();
    expect(JSON.stringify(card.element)).toContain(message.title);
    expect(problemsOf(card, resolveOptions("user", null))).toEqual([]);

    for (const preset of PRESETS) {
      for (const query of [
        ...SIZE_IDS.map((size) => `size=${size}`),
        ...CUSTOM_CANVASES,
      ]) {
        for (const theme of ["dracula", "github-light"]) {
          const opts = options(
            preset.kind,
            preset.id,
            `${query}&theme=${theme}`,
          );
          const built = buildMessageBanner(
            { title: "GitHub is not answering. Retrying soon.", detail: LONG },
            opts,
            ENV,
          );
          expect(built.theme.id).toBe(theme);
          expect(problemsOf(built, opts)).toEqual([]);
        }
      }
    }
  });

  test("is total", () => {
    const opts = resolveOptions("user", null);
    for (const message of [
      { title: "" },
      { title: MIXED, detail: MIXED },
      {},
      null,
    ]) {
      expect(() =>
        buildMessageBanner(message as never, opts, ENV),
      ).not.toThrow();
    }
  });
});

// ── repositories, organizations and the year in review ──────────────────────

/** Builds a banner, checks it, and returns it with its leaves. */
function drawn(entity: Entity, preset: string | null, query = "") {
  const opts = options(entity.kind, preset, query);
  const built = check(entity, opts);
  const { leaves } = inspect(built);
  return {
    built,
    leaves,
    texts: leaves.filter((leaf) => leaf.text).map((leaf) => leaf.text),
    images: leaves.filter((leaf) => leaf.tag === "img"),
    /** Text leaves whose whole text is `text`. */
    exact: (text: string) => leaves.filter((leaf) => leaf.text === text),
  };
}

function repoWith(patch: (repo: Repo) => void): Repo {
  const repo = demoEntity("repo");
  patch(repo);
  return repo;
}

function orgWith(patch: (org: Org) => void): Org {
  const org = demoEntity("org");
  patch(org);
  return org;
}

const number = (n: number) => n.toLocaleString("en-US");

describe("repository banners", () => {
  const repo = demoEntity("repo");

  test("the header: owner and name, facts, description, topics", () => {
    const { texts, leaves, images } = drawn(repo, "overview");
    expect(texts).toContain("acme-labs/rocket");
    expect(texts).toContain("TypeScript · MIT · v4.2.0");
    expect(texts).toContain(repo.description ?? "");
    for (const topic of repo.topics) expect(texts).toContain(topic);
    // The owner is an organization: a rounded square, not a circle.
    expect(images).toHaveLength(1);
    expect(images[0]?.style.borderRadius).toBeLessThan(10);
    // The language keeps its Linguist colour as a dot in front of the facts.
    const dot = leaves.find(
      (leaf) => leaf.style.backgroundColor === "#3178c6" && !leaf.text,
    );
    expect(dot?.style.width).toBe(dot?.style.height);
    expect(dot?.style.borderRadius).toBe((dot?.style.width as number) / 2);

    const personal = repoWith((r) => {
      r.owner = { ...r.owner, kind: "user" };
    });
    const avatar = drawn(personal, "overview").images[0];
    expect(avatar?.style.borderRadius).toBe(
      (avatar?.style.width as number) / 2,
    );
  });

  test("at most four topics, in the owner's order", () => {
    const many = repoWith((r) => {
      r.topics = ["one", "two", "three", "four", "five", "six"];
    });
    const { texts } = drawn(many, "overview");
    expect(texts.filter((text) => /^(one|two|three|four)$/.test(text))).toEqual(
      ["one", "two", "three", "four"],
    );
    expect(texts).not.toContain("five");
    // A topic that does not fit ends the row: none is cut, none is skipped.
    const wide = repoWith((r) => {
      r.topics = ["first", "x".repeat(140), "third"];
    });
    const shown = drawn(wide, "overview").texts;
    expect(shown).toContain("first");
    expect(shown).not.toContain("third");
  });

  test("hide=description, topics and meta remove exactly those", () => {
    const all = drawn(repo, "overview").texts;
    const hidden = (ids: string) =>
      drawn(repo, "overview", `hide=${ids}`).texts;
    expect(hidden("description")).not.toContain(repo.description ?? "");
    expect(hidden("description")).toContain("build-tool");
    expect(hidden("topics")).not.toContain("build-tool");
    expect(hidden("topics")).toContain(repo.description ?? "");
    expect(hidden("meta")).not.toContain("TypeScript · MIT · v4.2.0");
    expect(hidden("meta")).toContain("acme-labs/rocket");
    expect(hidden("description,topics,meta").length).toBeLessThan(all.length);
    // The preset hides topics on the banners that are about something else.
    expect(drawn(repo, "activity").texts).not.toContain("build-tool");
  });

  test("Archived and Fork are labels beside the name", () => {
    expect(drawn(repo, "overview").exact("Archived")).toHaveLength(0);
    const { exact, leaves } = drawn(
      repoWith((r) => {
        r.isArchived = true;
        r.isFork = true;
      }),
      "overview",
    );
    const [archived] = exact("Archived");
    const [fork] = exact("Fork");
    const title = leaves.find((leaf) => leaf.text === "acme-labs/rocket");
    // GitHub's attention colour for the archive, the muted one for a fork.
    expect(archived?.style.color).toBe("#d29922");
    expect(fork?.style.color).toBe("#9198a1");
    // On the title's line, after it, in that order.
    expect(archived?.box?.x).toBeGreaterThan(
      (title?.box?.x ?? 0) + (title?.box?.w ?? 0),
    );
    expect(fork?.box?.x).toBeGreaterThan(
      (archived?.box?.x ?? 0) + (archived?.box?.w ?? 0),
    );
    expect(archived?.box?.y).toBeLessThan(
      (title?.box?.y ?? 0) + (title?.box?.h ?? 0),
    );
    for (const size of SIZE_IDS) {
      const text = drawn(
        repoWith((r) => {
          r.isArchived = true;
        }),
        "overview",
        `size=${size}`,
      ).texts;
      // As a pill where the name leaves room, else at the head of the facts.
      expect({
        size,
        archived: text.some((item) => /^Archived\b/.test(item)),
      }).toEqual({ size, archived: true });
    }
  });

  test("facts that say nothing are left out", () => {
    const { texts } = drawn(
      repoWith((r) => {
        r.license = "NOASSERTION";
        r.language = null;
      }),
      "overview",
    );
    expect(texts.join("|")).not.toContain("NOASSERTION");
    expect(texts).toContain("v4.2.0");
    // A release tile already carries the tag: the facts do not repeat it.
    const release = drawn(repo, "release").texts;
    expect(release.filter((text) => text.includes("v4.2.0"))).toEqual([
      "v4.2.0",
    ]);
    expect(release).toContain("TypeScript · MIT");
  });

  test("tiles drop what GitHub did not tell", () => {
    const { texts } = drawn(
      repoWith((r) => {
        r.commits = null;
        r.contributorCount = null;
        r.latestRelease = null;
      }),
      "activity",
    );
    for (const label of ["Commits", "Contributors", "Latest release"]) {
      expect(texts).not.toContain(label);
    }
    expect(drawn(repo, "activity").texts).toEqual(
      expect.arrayContaining(["Commits", "Contributors", "Released last week"]),
    );
  });

  test("star history is a trend line beside the Stars tile, or nothing", () => {
    const trends = (entity: Repo, preset: string, query = "") =>
      drawn(entity, preset, query).leaves.filter(
        (leaf) => leaf.tag === "svg" && leaf.children === 2,
      );
    const without = { ...repo, starHistory: null };
    for (const [preset, query] of [
      ["overview", ""],
      ["overview", "size=og"],
      ["overview", "size=social"],
      ["social", ""],
    ] as const) {
      const [trend] = trends(repo, preset, query);
      const stars = drawn(repo, preset, query).exact("18.4k")[0];
      expect({
        preset,
        query,
        drawn: trends(repo, preset, query).length,
      }).toEqual({ preset, query, drawn: 1 });
      // As tall as the digits, on their line, and clear of them.
      expect(trend?.box?.h).toBeLessThan(stars?.box?.h ?? 0);
      expect(trend?.box?.y).toBeGreaterThanOrEqual(stars?.box?.y ?? 0);
      const [left, right] =
        (trend?.box?.x ?? 0) < (stars?.box?.x ?? 0)
          ? [trend, stars]
          : [stars, trend];
      expect((left?.box?.x ?? 0) + (left?.box?.w ?? 0)).toBeLessThan(
        right?.box?.x ?? 0,
      );
      expect(trends(without, preset, query)).toHaveLength(0);
      // The line never moves a tile: with and without it the banner is the same size.
      expect(drawn(without, preset, query).built.height).toBe(
        drawn(repo, preset, query).built.height,
      );
    }
    // No Stars tile, no trend.
    expect(trends(repo, "activity")).toHaveLength(0);
    // The line takes spare room and never asks for any: a row packed to fit
    // all four tiles beside a profile photo has none, and shows the tiles.
    expect(trends(repo, "overview", "size=x")).toHaveLength(0);
    expect(drawn(repo, "overview", "size=x").texts).toEqual(
      expect.arrayContaining([
        "Stars",
        "Forks",
        "Open issues",
        "Open pull requests",
      ]),
    );
  });
});

describe("repository activity", () => {
  const repo = demoEntity("repo");
  const total = number(repo.activity?.total ?? 0);
  const bars = (leaves: Leaf[]) =>
    leaves.filter((leaf) => leaf.style.borderTopLeftRadius !== undefined);

  test("the commit calendar on every standard size", () => {
    for (const size of SIZE_IDS) {
      const { built } = drawn(repo, "activity", `size=${size}`);
      // 52 weeks of seven days, minus the Saturday that has not happened yet.
      expect({ size, cells: built.heatmap?.cells }).toEqual({
        size,
        cells: 52 * 7 - 1,
      });
    }
    const { texts, built } = drawn(repo, "activity");
    expect(texts).toContain(`${total} commits in the last year`);
    expect(texts).toEqual(expect.arrayContaining(["Less", "More", "Mon"]));
    // The same cell size as a profile's graph on the same card.
    expect(built.heatmap).toMatchObject({ cell: 11, gap: 3 });
  });

  test("on a poster the total is the headline", () => {
    const { texts } = drawn(repo, "activity", "size=og");
    expect(texts).toContain(total);
    expect(texts).toContain("commits in the last year");
    expect(texts).not.toContain(`${total} commits in the last year`);
  });

  test("while GitHub computes, a quiet placeholder of the same size", () => {
    const computing = { ...repo, activity: null };
    for (const preset of ["activity", "release"]) {
      for (const size of SIZE_IDS) {
        const query = `size=${size}`;
        const pending = drawn(computing, preset, query);
        const ready = drawn(repo, preset, query);
        expect(pending.texts).toContain("GitHub is calculating activity");
        expect(pending.texts.join("|")).not.toContain(
          "commits in the last year",
        );
        expect(pending.texts).not.toContain("Less");
        // Nothing to animate, and nothing jumps when the data arrives.
        expect(pending.built.heatmap).toBeNull();
        expect({ preset, size, height: pending.built.height }).toEqual({
          preset,
          size,
          height: ready.built.height,
        });
      }
    }
    // The message is a state, not a title.
    expect(drawn(computing, "activity", "hide=title").texts).toContain(
      "GitHub is calculating activity",
    );
  });

  test("weekly bars when the calendar does not apply", () => {
    const weeklyOnly = repoWith((r) => {
      if (!r.activity) return;
      r.activity = {
        ...r.activity,
        weeks: r.activity.weeks.map((week) => ({ ...week, days: null })),
      };
    });
    const busy = (repo.activity?.weeks ?? []).filter(
      (week) => week.commits > 0,
    ).length;
    for (const [entity, preset, query] of [
      [weeklyOnly, "activity", ""],
      [weeklyOnly, "activity", "size=og"],
      [repo, "activity", "width=495"],
      [repo, "release", ""],
      [repo, "release", "size=square"],
    ] as const) {
      const { built, leaves, texts } = drawn(entity, preset, query);
      expect(built.heatmap).toBeNull();
      expect({ preset, query, bars: bars(leaves).length }).toEqual({
        preset,
        query,
        bars: busy,
      });
      expect(texts).toContain(`${total} commits in the last year`);
    }
  });

  test("bars stand on one baseline, evenly spaced, the busiest the tallest", () => {
    const { leaves } = drawn(repo, "release");
    const drawnBars = bars(leaves);
    const bottoms = new Set(
      drawnBars.map((bar) => (bar.box?.y ?? 0) + (bar.box?.h ?? 0)),
    );
    expect(bottoms.size).toBe(1);
    const widths = new Set(drawnBars.map((bar) => bar.box?.w));
    expect(widths.size).toBe(1);
    const xs = drawnBars.map((bar) => bar.box?.x ?? 0);
    const pitch = Math.min(
      ...xs.slice(1).map((x, index) => x - (xs[index] ?? 0)),
    );
    for (const x of xs) expect((x - (xs[0] ?? 0)) % pitch).toBe(0);
    const weeks = (repo.activity?.weeks ?? []).filter(
      (week) => week.commits > 0,
    );
    const busiest = weeks.reduce(
      (best, week, index) =>
        week.commits > (weeks[best]?.commits ?? 0) ? index : best,
      0,
    );
    const tallest = Math.max(...drawnBars.map((bar) => bar.box?.h ?? 0));
    expect(drawnBars[busiest]?.box?.h).toBe(tallest);
    // Bars are coloured from the theme's heat ramp, never from outside it.
    const ramp = ["#033a16", "#196c2e", "#2ea043", "#56d364"];
    for (const bar of drawnBars) {
      expect(ramp).toContain(String(bar.style.backgroundColor));
    }
  });

  test("a year without commits says so", () => {
    const idle = repoWith((r) => {
      if (!r.activity) return;
      r.activity = {
        total: 0,
        weeks: r.activity.weeks.map((week) => ({
          ...week,
          commits: 0,
          days: [0, 0, 0, 0, 0, 0, 0],
        })),
      };
    });
    expect(drawn(idle, "activity").texts).toContain(
      "No commits in the last year",
    );
    const release = drawn(idle, "release");
    expect(release.texts).toContain("No commits in the last year");
    expect(bars(release.leaves)).toHaveLength(0);
    const single = repoWith((r) => {
      if (!r.activity) return;
      r.activity = { ...r.activity, total: 1 };
    });
    expect(drawn(single, "activity").texts).toContain(
      "1 commit in the last year",
    );
  });
});

describe("repository contributors", () => {
  const repo = demoEntity("repo");
  /** Avatars of the grid: every image but the owner's. */
  const faces = (images: Leaf[]) => images.slice(1);

  test("a README card: two full rows of 14, the last place a +N chip", () => {
    const { images, texts, exact, built } = drawn(repo, "contributors");
    const grid = faces(images);
    expect(grid).toHaveLength(27);
    expect(texts).toContain("+187");
    expect(texts).toEqual(expect.arrayContaining(["214", "Contributors"]));
    // 48 px avatars with 8 px gaps, grown by the pixel that fills the row.
    const sizes = new Set(grid.map((face) => face.box?.w));
    expect([...sizes]).toEqual([49]);
    const row = grid.slice(0, 14);
    expect(row.every((face) => face.box?.y === row[0]?.box?.y)).toBe(true);
    const gaps = row
      .slice(1)
      .map(
        (face, index) => (face.box?.x ?? 0) - (row[index]?.box?.x ?? 0) - 49,
      );
    expect(gaps.every((gap) => gap === 8 || gap === 9)).toBe(true);
    // The rows reach both margins, and the chip closes the second one.
    expect(row[0]?.box?.x).toBe(24);
    expect((row[13]?.box?.x ?? 0) + 49).toBe(built.width - 24);
    const [chip] = exact("+187");
    expect((chip?.box?.x ?? 0) + (chip?.box?.w ?? 0)).toBe(built.width - 24);
    expect(chip?.box?.y).toBe(grid[26]?.box?.y);
    // Circles, every one.
    expect(grid.every((face) => face.style.borderRadius === 24.5)).toBe(true);
  });

  test("ordered by contributions, whatever order they arrive in", () => {
    const shuffled = repoWith((r) => {
      r.contributors = [...r.contributors].reverse();
    });
    const expected = [...repo.contributors]
      .sort((a, b) => b.contributions - a.contributions)
      .slice(0, 27)
      .map((person) => person.avatarUrl);
    expect(
      faces(drawn(shuffled, "contributors").images).map((face) => face.src),
    ).toEqual(expected);
  });

  test("the chip counts everyone without a face", () => {
    const chip = (entity: Repo, query = "") =>
      drawn(entity, "contributors", query).texts.find((text) =>
        text.startsWith("+"),
      );
    expect(chip(repo, "count=10")).toBe("+204");
    expect(faces(drawn(repo, "contributors", "count=10").images)).toHaveLength(
      10,
    );
    // Unknown total: only the listed people can be counted.
    expect(chip({ ...repo, contributorCount: null })).toBe("+3");
    expect(chip({ ...repo, contributorCount: 12_345 })).toBe("+12.3k");
    // Everyone has a face: no chip.
    const few = {
      ...repo,
      contributors: repo.contributors.slice(0, 4),
      contributorCount: 4,
    };
    expect(chip(few)).toBeUndefined();
    expect(faces(drawn(few, "contributors").images)).toHaveLength(4);
  });

  test("nobody to show is no grid", () => {
    const nobody = { ...repo, contributors: [], contributorCount: 0 };
    for (const size of SIZE_IDS) {
      const { images, texts } = drawn(nobody, "contributors", `size=${size}`);
      expect(images).toHaveLength(1);
      expect(texts.some((text) => text.startsWith("+"))).toBe(false);
    }
  });

  test("on fixed canvases the grid fills its box with whole rows", () => {
    for (const size of ["x", "linkedin", "og", "social", "square"]) {
      const { images, texts } = drawn(repo, "contributors", `size=${size}`);
      const grid = faces(images);
      const rows = new Map<number, Leaf[]>();
      for (const face of grid) {
        const y = face.box?.y ?? -1;
        rows.set(y, [...(rows.get(y) ?? []), face]);
      }
      const counts = [...rows.values()].map((row) => row.length);
      // Every row is full; the last one gives its last place to the chip.
      expect({ size, ragged: new Set(counts.slice(0, -1)).size > 1 }).toEqual({
        size,
        ragged: false,
      });
      expect(counts.at(-1)).toBe(
        (counts[0] ?? 0) - (counts.length > 1 ? 1 : 0),
      );
      expect(texts.some((text) => /^\+\d+$/.test(text))).toBe(true);
      expect(grid.length).toBeGreaterThanOrEqual(8);
    }
  });
});

describe("repository social preview", () => {
  const repo = demoEntity("repo");
  const strip = (leaves: Leaf[], height: number) =>
    leaves.filter(
      (leaf) =>
        !leaf.text &&
        leaf.tag === "div" &&
        (leaf.box?.y ?? 0) + (leaf.box?.h ?? 0) === height &&
        (leaf.box?.h ?? 0) < height / 10,
    );

  test("1280 x 640, laid out like the reference", () => {
    const { built, leaves, images, exact } = drawn(repo, "social");
    expect([built.width, built.height]).toEqual([1280, 640]);
    // Avatar 96 px at (64, 64).
    expect(images[0]?.box).toEqual({ x: 64, y: 64, w: 96, h: 96 });
    // The name at 72 px from the left margin; owner muted, name strong.
    const title = leaves.find((leaf) => leaf.text === "acme-labs/rocket");
    expect(title?.style.fontSize).toBe(72);
    expect(title?.box?.x).toBe(64);
    // Facts right-aligned at the right margin.
    const [facts] = exact("TypeScript · MIT · v4.2.0");
    expect((facts?.box?.x ?? 0) + (facts?.box?.w ?? 0)).toBe(1216);
    expect(facts?.style.fontSize).toBe(24);
    // Description in the muted colour, 30 px.
    const [description] = exact(repo.description ?? "");
    expect(description?.style.fontSize).toBe(30);
    expect(description?.style.color).toBe("#9198a1");
    // Four tiles from the left margin, labels at 20 px or more.
    for (const label of ["Stars", "Forks", "Contributors", "Open issues"]) {
      expect(exact(label)[0]?.style.fontSize).toBeGreaterThanOrEqual(20);
    }
    expect(exact("Stars")[0]?.box?.x).toBe(64);
  });

  test("the language mix is a strip along the bottom edge", () => {
    const { leaves, built } = drawn(repo, "social");
    const segments = strip(leaves, built.height);
    expect(segments.map((leaf) => leaf.style.backgroundColor)).toEqual(
      repo.languages.map((language) => language.color),
    );
    expect(segments.every((leaf) => leaf.box?.h === 20)).toBe(true);
    expect(segments[0]?.box?.x).toBe(0);
    expect(segments.reduce((sum, leaf) => sum + (leaf.box?.w ?? 0), 0)).toBe(
      1280,
    );
    // Widths follow the shares.
    expect(segments[0]?.box?.w).toBeGreaterThan(1280 * 0.45);
    // Without languages there is no strip, and nothing else changes place.
    const plain = drawn({ ...repo, languages: [] }, "social");
    expect(strip(plain.leaves, 640)).toHaveLength(0);
    expect(plain.exact("Stars")[0]?.box).toEqual(
      drawn(repo, "social").exact("Stars")[0]?.box,
    );
  });

  test("the name shrinks to fit, to 44 px and no further", () => {
    const titled = (owner: string, name: string) => {
      const entity = repoWith((r) => {
        r.owner = { ...r.owner, login: owner };
        r.name = name;
        r.fullName = `${owner}/${name}`;
      });
      const { leaves } = drawn(entity, "social");
      const whole = leaves.find((leaf) => leaf.text === `${owner}/${name}`);
      const alone = leaves.find((leaf) => leaf.text === name);
      return {
        stacked: whole === undefined,
        size: (whole ?? alone)?.style.fontSize as number,
        owner: leaves.find((leaf) => leaf.text === `${owner}/`),
        name: whole ?? alone,
      };
    };
    expect(titled("vercel", "next.js")).toMatchObject({
      stacked: false,
      size: 72,
    });
    const medium = titled("sindresorhus", "awesome-lint-staged");
    expect(medium.stacked).toBe(false);
    expect(medium.size).toBeLessThan(72);
    expect(medium.size).toBeGreaterThanOrEqual(44);
    // Too long for one line even at 44 px: the owner gets a quiet line of
    // its own above, and the name the whole width.
    const long = titled("a".repeat(39), "b".repeat(40));
    expect(long.stacked).toBe(true);
    expect(long.size).toBeGreaterThanOrEqual(44);
    expect(long.owner?.style.color).toBe("#9198a1");
    expect(long.owner?.box?.y).toBeLessThan(long.name?.box?.y ?? 0);
    expect(long.owner?.style.fontSize).toBeLessThan(long.size);
    // And a name that fills the width on its own stops shrinking at 44.
    expect(titled("a".repeat(39), "b".repeat(100)).size).toBe(44);
    expect(titled("o", "b".repeat(100)).size).toBe(44);
  });

  test("it is a poster on open canvases and steps aside elsewhere", () => {
    for (const size of ["og", "square"]) {
      const { built, leaves } = drawn(repo, "social", `size=${size}`);
      expect({ size, strip: strip(leaves, built.height).length }).toEqual({
        size,
        strip: repo.languages.length,
      });
    }
    // Profile headers have a photo in the corner the strip would run under,
    // and a card follows its content: the general layout draws those.
    for (const size of ["x", "linkedin", "readme"]) {
      const { built, leaves } = drawn(repo, "social", `size=${size}`);
      expect({ size, strip: strip(leaves, built.height).length }).toEqual({
        size,
        strip: 0,
      });
    }
    // Other presets at the social size keep the general layout too.
    const overview = drawn(repo, "overview", "size=social");
    expect(strip(overview.leaves, 640)).toHaveLength(0);
    // Sections the poster does not draw send it to the general layout.
    const extra = drawn(repo, "social", "show=header,stats,contributors");
    expect(extra.images.length).toBeGreaterThan(1);
  });

  test("on a rounded canvas the strip stays inside the margins", () => {
    const { leaves } = drawn(repo, "social", "radius=40&border=1");
    const bar = leaves.filter(
      (leaf) =>
        !leaf.text &&
        repo.languages.some(
          (language) => language.color === leaf.style.backgroundColor,
        ) &&
        (leaf.box?.w ?? 0) > 20,
    );
    expect(bar).toHaveLength(repo.languages.length);
    expect(Math.min(...bar.map((leaf) => leaf.box?.x ?? 0))).toBe(64);
    expect(
      Math.max(...bar.map((leaf) => (leaf.box?.x ?? 0) + (leaf.box?.w ?? 0))),
    ).toBe(1216);
    expect(
      Math.max(...bar.map((leaf) => (leaf.box?.y ?? 0) + (leaf.box?.h ?? 0))),
    ).toBeLessThan(640 - 12);
  });

  test("state labels and hidden parts", () => {
    const archived = drawn(
      repoWith((r) => {
        r.isArchived = true;
        r.isFork = true;
      }),
      "social",
    );
    expect(archived.exact("Archived")).toHaveLength(1);
    expect(archived.exact("Fork")).toHaveLength(1);
    const bare = drawn(repo, "social", "hide=avatar,description,meta&brand=0");
    expect(bare.images).toHaveLength(0);
    expect(bare.texts).not.toContain(repo.description ?? "");
    expect(bare.texts).not.toContain("TypeScript · MIT · v4.2.0");
    expect(bare.texts.join("|")).not.toContain("gitbanners");
  });
});

describe("organization banners", () => {
  const org = demoEntity("org");

  test("Verified is a label in the theme's success colour", () => {
    for (const [theme, color] of [
      ["github-dark", "#3fb950"],
      ["github-light", "#1a7f37"],
      ["dracula", "#50fa7b"],
    ] as const) {
      const [label] = drawn(org, "overview", `theme=${theme}`).exact(
        "Verified",
      );
      expect({ theme, color: label?.style.color }).toEqual({ theme, color });
    }
    expect(
      drawn({ ...org, isVerified: false }, "overview").exact("Verified"),
    ).toHaveLength(0);
    // The avatar is a rounded square.
    const avatar = drawn(org, "overview").images[0];
    expect(avatar?.style.borderRadius).toBeLessThan(
      (avatar?.style.width as number) / 4,
    );
  });

  test("people: one full row on a card, +N for the members without a face", () => {
    const { images, texts, built } = drawn(org, "overview");
    const people = images.slice(1);
    expect(people).toHaveLength(13);
    expect(texts).toContain("+23");
    expect(people.map((face) => face.src)).toEqual(
      org.people.slice(0, 13).map((person) => person.avatarUrl),
    );
    expect(people[0]?.box?.x).toBe(24);
    const [chip] = drawn(org, "overview").exact("+23");
    expect((chip?.box?.x ?? 0) + (chip?.box?.w ?? 0)).toBe(built.width - 24);
    // Asking for everyone shows everyone listed.
    const everyone = drawn(org, "overview", "count=24");
    expect(everyone.images.slice(1)).toHaveLength(24);
    expect(everyone.texts).toContain("+12");
  });

  test("a hidden roster is never zero members", () => {
    for (const members of [null, 0]) {
      const hidden = orgWith((o) => {
        o.people = [];
        o.stats = { ...o.stats, members };
      });
      for (const size of SIZE_IDS) {
        for (const preset of ["overview", "activity"]) {
          const { texts, images } = drawn(hidden, preset, `size=${size}`);
          expect(texts).not.toContain("Members");
          expect(texts).not.toContain("0");
          expect(texts.join("|")).not.toMatch(/\b0 members/i);
          expect(images).toHaveLength(1);
        }
      }
    }
    expect(
      altText(
        { ...org, stats: { ...org.stats, members: null } },
        { year: null },
      ),
    ).not.toContain("members");
  });

  test("repos: six cards in two rows on a card", () => {
    const { leaves, texts } = drawn(org, "repos");
    const names = org.repos.map((repo) => repo.name);
    for (const name of names) expect(texts).toContain(name);
    const rows = new Set(
      names.map((name) => leaves.find((leaf) => leaf.text === name)?.box?.y),
    );
    expect(rows.size).toBe(2);
    const columns = new Set(
      names.map((name) => leaves.find((leaf) => leaf.text === name)?.box?.x),
    );
    expect(columns.size).toBe(3);
    // Every card says what its repository is for.
    for (const repo of org.repos) {
      expect(texts).toContain(repo.description ?? "");
    }
  });

  test("repos on fixed canvases: as many cards as fit, stars on every one", () => {
    for (const size of ["x", "linkedin", "og", "social", "square"]) {
      const { texts } = drawn(org, "repos", `size=${size}`);
      const shown = org.repos.filter((repo) => texts.includes(repo.name));
      expect(shown.length).toBeGreaterThanOrEqual(2);
      // Cards come in the data's order: the most starred first.
      expect(shown).toEqual(org.repos.slice(0, shown.length));
      for (const repo of shown) {
        expect({
          size,
          repo: repo.name,
          stars: texts.includes(starsOf(repo.stars)),
        }).toEqual({
          size,
          repo: repo.name,
          stars: true,
        });
      }
    }
    expect(
      org.repos.filter((repo) =>
        drawn(org, "repos", "size=og").texts.includes(repo.name),
      ),
    ).toHaveLength(6);
  });

  test("activity: the commit calendar of the top repositories", () => {
    const total = number(org.activity?.total ?? 0);
    const card = drawn(org, "activity");
    expect(card.built.heatmap?.cells).toBe(52 * 7 - 1);
    expect(card.texts).toContain(
      `${total} commits to top repositories in the last year`,
    );
    // On a poster the headline is short, and the line under the graph says
    // what the number covers.
    const poster = drawn(org, "activity", "size=og");
    expect(poster.texts).toEqual(
      expect.arrayContaining([
        total,
        "commits in the last year",
        "Across top public repositories",
      ]),
    );
  });

  test("without activity data there is no chart, and no empty box", () => {
    const silent = { ...org, activity: null };
    for (const size of SIZE_IDS) {
      const without = drawn(silent, "activity", `size=${size}`);
      const withChart = drawn(org, "activity", `size=${size}`);
      expect(without.built.heatmap).toBeNull();
      expect(without.texts.join("|")).not.toMatch(/calculating|commits/i);
      expect(without.texts).toEqual(
        expect.arrayContaining(["Acme Labs", "Repositories", "Stars"]),
      );
      expect(without.leaves.length).toBeLessThan(withChart.leaves.length / 4);
      // Nothing is outlined around nothing: no frame larger than the avatar
      // (the "Verified" label is the only outline, and far smaller).
      const avatar = without.images[0]?.box;
      const frames = without.leaves.filter(
        (leaf) =>
          !leaf.text &&
          leaf.tag === "div" &&
          leaf.style.border !== undefined &&
          (leaf.box?.w ?? 0) < without.built.width &&
          (leaf.box?.w ?? 0) * (leaf.box?.h ?? 0) >
            (avatar?.w ?? 0) * (avatar?.h ?? 0),
      );
      expect({ size, frames: frames.length }).toEqual({ size, frames: 0 });
    }
    expect(drawn(silent, "activity").built.height).toBeLessThan(
      drawn(org, "activity").built.height,
    );
  });
});

/** Stars as a repository card prints them. */
function starsOf(stars: number): string {
  return stars < 1000
    ? String(stars)
    : `${(Math.round(stars / 100) / 10).toString().replace(/\.0$/, "")}k`;
}

describe("year in review", () => {
  const user = demoEntity("user", { year: 2026 });
  const total = number(user.calendar.total);

  test("a poster by default: the year, the total, the facts, the lists", () => {
    const { built, texts, leaves } = drawn(user, "wrapped", "year=2026");
    expect([built.width, built.height]).toEqual([1200, 630]);
    expect(texts).toEqual(
      expect.arrayContaining([
        "Mona Demo",
        "2026",
        "+22% vs 2025",
        `${total} contributions in 2026`,
        "Longest streak",
        "Active days",
        "Busiest month",
        "Busiest weekday",
        "Top repositories",
        "rocket",
        "paper-lantern",
        "acme-labs/tide",
        "Top languages",
        "TypeScript",
        "46%",
      ]),
    );
    expect(
      texts.some((text) => /^Best day, [A-Z][a-z]{2} \d+$/.test(text)),
    ).toBe(true);
    expect(texts.some((text) => /^\d+ days$/.test(text))).toBe(true);
    // The year's graph, ready to animate.
    expect(built.heatmap?.cells).toBe(user.calendar.days.length);
    // The total is the largest type on the canvas, the year the second largest.
    const sizes = leaves
      .filter((leaf) => leaf.text)
      .map((leaf) => [leaf.text, leaf.style.fontSize as number] as const)
      .sort((a, b) => b[1] - a[1]);
    expect(sizes[0]?.[0]).toBe(`${total} contributions in 2026`);
    expect(sizes[1]?.[0]).toBe("2026");
    // The year takes the colour of the graph.
    const year = leaves.find((leaf) => leaf.text === "2026");
    expect(year?.style.color).toBe("#56d364");
    expect(
      leaves.find((leaf) => leaf.text === "+22% vs 2025")?.style.color,
    ).toBe("#3fb950");
  });

  test("without a year it is the last 12 months, and says so", () => {
    const last = demoEntity("user");
    const { texts, built } = drawn(last, "wrapped");
    const sum = number(last.calendar.total);
    expect(texts).toEqual(
      expect.arrayContaining([
        "Year in review",
        "Last 12 months",
        `${sum} contributions in the last 12 months`,
        "Top languages",
      ]),
    );
    // No extras were fetched: no comparison, no top repositories.
    expect(texts.join("|")).not.toMatch(/ vs \d{4}|Top repositories/);
    expect(texts).not.toContain("2026");
    expect(built.heatmap?.cells).toBe(last.calendar.days.length);
  });

  test("the facts come from the calendar's days", () => {
    const days = user.calendar.days;
    const active = days.filter((day) => day.count > 0).length;
    const best = Math.max(...days.map((day) => day.count));
    const { texts } = drawn(user, "wrapped", "year=2026&size=square");
    expect(texts).toContain(number(active));
    expect(texts).toContain(number(best));
    const byMonth = new Map<string, number>();
    for (const day of days) {
      const month = day.date.slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + day.count);
    }
    const [busiest] = [...byMonth].sort((a, b) => b[1] - a[1]);
    const name = new Date(`${busiest?.[0]}-01T00:00:00Z`).toLocaleString(
      "en-US",
      { month: "long", timeZone: "UTC" },
    );
    expect(texts).toContain(name);
  });

  test("a slower year, a first year and a quiet one", () => {
    const slower = {
      ...user,
      wrapped: { year: 2026, previousTotal: 5000, topRepos: [] },
    };
    const down = drawn(slower, "wrapped", "year=2026");
    const change = down.leaves.find((leaf) => / vs 2025$/.test(leaf.text));
    expect(change?.text).toMatch(/^-\d+% vs 2025$/);
    // Fewer contributions are not a failure: no alarm colour.
    expect(change?.style.color).toBe("#9198a1");
    expect(down.texts).not.toContain("Top repositories");

    const first = {
      ...user,
      wrapped: { year: 2026, previousTotal: 0, topRepos: [] },
    };
    const started = drawn(first, "wrapped", "year=2026").texts;
    expect(started.join("|")).not.toContain(" vs ");
    expect(started).toContain("Year in review");

    const idle: User = {
      ...user,
      calendar: {
        ...user.calendar,
        total: 0,
        days: user.calendar.days.map((day) => ({ ...day, count: 0, level: 0 })),
      },
      wrapped: null,
    };
    for (const size of SIZE_IDS) {
      const { texts } = drawn(idle, "wrapped", `year=2026&size=${size}`);
      expect(texts.join("|")).toContain("No public contributions in 2026");
      expect(texts).not.toContain("Longest streak");
      expect(texts).not.toContain("0");
    }
  });

  test("the breakdown counts what the total is made of, in words", () => {
    const one: User = {
      ...user,
      stats: { ...user.stats, commits: 1, pullRequests: 1, reviews: 0 },
    };
    const { texts } = drawn(one, "wrapped", "year=2026&size=readme");
    expect(texts).toContain("1 commit · 1 pull request");
    expect(texts.join("|")).not.toMatch(/1 commits|1 pull requests|0 reviews/);
    const unknown: User = {
      ...user,
      stats: {
        ...user.stats,
        commits: null,
        pullRequests: null,
        reviews: null,
      },
    };
    expect(
      drawn(unknown, "wrapped", "year=2026&size=readme").texts.join("|"),
    ).not.toMatch(/commits ·|pull request/);
  });

  test("every size: a card, posters, and profile headers with the photo clear", () => {
    const expected: Record<string, [number, number | null]> = {
      readme: [846, null],
      x: [1500, 500],
      linkedin: [1584, 396],
      og: [1200, 630],
      social: [1280, 640],
      square: [1080, 1080],
    };
    for (const [size, [width, height]] of Object.entries(expected)) {
      const { built, texts } = drawn(user, "wrapped", `year=2026&size=${size}`);
      expect(built.width).toBe(width);
      if (height !== null) expect(built.height).toBe(height);
      expect(built.heatmap?.cells).toBe(user.calendar.days.length);
      expect(texts.join("|")).toContain(total);
      expect(texts.join("|")).toContain("2026");
      expect(texts).toContain("Longest streak");
    }
    // The card and the square have room for the tables' second column.
    expect(drawn(user, "wrapped", "year=2026&size=square").texts).toEqual(
      expect.arrayContaining(["commits", "Daily average"]),
    );
  });

  test("count sets how many repositories and languages are listed", () => {
    // A card grows with its content: five of each.
    const { texts } = drawn(user, "wrapped", "year=2026&size=readme&count=5");
    for (const name of [
      "rocket",
      "paper-lantern",
      "acme-labs/tide",
      "atlas",
      "quill",
    ]) {
      expect(texts).toContain(name);
    }
    for (const language of ["TypeScript", "Rust", "Go", "Python", "Swift"]) {
      expect(texts).toContain(language);
    }
    const one = drawn(user, "wrapped", "year=2026&size=square&count=1").texts;
    expect(one).toContain("rocket");
    expect(one).not.toContain("paper-lantern");
    // On a fixed canvas a long list is shortened before it is dropped:
    // asking for more never shows less.
    for (const size of ["og", "social", "square"]) {
      const many = drawn(user, "wrapped", `year=2026&size=${size}&count=30`);
      expect(many.texts).toEqual(
        expect.arrayContaining(["Top repositories", "rocket", "Top languages"]),
      );
    }
  });

  test("title replaces what the total counts; other kinds ignore the section", () => {
    const titled = drawn(
      user,
      "wrapped",
      "year=2026&title=Shipped%20in%202026",
    );
    expect(titled.texts).toContain(`${total} Shipped in 2026`);
    const hidden = drawn(user, "wrapped", "year=2026&hide=title");
    expect(hidden.texts).toContain(total);
    // An organization asked for the section draws its usual identity.
    const org = drawn(demoEntity("org"), "overview", "show=wrapped");
    expect(org.texts).toContain("Acme Labs");
    expect(org.texts).not.toContain("Year in review");
  });

  test("a canvas too small for the poster gets the general banner", () => {
    const { texts, built } = drawn(user, "wrapped", "width=320&height=120");
    expect([built.width, built.height]).toEqual([320, 120]);
    expect(texts.join("|")).toContain("Mona Demo");
    expect(texts).not.toContain("Longest streak");
  });
});

describe("images of the new sections", () => {
  test("contributors and members are fetched once, at the size they are drawn", () => {
    const env = { now: ENV.now, host: ENV.host };
    const repo = repoWith((r) => {
      r.owner = {
        ...r.owner,
        avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      };
      r.contributors = r.contributors.map((person, index) => ({
        ...person,
        avatarUrl: `https://avatars.githubusercontent.com/u/${1000 + index}?v=4`,
      }));
    });
    const images = collectImages(repo, options("repo", "contributors"), env);
    expect(images).toHaveLength(28);
    expect(images[0]).toEqual({ url: repo.owner.avatarUrl, px: 56 });
    expect(images.slice(1).every((image) => image.px === 49)).toBe(true);
    // Only the faces that are drawn are fetched.
    expect(
      collectImages(repo, options("repo", "contributors", "count=5"), env),
    ).toHaveLength(6);
    expect(collectImages(repo, options("repo", "overview"), env)).toHaveLength(
      1,
    );
    const social = collectImages(repo, options("repo", "social"), env);
    expect(social).toEqual([{ url: repo.owner.avatarUrl, px: 96 }]);

    const org = orgWith((o) => {
      o.people = o.people.map((person, index) => ({
        ...person,
        avatarUrl: `https://avatars.githubusercontent.com/u/${2000 + index}?v=4`,
      }));
    });
    expect(collectImages(org, options("org", "overview"), env)).toHaveLength(
      13,
    );
  });
});
