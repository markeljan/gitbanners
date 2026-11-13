import { describe, expect, test } from "bun:test";
import {
  canonicalQuery,
  DEFAULT_OPTIONS,
  diffOptions,
  HIDE_IDS,
  normalizeHex,
  normalizeOptions,
  OPTION_LIMITS,
  parseOptions,
  QUERY_KEYS,
  resolveOptions,
  SECTION_IDS,
  SIZE_IDS,
  STAT_IDS,
  serializeOptions,
  stripProOptions,
} from "@/lib/banner/options";
import { PRESET_DEFAULTS, PRESETS, presetsFor } from "@/lib/banner/presets";
import { SIZES } from "@/lib/banner/sizes";
import { THEMES } from "@/lib/banner/themes";
import type {
  BannerOptions,
  EntityKind,
  ThemeColors,
} from "@/lib/banner/types";

const KINDS: EntityKind[] = ["user", "org", "repo"];

/** Deterministic PRNG so a failing case can be reproduced from its index. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parse(query: string): Partial<BannerOptions> {
  return parseOptions(new URLSearchParams(query));
}

/** A random partial that is already in canonical form. */
function randomPartial(next: () => number): Partial<BannerOptions> {
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(next() * items.length)] as T;
  const maybe = () => next() < 0.4;
  const int = (min: number, max: number) =>
    min + Math.floor(next() * (max - min + 1));
  const hex = () =>
    `#${Math.floor(next() * 0xffffff)
      .toString(16)
      .padStart(6, "0")}`;
  const some = <T>(items: readonly T[], allowEmpty: boolean): T[] => {
    const picked = items.filter(() => next() < 0.3);
    return picked.length || allowEmpty ? picked : [pick(items)];
  };
  const shuffle = <T>(items: T[]): T[] =>
    items
      .map((item) => [next(), item] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([, item]) => item);

  const out: Partial<BannerOptions> = {};
  if (maybe()) out.size = pick(SIZE_IDS);
  if (maybe()) out.width = int(320, 3000);
  if (maybe()) out.height = int(120, 3000);
  if (maybe()) out.theme = pick(THEMES.slice(1)).id;
  if (maybe()) {
    const colors: BannerOptions["colors"] = {};
    for (const key of [
      "bg",
      "surface",
      "border",
      "text",
      "muted",
      "accent",
    ] as const) {
      if (maybe()) colors[key] = hex();
    }
    if (maybe()) {
      const one = hex();
      colors.heat = maybe()
        ? [one, one, one, one, one]
        : ([hex(), hex(), hex(), hex(), hex()] as ThemeColors["heat"]);
    }
    if (Object.keys(colors).length) out.colors = colors;
  }
  if (maybe()) out.font = "mono";
  if (maybe()) out.radius = int(0, 64);
  if (maybe()) out.border = next() < 0.5;
  if (maybe()) {
    out.title = pick([
      "Shipping every day",
      "100% open source & proud",
      "a=b&c=d?e#f",
      "Año nuevo, código nuevo",
      "日本語のタイトル",
      "plus + sign, comma",
      "🚀 to the moon",
    ]);
  }
  if (maybe()) out.year = int(2008, 2100);
  if (maybe()) out.stats = shuffle(some(STAT_IDS, false));
  if (maybe()) out.sections = shuffle(some(SECTION_IDS, false));
  if (maybe()) out.hide = shuffle(some(HIDE_IDS, true));
  if (maybe()) out.count = int(1, 30);
  if (maybe()) out.brand = false;
  if (maybe()) out.animate = true;
  return normalizeOptions(out);
}

describe("DEFAULT_OPTIONS", () => {
  test("is the neutral starting point", () => {
    expect(DEFAULT_OPTIONS).toEqual({
      preset: "overview",
      sections: null,
      size: "readme",
      width: null,
      height: null,
      theme: "github-dark",
      colors: {},
      font: "mona",
      radius: null,
      border: null,
      title: null,
      year: null,
      stats: null,
      count: null,
      hide: [],
      brand: true,
      animate: false,
    });
  });

  test("id lists cover the contract and the registries", () => {
    expect(SIZE_IDS).toEqual(Object.keys(SIZES) as typeof SIZE_IDS);
    expect(SECTION_IDS).toContain("heatmap");
    expect(new Set(SECTION_IDS).size).toBe(SECTION_IDS.length);
    expect(new Set(STAT_IDS).size).toBe(STAT_IDS.length);
    for (const preset of PRESETS) {
      for (const id of preset.sections) expect(SECTION_IDS).toContain(id);
    }
    for (const defaults of Object.values(PRESET_DEFAULTS)) {
      for (const id of defaults?.stats ?? []) expect(STAT_IDS).toContain(id);
      for (const id of defaults?.hide ?? []) expect(HIDE_IDS).toContain(id);
    }
  });
});

