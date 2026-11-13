import { describe, expect, test } from "bun:test";
import { getTheme, STAT_IDS } from "@/lib/banner";
import {
  adaptOverrides,
  bannerQuery,
  colorOf,
  defaultBannerName,
  EMPTY_STATE,
  hasOverrides,
  moveItem,
  parseStudioSearch,
  publicQuery,
  resetOptions,
  resolveStudio,
  STATS_BY_KIND,
  type StudioState,
  sameSearch,
  studioSearch,
  withColor,
  withOptions,
  withPreset,
  withTarget,
  yearChoices,
} from "./state";

const repo = { kind: "repo", owner: "vercel", name: "next.js" } as const;
const user = { kind: "owner", login: "torvalds" } as const;

function state(search: string): StudioState {
  return parseStudioSearch(search);
}

describe("parseStudioSearch", () => {
  test("reads target, preset, saved banner and options", () => {
    const parsed = state(
      "?banner=b0123456789a&target=vercel/next.js&preset=contributors&theme=dracula&size=og",
    );
    expect(parsed.target).toEqual(repo);
    expect(parsed.preset).toBe("contributors");
    expect(parsed.bannerId).toBe("b0123456789a");
    expect(parsed.overrides).toEqual({ size: "og", theme: "dracula" });
  });

  test("an empty address is the sample studio", () => {
    expect(state("")).toEqual(EMPTY_STATE);
  });

  test("junk is dropped, never thrown", () => {
    const parsed = state(
      "target=%3Cscript%3E&preset=../x&banner=nope&theme=nope&radius=999&accent=zzz",
    );
    expect(parsed).toEqual(EMPTY_STATE);
  });

  test("accepts the encoded slash and github.com URLs", () => {
    expect(state("target=vercel%2Fnext.js").target).toEqual(repo);
    expect(
      state(`target=${encodeURIComponent("https://github.com/vercel/next.js")}`)
        .target,
    ).toEqual(repo);
  });
});

describe("studioSearch", () => {
  test("is minimal: default preset and preset defaults are not written", () => {
    const parsed = state("target=vercel/next.js&preset=overview&size=readme");
    expect(studioSearch("repo", parsed)).toBe("target=vercel/next.js");
  });

  test("keeps a readable slash and the engine's key order", () => {
    const parsed = state(
      "size=og&theme=dracula&preset=contributors&target=vercel%2Fnext.js",
    );
    expect(studioSearch("repo", parsed)).toBe(
      "target=vercel/next.js&preset=contributors&size=og&theme=dracula",
    );
  });

  test("round trips: parse(print(state)) prints the same", () => {
    const cases = [
      "target=torvalds&preset=streak&theme=nord&accent=ff0000&radius=12",
      "banner=b0123456789a&target=vercel&preset=repos&count=4&hide=avatar",
      "target=vercel/next.js&preset=release&stats=release,stars&title=Hello%20world",
      "preset=wrapped&year=2024&font=mono&border=0",
      "target=torvalds&width=1000&height=400&heat=00ff00&brand=0&animate=1",
    ];
    for (const search of cases) {
      const kind = search.includes("vercel/")
        ? "repo"
        : search.includes("target=vercel")
          ? "org"
          : "user";
      const printed = studioSearch(kind, state(search));
      expect(studioSearch(kind, state(printed))).toBe(printed);
      expect(sameSearch(printed, search)).toBe(true);
    }
  });

  test("the sample profile writes no target", () => {
    expect(studioSearch("user", state("theme=dracula"))).toBe("theme=dracula");
  });
});

describe("kind switches", () => {
  test("options that apply survive, the rest falls away", () => {
    const from = state(
      "target=torvalds&preset=streak&theme=dracula&year=2024&stats=stars,followers,streak&radius=4",
    );
    const to = withTarget(from, repo);
    // A repository has no streak preset: its default preset, same theme.
    expect(studioSearch("repo", to)).toBe(
      "target=vercel/next.js&theme=dracula&radius=4&stats=stars",
    );
    expect(resolveStudio("repo", to).preset).toBe("overview");
    // And back: the user's preset and year are still there.
    expect(studioSearch("user", withTarget(to, user))).toBe(
      "target=torvalds&preset=streak&theme=dracula&radius=4&year=2024&stats=stars,followers,streak",
    );
  });

  test("adaptOverrides keeps only stats and sections of the kind", () => {
    const adapted = adaptOverrides(
      {
        stats: ["members", "stars"],
        sections: ["people", "heatmap"],
        year: 2020,
      },
      "org",
    );
    expect(adapted).toEqual({
      stats: ["members", "stars"],
      sections: ["people"],
    });
    expect(adaptOverrides({ stats: ["members"] }, "repo")).toEqual({});
  });

  test("every stat id belongs to some kind", () => {
    const offered = new Set(Object.values(STATS_BY_KIND).flat());
    for (const id of STAT_IDS) expect(offered.has(id)).toBe(true);
  });
});

