import { describe, expect, test } from "bun:test";
import { demoEntity } from "@/lib/banner/demo";
import {
  bannerPath,
  parseBannerPath,
  targetLabel,
  targetOf,
} from "@/lib/banner/path";
import {
  defaultPresetId,
  OWNER_PRESET_IDS,
  PRESETS,
} from "@/lib/banner/presets";
import type {
  BannerTarget,
  ImageFormat,
  ParsedBannerPath,
} from "@/lib/banner/types";
import { RESERVED_SEGMENTS } from "@/lib/reserved";

const owner = (login: string): BannerTarget => ({ kind: "owner", login });
const repo = (ownerLogin: string, name: string): BannerTarget => ({
  kind: "repo",
  owner: ownerLogin,
  name,
});

function parsed(
  target: BannerTarget,
  preset: string | null = null,
  format: ImageFormat | null = null,
): ParsedBannerPath {
  return { target, preset, format };
}

/** Splits a relative URL the way a route handler receives it. */
function segmentsOf(path: string): string[] {
  return path
    .split("?")[0]
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
}

describe("parseBannerPath", () => {
  const table: [string[], ParsedBannerPath | null][] = [
    // owners
    [["vercel"], parsed(owner("vercel"))],
    [["Torvalds"], parsed(owner("Torvalds"))],
    [["vercel.svg"], parsed(owner("vercel"), null, "svg")],
    [["vercel.PNG"], parsed(owner("vercel"), null, "png")],
    [["a"], parsed(owner("a"))],
    [["a".repeat(39)], parsed(owner("a".repeat(39)))],
    [["legacy-"], parsed(owner("legacy-"))],
    // reserved first segments need the @ escape
    [["docs"], null],
    [["api"], null],
    [["Docs"], null],
    [["@docs"], parsed(owner("docs"))],
    [["@docs.svg"], parsed(owner("docs"), null, "svg")],
    [["@vercel"], parsed(owner("vercel"))],
    [["docs", "repos"], null],
    [["@docs", "repos"], parsed(owner("docs"), "repos")],
    [["@docs", "site"], parsed(repo("docs", "site"))],
    // owner + profile preset
    [["vercel", "repos"], parsed(owner("vercel"), "repos")],
    [["torvalds", "streak.png"], parsed(owner("torvalds"), "streak", "png")],
    [["torvalds", "wrapped"], parsed(owner("torvalds"), "wrapped")],
    // owner + repository
    [["vercel", "next.js"], parsed(repo("vercel", "next.js"))],
    [["vercel", "next.js.svg"], parsed(repo("vercel", "next.js"), null, "svg")],
    [
      ["socketio", "socket.io.png"],
      parsed(repo("socketio", "socket.io"), null, "png"),
    ],
    [["chartjs", "Chart.js"], parsed(repo("chartjs", "Chart.js"))],
    [["vercel", "next.js.git"], parsed(repo("vercel", "next.js"))],
    [
      ["vercel", "next.js.git.svg"],
      parsed(repo("vercel", "next.js"), null, "svg"),
    ],
    [["github", ".github"], parsed(repo("github", ".github"))],
    [["a", "_"], parsed(repo("a", "_"))],
    // a repository named like a profile preset
    [["exelban", "stats"], parsed(owner("exelban"), "stats")],
    [
      ["exelban", "stats", "overview"],
      parsed(repo("exelban", "stats"), "overview"),
    ],
    // GitHub does not tell `Stats` from `stats`: neither do presets.
    [["exelban", "Stats"], parsed(owner("exelban"), "stats")],
    [["exelban", "STATS.PNG"], parsed(owner("exelban"), "stats", "png")],
    [
      ["exelban", "Stats", "Overview"],
      parsed(repo("exelban", "Stats"), "overview"),
    ],
    // owner + repository + preset
    [
      ["vercel", "next.js", "contributors.png"],
      parsed(repo("vercel", "next.js"), "contributors", "png"),
    ],
    [
      ["vercel", "next.js", "activity"],
      parsed(repo("vercel", "next.js"), "activity"),
    ],
    [
      ["vercel", "next.js.git", "social.svg"],
      parsed(repo("vercel", "next.js"), "social", "svg"),
    ],
    // the suffix belongs to the last segment only
    [
      ["vercel", "logo.svg", "overview"],
      parsed(repo("vercel", "logo.svg"), "overview"),
    ],
    [["vercel.svg", "next.js"], null],
    // an unknown preset is passed through: the kind decides later
    [["vercel", "next.js", "nope"], parsed(repo("vercel", "next.js"), "nope")],
    // junk
    [[], null],
    [[""], null],
    [["vercel", ""], null],
    [["vercel", "next.js", "activity", "extra"], null],
    [["-vercel"], null],
    [["ver cel"], null],
    [["vercel!"], null],
    [["a".repeat(40)], null],
    [["@"], null],
    [[".env"], null],
    [["wp-login.php"], null],
    [["vercel", "."], null],
    [["vercel", ".."], null],
    [["vercel", "next js"], null],
    [["vercel", "a".repeat(101)], null],
    [
      ["vercel", "next.js", "Contributors"],
      parsed(repo("vercel", "next.js"), "contributors"),
    ],
    [["vercel", "next.js", "Con tributors"], null],
    // every trailing ".git" goes: GitHub never lets a name end that way
    [["vercel", "next.js.git.git"], parsed(repo("vercel", "next.js"))],
    [["vercel", "next.js.GIT"], parsed(repo("vercel", "next.js"))],
    [["vercel", "next.js", "v1.2"], null],
    [["vercel", "next.js", "../../etc"], null],
    [["vercel", ".git"], null],
    [["vercel", ".svg"], null],
  ];

  for (const [segments, expected] of table) {
    test(`/${segments.join("/")}`, () => {
      expect(parseBannerPath(segments)).toEqual(expected);
    });
  }

  test("every reserved segment is refused bare and accepted with @", () => {
    for (const segment of RESERVED_SEGMENTS) {
      expect(parseBannerPath([segment])).toBeNull();
      // "_next" can never be a login; the others resolve with the escape.
      const escaped = parseBannerPath([`@${segment}`]);
      if (/^[a-z\d][a-z\d-]*$/i.test(segment)) {
        expect(escaped).toEqual(parsed(owner(segment)));
      } else {
        expect(escaped).toBeNull();
      }
    }
  });

  test("never throws on hostile input", () => {
    // Not even an array: an optional catch-all route param can be undefined.
    for (const input of [undefined, null, 42, "vercel/next.js", {}]) {
      expect(parseBannerPath(input as never)).toBeNull();
    }
    const hostile: unknown[] = [
      [null],
      [undefined, "x"],
      [42],
      ["vercel", {}],
      ["%00"],
      ["vercel", "next.js", ""],
    ];
    for (const segments of hostile) {
      expect(parseBannerPath(segments as string[])).toBeNull();
    }
  });
});

