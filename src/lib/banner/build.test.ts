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

function hostileOrg(): Org {
  const org = demoEntity("org");
  Object.assign(org, {
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
  return org;
}

function hostileRepo(): Repo {
  const repo = demoEntity("repo");
  Object.assign(repo, {
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
  return repo;
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
  test("every user preset on every size in every theme", () => {
    const user = demoEntity("user");
    let count = 0;
    for (const preset of presetsFor("user")) {
      for (const size of SIZE_IDS) {
        for (const theme of THEMES) {
          check(
            user,
            options("user", preset.id, `size=${size}&theme=${theme.id}`),
          );
          count += 1;
        }
      }
    }
    expect(count).toBe(
      presetsFor("user").length * SIZE_IDS.length * THEMES.length,
    );
  });

  test("organization and repository presets on every size", () => {
    for (const kind of ["org", "repo"] as const) {
      for (const preset of presetsFor(kind)) {
        for (const size of SIZE_IDS) {
          for (const theme of ["github-dark", "github-light-high-contrast"]) {
            check(
              demoEntity(kind),
              options(kind, preset.id, `size=${size}&theme=${theme}`),
            );
          }
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

  test("hostile organizations and repositories", () => {
    for (const entity of [hostileOrg(), hostileRepo()]) {
      for (const preset of presetsFor(entity.kind)) {
        for (const query of [
          ...SIZE_IDS.map((size) => `size=${size}`),
          ...CUSTOM_CANVASES,
        ]) {
          check(entity, options(entity.kind, preset.id, query));
        }
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
      "GitHub banner for Acme Labs (@acme-labs): 128 public repositories, 48,210 stars, 24 public members.",
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