describe("editing", () => {
  const base = state("target=torvalds");

  test("setting a value back to the default removes it", () => {
    const themed = withOptions("user", base, { theme: "dracula" });
    expect(bannerQuery("user", themed)).toBe("theme=dracula");
    const back = withOptions("user", themed, { theme: "github-dark" });
    expect(bannerQuery("user", back)).toBe("");
    expect(hasOverrides("user", back)).toBe(false);
  });

  test("colours: set, heat ramp from one colour, reset", () => {
    let next = withColor("user", base, "accent", "#ff0000");
    next = withColor("user", next, "heat", "#00ff00");
    expect(bannerQuery("user", next)).toBe("accent=ff0000&heat=00ff00");
    const options = resolveStudio("user", next);
    const theme = getTheme(options.theme).colors;
    expect(colorOf(theme, options, "accent")).toEqual({
      value: "#ff0000",
      isOverridden: true,
    });
    expect(colorOf(theme, options, "bg")).toEqual({
      value: theme.bg,
      isOverridden: false,
    });
    expect(colorOf(theme, options, "heat")).toEqual({
      value: "#00ff00",
      isOverridden: true,
    });
    next = withColor("user", next, "accent", null);
    expect(bannerQuery("user", next)).toBe("heat=00ff00");
  });

  test("a preset change keeps the look and drops preset content", () => {
    const tuned = state(
      "target=torvalds&preset=stats&theme=nord&size=x&stats=stars&count=2&hide=bio",
    );
    const next = withPreset("user", tuned, "repos");
    expect(studioSearch("user", next)).toBe(
      "target=torvalds&preset=repos&size=x&theme=nord",
    );
  });

  test("an unknown preset falls back to the kind's default", () => {
    expect(withPreset("org", base, "streak").preset).toBe("overview");
  });

  test("the card preset's width survives other options", () => {
    const card = withPreset("user", base, "card");
    expect(resolveStudio("user", card).width).toBe(495);
    const themed = withOptions("user", card, { theme: "nord" });
    expect(studioSearch("user", themed)).toBe(
      "target=torvalds&preset=card&theme=nord",
    );
  });

  test("reset clears options and keeps the rest", () => {
    const tuned = state(
      "banner=b0123456789a&target=vercel&preset=repos&theme=nord",
    );
    const reset = resetOptions(tuned);
    expect(studioSearch("org", reset)).toBe(
      "banner=b0123456789a&target=vercel&preset=repos",
    );
  });

  test("public links never carry Pro options", () => {
    const pro = state("target=torvalds&theme=nord&brand=0&animate=1");
    expect(bannerQuery("user", pro)).toBe("theme=nord&brand=0&animate=1");
    expect(publicQuery("user", pro)).toBe("theme=nord");
  });
});

describe("small helpers", () => {
  test("default banner name", () => {
    expect(defaultBannerName(repo, "repo", "contributors")).toBe(
      "vercel/next.js: Contributors",
    );
    expect(defaultBannerName(user, "user", "nope")).toBe("torvalds: Overview");
  });

  test("years from the join year to now, newest first", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    expect(yearChoices("2023-04-01T00:00:00Z", now, 2008)).toEqual([
      2026, 2025, 2024, 2023,
    ]);
    expect(yearChoices("2001-01-01T00:00:00Z", now, 2024)).toEqual([
      2026, 2025, 2024,
    ]);
    expect(yearChoices(null, now, 2025)).toEqual([2026, 2025]);
  });

  test("moveItem swaps neighbours and ignores the ends", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });

  test("sameSearch ignores order and encoding", () => {
    expect(sameSearch("?b=2&a=1", "a=1&b=2")).toBe(true);
    expect(sameSearch("target=vercel/next.js", "target=vercel%2Fnext.js")).toBe(
      true,
    );
    expect(sameSearch("a=1", "a=2")).toBe(false);
  });
});