describe("parseOptions", () => {
  test("an empty query changes nothing", () => {
    expect(parse("")).toEqual({});
    expect(parseOptions({})).toEqual({});
  });

  test("unknown keys are ignored", () => {
    expect(parse("utm_source=x&preset=stats&foo=bar&__proto__=1")).toEqual({});
  });

  test("size", () => {
    for (const size of SIZE_IDS)
      expect(parse(`size=${size}`)).toEqual({ size });
    expect(parse("size=X")).toEqual({ size: "x" });
    expect(parse("size=banner")).toEqual({});
    expect(parse("size=")).toEqual({});
  });

  test("width and height keep to their ranges", () => {
    const { width, height } = OPTION_LIMITS;
    expect(parse(`width=${width.min}`)).toEqual({ width: width.min });
    expect(parse(`width=${width.max}`)).toEqual({ width: width.max });
    expect(parse(`width=${width.min - 1}`)).toEqual({});
    expect(parse(`width=${width.max + 1}`)).toEqual({});
    expect(parse(`height=${height.min}`)).toEqual({ height: height.min });
    expect(parse(`height=${height.max}`)).toEqual({ height: height.max });
    expect(parse(`height=${height.min - 1}`)).toEqual({});
    expect(parse(`height=${height.max + 1}`)).toEqual({});
    for (const junk of [
      "abc",
      "846.5",
      "-846",
      "1e3",
      "0x200",
      " ",
      "846px",
      "9999999999",
    ]) {
      expect(parse(`width=${encodeURIComponent(junk)}`)).toEqual({});
      expect(parse(`height=${encodeURIComponent(junk)}`)).toEqual({});
    }
    expect(parse("width=%20900%20")).toEqual({ width: 900 });
  });

  test("the pixel budget drops the height, never the width", () => {
    expect(parse("width=3000&height=3000")).toEqual({
      width: 3000,
      height: 3000,
    });
    expect(3000 * 3000).toBeLessThanOrEqual(OPTION_LIMITS.pixels);
    // Not reachable through the query ranges today; the rule still holds
    // for a hand-built partial with a tighter budget in mind.
    expect(normalizeOptions({ width: 3000, height: 3001 })).toEqual({
      width: 3000,
    });
  });

  test("theme", () => {
    expect(parse("theme=dracula")).toEqual({ theme: "dracula" });
    expect(parse("theme=Tokyo-Night")).toEqual({ theme: "tokyo-night" });
    expect(parse("theme=github-dark")).toEqual({});
    expect(parse("theme=solarized")).toEqual({});
    for (const theme of THEMES.slice(1)) {
      expect(parse(`theme=${theme.id}`)).toEqual({ theme: theme.id });
    }
  });

  test("colours accept 3 or 6 hex digits, with or without #", () => {
    expect(parse("bg=fff")).toEqual({ colors: { bg: "#ffffff" } });
    expect(parse("bg=%23FFAA00")).toEqual({ colors: { bg: "#ffaa00" } });
    expect(
      parse("surface=123&border_color=abcdef&text=000&muted=777&accent=0969DA"),
    ).toEqual({
      colors: {
        surface: "#112233",
        border: "#abcdef",
        text: "#000000",
        muted: "#777777",
        accent: "#0969da",
      },
    });
    for (const junk of [
      "ff",
      "ffff",
      "fffff",
      "fffffff",
      "ffffffff",
      "red",
      "rgb(0,0,0)",
      "#",
      "gggggg",
      "12345g",
    ]) {
      expect(parse(`bg=${encodeURIComponent(junk)}`)).toEqual({});
      expect(parse(`accent=${encodeURIComponent(junk)}`)).toEqual({});
    }
    // `border` is the on/off switch, not a colour.
    expect(parse("border=ff0000")).toEqual({});
  });

  test("heat takes one colour or five", () => {
    expect(parse("heat=f60")).toEqual({
      colors: {
        heat: ["#ff6600", "#ff6600", "#ff6600", "#ff6600", "#ff6600"],
      },
    });
    const five = ["#111111", "#222222", "#333333", "#444444", "#555555"];
    expect(parse("heat=111,222,333,444,555")).toEqual({
      colors: { heat: five as unknown as ThemeColors["heat"] },
    });
    expect(parse("heat=111&heat=222&heat=333&heat=444&heat=555")).toEqual({
      colors: { heat: five as unknown as ThemeColors["heat"] },
    });
    for (const junk of [
      "111,222",
      "1,2,3,4,5",
      "111,222,333,444,555,666",
      "111,222,333,444,zzz",
      "",
    ]) {
      expect(parse(`heat=${junk}`)).toEqual({});
    }
  });

  test("font", () => {
    expect(parse("font=mono")).toEqual({ font: "mono" });
    expect(parse("font=MONO")).toEqual({ font: "mono" });
    expect(parse("font=mona")).toEqual({});
    expect(parse("font=comic-sans")).toEqual({});
  });

  test("radius, year and count keep to their ranges", () => {
    expect(parse("radius=0")).toEqual({ radius: 0 });
    expect(parse("radius=64")).toEqual({ radius: 64 });
    expect(parse("radius=65")).toEqual({});
    expect(parse("radius=-1")).toEqual({});
    expect(parse("year=2008")).toEqual({ year: 2008 });
    expect(parse("year=2100")).toEqual({ year: 2100 });
    expect(parse("year=2007")).toEqual({});
    expect(parse("year=2101")).toEqual({});
    expect(parse("year=twenty")).toEqual({});
    expect(parse("count=1")).toEqual({ count: 1 });
    expect(parse("count=30")).toEqual({ count: 30 });
    expect(parse("count=0")).toEqual({});
    expect(parse("count=31")).toEqual({});
  });

  test("booleans", () => {
    expect(parse("border=1")).toEqual({ border: true });
    expect(parse("border=0")).toEqual({ border: false });
    expect(parse("border=true")).toEqual({ border: true });
    expect(parse("border=FALSE")).toEqual({ border: false });
    expect(parse("border=yes")).toEqual({});
    expect(parse("brand=0")).toEqual({ brand: false });
    expect(parse("brand=1")).toEqual({});
    expect(parse("brand=nope")).toEqual({});
    expect(parse("animate=1")).toEqual({ animate: true });
    expect(parse("animate=0")).toEqual({});
  });

  test("title is cleaned and capped", () => {
    expect(parse("title=Hello%20world")).toEqual({ title: "Hello world" });
    expect(parse("title=Hello+world")).toEqual({ title: "Hello world" });
    expect(parse("title=%20%20spaced%20%20%20out%20")).toEqual({
      title: "spaced out",
    });
    const bell = String.fromCharCode(7);
    const esc = String.fromCharCode(27);
    const c1 = String.fromCharCode(0x85);
    const dirty = `a${bell}b${esc}[31mc\nd\te${c1}f`;
    expect(parse(`title=${encodeURIComponent(dirty)}`)).toEqual({
      title: "a b [31mc d e f",
    });
    expect(parse("title=")).toEqual({});
    expect(parse("title=%20%09%0A")).toEqual({});
    const long = "x".repeat(200);
    expect(parse(`title=${long}`).title).toHaveLength(OPTION_LIMITS.title);
    // Counted in characters, so an emoji is never cut in half.
    const rockets = "🚀".repeat(100);
    const title = parse(`title=${encodeURIComponent(rockets)}`).title ?? "";
    expect([...title]).toHaveLength(OPTION_LIMITS.title);
    expect(title.endsWith("🚀")).toBe(true);
  });

  test("lists accept commas and repeated parameters", () => {
    expect(parse("stats=stars,forks")).toEqual({ stats: ["stars", "forks"] });
    expect(parse("stats=stars&stats=forks")).toEqual({
      stats: ["stars", "forks"],
    });
    expect(parse("stats=stars,%20forks%20,stars,,nope")).toEqual({
      stats: ["stars", "forks"],
    });
    expect(parse("stats=PULLREQUESTS,openissues")).toEqual({
      stats: ["pullRequests", "openIssues"],
    });
    expect(parse("stats=")).toEqual({});
    expect(parse("stats=nope")).toEqual({});
    expect(parse("show=heatmap,header")).toEqual({
      sections: ["heatmap", "header"],
    });
    expect(parse("show=")).toEqual({});
    expect(parse("show=footer")).toEqual({});
    expect(parse("hide=legend,labels")).toEqual({ hide: ["legend", "labels"] });
    expect(
      parseOptions({ stats: ["stars,forks", "watchers"], hide: "bio" }),
    ).toEqual({ stats: ["stars", "forks", "watchers"], hide: ["bio"] });
  });

  test("an empty hide list is kept, a mistyped one is not", () => {
    // `hide=` un-hides what a preset hides; a typo must not do that by accident.
    expect(parse("hide=")).toEqual({ hide: [] });
    expect(parse("hide=avatr")).toEqual({});
  });

  test("the last occurrence of a scalar wins", () => {
    expect(parse("size=x&size=og")).toEqual({ size: "og" });
    expect(parseOptions({ size: ["x", "og"] })).toEqual({ size: "og" });
  });

  test("the work is bounded by the options, not by the query's length", () => {
    // A megabyte of list entries, colours and title: read as far as a real
    // value could reach, then ignored. Nothing here may take long enough to
    // matter to a request (the whole test is a few milliseconds).
    const started = performance.now();
    const huge = {
      hide: `${"nope,".repeat(200_000)}bio`,
      stats: `stars,${"stars,".repeat(200_000)}forks`,
      heat: "ff0000,".repeat(150_000),
      title: `${" ".repeat(500_000)}Late title`,
      show: Array.from({ length: 5000 }, () => "header"),
    };
    expect(parseOptions(huge)).toEqual({
      stats: ["stars"],
      sections: ["header"],
    });
    expect(parse(`title=${"a".repeat(400_000)}`).title?.length).toBe(
      OPTION_LIMITS.title,
    );
    expect(
      normalizeOptions({
        stats: Array.from({ length: 300_000 }, () => "stars" as const),
      }),
    ).toEqual({ stats: ["stars"] });
    expect(performance.now() - started).toBeLessThan(250);
    // Real lists are untouched by the cap: every id at once still parses.
    expect(parse(`stats=${STAT_IDS.join(",")}`).stats).toEqual(STAT_IDS);
    expect(parse(`show=${SECTION_IDS.join(",")}`).sections).toEqual(
      SECTION_IDS,
    );
    expect(parse(`hide=${HIDE_IDS.join(",")}`).hide).toEqual(HIDE_IDS);
  });

  test("never throws, whatever it is fed", () => {
    const next = prng(7);
    const alphabet = "abc019,%#&=+ -._~/\\'\"<>{}[]()é漢🚀";
    for (let i = 0; i < 400; i++) {
      const params = new URLSearchParams();
      const record: Record<string, string | string[] | undefined> = {};
      for (const key of QUERY_KEYS) {
        if (next() < 0.5) continue;
        const value = Array.from(
          { length: Math.floor(next() * 12) },
          () => alphabet[Math.floor(next() * alphabet.length)],
        ).join("");
        params.append(key, value);
        record[key] = next() < 0.3 ? [value, value] : value;
      }
      for (const input of [params, record]) {
        const parsed = parseOptions(input);
        expect(normalizeOptions(parsed)).toEqual(parsed);
        expect(parse(serializeOptions(parsed))).toEqual(parsed);
      }
    }
    const hostile = [
      null,
      undefined,
      42,
      "x",
      [],
      { size: 3, hide: "bio", colors: 7 },
    ];
    for (const input of hostile) {
      expect(() => normalizeOptions(input as never)).not.toThrow();
      expect(() => parseOptions(input as never)).not.toThrow();
    }
  });
});