describe("bannerPath", () => {
  test("owners", () => {
    expect(bannerPath(owner("Vercel"))).toBe("/vercel");
    expect(bannerPath(owner("vercel"), { preset: "overview" })).toBe("/vercel");
    expect(bannerPath(owner("vercel"), { preset: "repos" })).toBe(
      "/vercel/repos",
    );
    expect(bannerPath(owner("vercel"), { format: "svg" })).toBe("/vercel.svg");
    expect(
      bannerPath(owner("torvalds"), {
        preset: "streak",
        format: "png",
        query: "theme=dracula",
      }),
    ).toBe("/torvalds/streak.png?theme=dracula");
    expect(bannerPath(owner("torvalds"), { query: "?size=x" })).toBe(
      "/torvalds?size=x",
    );
    expect(bannerPath(owner("torvalds"), { query: "" })).toBe("/torvalds");
  });

  test("reserved logins get the @ escape", () => {
    expect(bannerPath(owner("docs"))).toBe("/@docs");
    expect(bannerPath(owner("Docs"), { format: "svg" })).toBe("/@docs.svg");
    expect(bannerPath(repo("api", "client"), { preset: "activity" })).toBe(
      "/@api/client/activity",
    );
  });

  test("repositories", () => {
    expect(bannerPath(repo("Vercel", "next.js"))).toBe("/vercel/next.js");
    expect(bannerPath(repo("vercel", "next.js"), { preset: "overview" })).toBe(
      "/vercel/next.js",
    );
    expect(
      bannerPath(repo("vercel", "next.js"), {
        preset: "contributors",
        format: "png",
      }),
    ).toBe("/vercel/next.js/contributors.png");
    expect(bannerPath(repo("chartjs", "Chart.js"), { format: "svg" })).toBe(
      "/chartjs/Chart.js.svg",
    );
  });

  test("a repository named like a profile preset keeps its preset segment", () => {
    expect(bannerPath(repo("exelban", "stats"))).toBe(
      "/exelban/stats/overview",
    );
    expect(bannerPath(repo("exelban", "stats"), { format: "svg" })).toBe(
      "/exelban/stats/overview.svg",
    );
    expect(bannerPath(repo("exelban", "stats"), { preset: "activity" })).toBe(
      "/exelban/stats/activity",
    );
    for (const id of OWNER_PRESET_IDS) {
      expect(bannerPath(repo("someone", id))).toBe(`/someone/${id}/overview`);
    }
    // In any spelling: `/exelban/Stats` alone would be the profile preset.
    expect(bannerPath(repo("exelban", "Stats"))).toBe(
      "/exelban/Stats/overview",
    );
    expect(parseBannerPath(["exelban", "Stats", "overview"])?.target).toEqual(
      repo("exelban", "Stats"),
    );
  });

  test("a repository whose name ends in .md keeps its preset segment", () => {
    // `/jasonnor/README.md` alone is the Markdown of the repository "README".
    expect(bannerPath(repo("Jasonnor", "README.md"))).toBe(
      "/jasonnor/README.md/overview",
    );
    expect(bannerPath(repo("someone", "notes.MD"), { format: "png" })).toBe(
      "/someone/notes.MD/overview.png",
    );
    expect(
      bannerPath(repo("jasonnor", "README.md"), { preset: "activity" }),
    ).toBe("/jasonnor/README.md/activity");
    // A name that only contains ".md" needs nothing.
    expect(bannerPath(repo("someone", "x.md.js"))).toBe("/someone/x.md.js");
    expect(parseBannerPath(["jasonnor", "README.md", "overview"])).toEqual(
      parsed(repo("jasonnor", "README.md"), "overview"),
    );
  });

  test("presets are written in lower case, whatever was asked", () => {
    expect(bannerPath(owner("torvalds"), { preset: "Activity" })).toBe(
      "/torvalds/activity",
    );
    expect(bannerPath(owner("torvalds"), { preset: "OVERVIEW" })).toBe(
      "/torvalds",
    );
    expect(
      bannerPath(repo("vercel", "next.js"), { preset: "Contributors" }),
    ).toBe("/vercel/next.js/contributors");
  });

  test("a preset that could not be parsed back is not written", () => {
    expect(bannerPath(owner("vercel"), { preset: "contributors" })).toBe(
      "/vercel",
    );
    expect(bannerPath(owner("vercel"), { preset: "../x" })).toBe("/vercel");
    expect(bannerPath(repo("vercel", "next.js"), { preset: "No Good" })).toBe(
      "/vercel/next.js",
    );
  });

  test("users and organizations share the default preset, so owner URLs need no kind", () => {
    expect(defaultPresetId("user")).toBe(defaultPresetId("org"));
    expect(defaultPresetId("user")).toBe("overview");
    expect(defaultPresetId("repo")).toBe("overview");
  });

  test("parsing a built path gives the same banner back", () => {
    const targets: BannerTarget[] = [
      owner("torvalds"),
      owner("docs"),
      owner("a-b-c"),
      repo("vercel", "next.js"),
      repo("exelban", "stats"),
      repo("exelban", "Stats"),
      repo("someone", "WRAPPED"),
      repo("someone", "logo.svg"),
      repo("someone", "shot.PNG"),
      repo("jasonnor", "README.md"),
      repo("someone", "NOTES.MD"),
      repo("github", ".github"),
      repo("themes", "repos"),
    ];
    const formats: (ImageFormat | null)[] = [null, "svg", "png"];
    for (const target of targets) {
      const presets = PRESETS.filter((preset) =>
        target.kind === "repo"
          ? preset.kind === "repo"
          : preset.kind !== "repo",
      ).map((preset) => preset.id);
      for (const preset of [null, ...presets]) {
        for (const format of formats) {
          const path = bannerPath(target, {
            preset,
            format,
            query: "theme=nord",
          });
          const back = parseBannerPath(segmentsOf(path));
          const fallback = defaultPresetId(
            target.kind === "repo" ? "repo" : "user",
          );
          expect(back?.target).toEqual(target);
          expect(back?.format).toBe(format);
          expect(back?.preset ?? fallback).toBe(preset ?? fallback);
          expect(path.endsWith("?theme=nord")).toBe(true);
        }
      }
    }
  });
});

describe("targetOf and targetLabel", () => {
  test("address entities the way URLs do", () => {
    expect(targetOf(demoEntity("user"))).toEqual(owner("mona-demo"));
    expect(targetOf(demoEntity("org"))).toEqual(owner("acme-labs"));
    expect(targetOf(demoEntity("repo"))).toEqual(repo("acme-labs", "rocket"));
    expect(targetLabel(owner("vercel"))).toBe("vercel");
    expect(targetLabel(repo("vercel", "next.js"))).toBe("vercel/next.js");
    expect(bannerPath(targetOf(demoEntity("repo")), { format: "svg" })).toBe(
      "/acme-labs/rocket.svg",
    );
  });
});