describe("serializeOptions", () => {
  test("nothing set is an empty string", () => {
    expect(serializeOptions({})).toBe("");
    expect(
      serializeOptions({
        theme: "github-dark",
        font: "mona",
        brand: true,
        animate: false,
      }),
    ).toBe("");
    expect(
      serializeOptions({ width: null, height: null, title: null, stats: null }),
    ).toBe("");
  });

  test("fixed key order, 0/1 booleans, bare lower-case hex", () => {
    const query = serializeOptions({
      animate: true,
      brand: false,
      count: 3,
      hide: ["legend"],
      sections: ["header", "heatmap"],
      stats: ["stars", "forks"],
      year: 2025,
      title: "Hello, world & co",
      border: false,
      radius: 0,
      font: "mono",
      colors: {
        accent: "#0969DA",
        bg: "#FFF",
        heat: ["#f60", "#f60", "#f60", "#f60", "#f60"],
      },
      theme: "dracula",
      height: 400,
      width: 1200,
      size: "og",
    });
    expect(query).toBe(
      "size=og&width=1200&height=400&theme=dracula&bg=ffffff&accent=0969da" +
        "&heat=ff6600&font=mono&radius=0&border=0&title=Hello,%20world%20%26%20co" +
        "&year=2025&stats=stars,forks&show=header,heatmap&hide=legend&count=3" +
        "&brand=0&animate=1",
    );
    const keys = query.split("&").map((pair) => pair.split("=")[0]);
    const order = keys.map((key) => QUERY_KEYS.indexOf(key as never));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("five heat colours stay five", () => {
    expect(
      serializeOptions({
        colors: {
          heat: ["#111111", "#222222", "#333333", "#444444", "#555555"],
        },
      }),
    ).toBe("heat=111111,222222,333333,444444,555555");
  });

  test("values a preset can change are never dropped", () => {
    // `wrapped` defaults to the link-preview size: asking for README must survive.
    expect(serializeOptions({ size: "readme" })).toBe("size=readme");
    expect(serializeOptions({ hide: [] })).toBe("hide=");
    expect(
      resolveOptions("user", "wrapped", parse(canonicalQuery("size=readme")))
        .size,
    ).toBe("readme");
    expect(
      resolveOptions("user", "activity", parse(canonicalQuery("hide="))).hide,
    ).toEqual([]);
  });

  test("junk never reaches a URL", () => {
    expect(
      serializeOptions({
        width: 99_999,
        theme: "nope",
        radius: -3,
        year: 1999,
        count: 0,
        colors: { bg: "red" },
        stats: ["nope" as never],
        title: "   ",
      }),
    ).toBe("");
  });

  test("round trip over a generated corpus", () => {
    const next = prng(20261113);
    for (let i = 0; i < 2000; i++) {
      const partial = randomPartial(next);
      const query = serializeOptions(partial);
      expect(parse(query)).toEqual(partial);
      // Canonical means stable: printing again gives the same string.
      expect(serializeOptions(parse(query))).toBe(query);
      expect(canonicalQuery(query)).toBe(query);
    }
  });
});

describe("canonicalQuery", () => {
  test("accepts strings, URLSearchParams and records", () => {
    const expected = "size=x&theme=dracula&hide=legend,labels";
    expect(
      canonicalQuery("?hide=legend&theme=dracula&size=x&hide=labels"),
    ).toBe(expected);
    expect(
      canonicalQuery("hide=legend,labels&THEME=nope&theme=dracula&size=x"),
    ).toBe(expected);
    expect(
      canonicalQuery(
        new URLSearchParams("theme=dracula&size=x&hide=legend,labels"),
      ),
    ).toBe(expected);
    expect(
      canonicalQuery({
        theme: "dracula",
        size: "x",
        hide: ["legend", "labels"],
      }),
    ).toBe(expected);
  });

  test("drops what changes nothing", () => {
    expect(canonicalQuery("")).toBe("");
    expect(canonicalQuery("?")).toBe("");
    expect(
      canonicalQuery("theme=github-dark&brand=1&animate=0&font=mona&utm=1"),
    ).toBe("");
  });
});

describe("resolveOptions", () => {
  test("every kind has a default preset and resolves it", () => {
    for (const kind of KINDS) {
      expect(presetsFor(kind).length).toBeGreaterThan(0);
      const first = presetsFor(kind)[0];
      for (const id of [null, undefined, "", "nope", "Overview"]) {
        expect(resolveOptions(kind, id).preset).toBe(first.id);
      }
    }
  });

  test("a preset of another kind falls back to the kind's default", () => {
    expect(resolveOptions("user", "contributors").preset).toBe("overview");
    expect(resolveOptions("repo", "streak").preset).toBe("overview");
    expect(resolveOptions("org", "wrapped").preset).toBe("overview");
    expect(resolveOptions("org", "repos").preset).toBe("repos");
    expect(resolveOptions("repo", "social").preset).toBe("social");
  });

  test("applies the preset's defaults", () => {
    for (const preset of PRESETS) {
      const defaults = PRESET_DEFAULTS[`${preset.kind}/${preset.id}`];
      const resolved = resolveOptions(preset.kind, preset.id);
      expect(resolved.preset).toBe(preset.id);
      expect(resolved.size).toBe(defaults?.size ?? "readme");
      expect(resolved.width).toBe(defaults?.width ?? null);
      expect(resolved.count).toBe(defaults?.count ?? null);
      expect(resolved.hide).toEqual([...(defaults?.hide ?? [])]);
      expect(resolved.stats).toEqual(
        defaults?.stats.length ? [...defaults.stats] : null,
      );
      expect(resolved.sections).toBeNull();
      expect(resolved.theme).toBe("github-dark");
      expect(resolved.brand).toBe(true);
      expect(resolved.animate).toBe(false);
    }
  });

  test("the caller's overrides win", () => {
    const resolved = resolveOptions(
      "user",
      "card",
      parse("width=600&stats=stars&hide=&theme=nord&count=2"),
    );
    expect(resolved).toMatchObject({
      preset: "card",
      width: 600,
      stats: ["stars"],
      hide: [],
      theme: "nord",
      count: 2,
    });
  });

  test("a preset's width belongs to its own size", () => {
    expect(resolveOptions("user", "card").width).toBe(495);
    expect(resolveOptions("user", "card", { size: "readme" }).width).toBe(495);
    expect(resolveOptions("user", "card", { size: "x" }).width).toBeNull();
    expect(
      resolveOptions("user", "card", { size: "x", width: 900 }).width,
    ).toBe(900);
  });

  test("invalid overrides are ignored, not applied", () => {
    const resolved = resolveOptions("user", "overview", {
      width: 5,
      theme: "nope",
      colors: { bg: "blue" },
      hide: ["nope" as never],
    });
    expect(resolved).toEqual(resolveOptions("user", "overview"));
  });

  test("returns fresh objects every time", () => {
    const a = resolveOptions("user", "activity");
    const b = resolveOptions("user", "activity");
    expect(a).toEqual(b);
    a.hide.push("legend");
    a.colors.bg = "#000000";
    expect(resolveOptions("user", "activity")).toEqual(b);
    expect(DEFAULT_OPTIONS.hide).toEqual([]);
    expect(DEFAULT_OPTIONS.colors).toEqual({});
  });
});

describe("diffOptions", () => {
  test("the preset's own options need no query", () => {
    for (const preset of PRESETS) {
      const resolved = resolveOptions(preset.kind, preset.id);
      expect(diffOptions(preset.kind, resolved)).toEqual({});
    }
  });

  test("rebuilds the same options from the diff", () => {
    const next = prng(99);
    for (let i = 0; i < 600; i++) {
      const preset = PRESETS[Math.floor(next() * PRESETS.length)];
      const resolved = resolveOptions(
        preset.kind,
        preset.id,
        randomPartial(next),
      );
      const diff = diffOptions(preset.kind, resolved);
      const query = serializeOptions(diff);
      expect(resolveOptions(preset.kind, preset.id, parse(query))).toEqual(
        resolved,
      );
    }
  });
});

describe("stripProOptions", () => {
  test("forces the brand on and the animation off", () => {
    const asked: Partial<BannerOptions> = {
      brand: false,
      animate: true,
      theme: "nord",
    };
    expect(stripProOptions(asked)).toEqual({
      brand: true,
      animate: false,
      theme: "nord",
    });
    const resolved = resolveOptions("user", null, {
      brand: false,
      animate: true,
    });
    expect(resolved.brand).toBe(false);
    const stripped = stripProOptions(resolved);
    expect(stripped.brand).toBe(true);
    expect(stripped.animate).toBe(false);
    expect(resolved.brand).toBe(false);
    expect(
      serializeOptions(stripProOptions(parse("brand=0&animate=1&size=x"))),
    ).toBe("size=x");
  });
});

describe("normalizeHex", () => {
  test("normalises valid colours and rejects the rest", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("0D1117")).toBe("#0d1117");
    expect(normalizeHex("  #fff  ")).toBe("#ffffff");
    for (const junk of [
      "",
      "#12",
      "#12345",
      "#1234567",
      "transparent",
      null,
      undefined,
      5,
      {},
    ]) {
      expect(normalizeHex(junk)).toBeNull();
    }
  });
});
