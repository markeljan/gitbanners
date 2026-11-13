import { describe, expect, test } from "bun:test";
import { EXAMPLE_README } from "./example";
import {
  type ChangeAction,
  type MigrateOptions,
  migrateReadme,
} from "./migrate";

const G = "https://gitbanners.com";
const RS = "https://github-readme-stats.vercel.app";

interface Case {
  name: string;
  input: string;
  /** Expected output. Default: the input, unchanged. */
  output?: string;
  /** Action of each recognised card, in order. */
  actions: ChangeAction[];
  options?: Omit<MigrateOptions, "origin">;
  /** Substrings expected in the carried and dropped lists of the first change. */
  carried?: string[];
  dropped?: string[];
}

const CASES: Case[] = [
  {
    name: "stats card in Markdown image syntax",
    input: `![Stats](${RS}/api?username=torvalds)`,
    output: `![Stats](${G}/torvalds/stats.svg)`,
    actions: ["replace"],
  },
  {
    name: "stats card with a theme of the same name and options with no equivalent",
    input: `![Stats](${RS}/api?username=torvalds&show_icons=true&theme=dracula&count_private=true)`,
    output: `![Stats](${G}/torvalds/stats.svg?theme=dracula)`,
    actions: ["replace"],
    carried: ["theme=dracula → theme=dracula"],
    dropped: ["show_icons", "count_private"],
  },
  {
    name: "top languages with a trailing slash before the query",
    input: `![Top langs](${RS}/api/top-langs/?username=sindresorhus&layout=compact)`,
    output: `![Top langs](${G}/sindresorhus/languages.svg)`,
    actions: ["replace"],
    dropped: ["layout"],
  },
  {
    name: "top languages keeps the number of languages, capped",
    input: `![](${RS}/api/top-langs?username=a&langs_count=50)`,
    output: `![](${G}/a/languages.svg?count=30)`,
    actions: ["replace"],
  },
  {
    name: "repository pin becomes the repository banner",
    input: `[![Readme card](${RS}/api/pin/?username=vercel&repo=next.js)](https://github.com/vercel/next.js)`,
    output: `[![Readme card](${G}/vercel/next.js.svg)](https://github.com/vercel/next.js)`,
    actions: ["replace"],
  },
  {
    name: "pin without a repository is flagged",
    input: `![](${RS}/api/pin/?username=vercel)`,
    actions: ["flag"],
  },
  {
    name: "WakaTime card has no equivalent",
    input: `![Coding time](${RS}/api/wakatime?username=torvalds)`,
    actions: ["flag"],
  },
  {
    name: "gist pin has no equivalent",
    input: `![Gist](${RS}/api/gist?id=bbfce31e0217a3689c8d961a356cb10d)`,
    actions: ["flag"],
  },
  {
    name: "HTML img with double quotes",
    input: `<img src="${RS}/api?username=torvalds" alt="Stats" />`,
    output: `<img src="${G}/torvalds/stats.svg" alt="Stats" />`,
    actions: ["replace"],
  },
  {
    name: "HTML img with single quotes",
    input: `<img alt='Stats' src='${RS}/api?username=torvalds&custom_title=It%27s%20me'>`,
    output: `<img alt='Stats' src='${G}/torvalds/stats.svg?title=It%27s%20me'>`,
    actions: ["replace"],
  },
  {
    name: "HTML img with an unquoted src and spaces around the equals sign",
    input: `<img src = ${RS}/api?username=torvalds width=400>`,
    output: `<img src = ${G}/torvalds/stats.svg width=400>`,
    actions: ["replace"],
  },
  {
    name: "&amp; in an HTML attribute is read and written back the same way",
    input: `<img src="${RS}/api?username=torvalds&amp;theme=dracula&amp;hide_border=true">`,
    output: `<img src="${G}/torvalds/stats.svg?theme=dracula&amp;border=0">`,
    actions: ["replace"],
  },
  {
    name: "numeric ampersand entities",
    input: `<img src="${RS}/api?username=torvalds&#38;theme=nord">`,
    output: `<img src="${G}/torvalds/stats.svg?theme=nord">`,
    actions: ["replace"],
  },
  {
    name: "line-wrapped HTML attributes",
    input: `<img\n  alt="GitHub stats"\n  src="${RS}/api?username=torvalds&theme=nord"\n  width="49%"\n/>`,
    output: `<img\n  alt="GitHub stats"\n  src="${G}/torvalds/stats.svg?theme=nord"\n  width="49%"\n/>`,
    actions: ["replace"],
  },
  {
    name: "a > inside a quoted attribute does not end the tag",
    input: `<img alt="stats > streak" src="${RS}/api?username=torvalds">`,
    output: `<img alt="stats > streak" src="${G}/torvalds/stats.svg">`,
    actions: ["replace"],
  },
  {
    name: "two Markdown cards on one line",
    input: `![a](${RS}/api?username=a) ![b](${RS}/api/top-langs/?username=a)`,
    output: `![a](${G}/a/stats.svg) ![b](${G}/a/languages.svg)`,
    actions: ["replace", "replace"],
  },
  {
    name: "two HTML cards in a centred paragraph",
    input: `<p align="center">\n  <img src="${RS}/api?username=a" height="150"/><img src="${RS}/api/top-langs?username=a&layout=compact" height="150"/>\n</p>`,
    output: `<p align="center">\n  <img src="${G}/a/stats.svg" height="150"/><img src="${G}/a/languages.svg" height="150"/>\n</p>`,
    actions: ["replace", "replace"],
  },
  {
    name: "cards inside a Markdown table",
    input: `| Stats | Languages |\n| --- | --- |\n| ![](${RS}/api?username=a) | ![](${RS}/api/top-langs?username=a) |`,
    output: `| Stats | Languages |\n| --- | --- |\n| ![](${G}/a/stats.svg) | ![](${G}/a/languages.svg) |`,
    actions: ["replace", "replace"],
  },
  {
    name: "reference-style definition",
    input: `![Stats][stats]\n\n[stats]: ${RS}/api?username=a&theme=nord`,
    output: `![Stats][stats]\n\n[stats]: ${G}/a/stats.svg?theme=nord`,
    actions: ["replace"],
  },
  {
    name: "reference-style definition in angle brackets with a title",
    input: `![Stats][1]\n\n [1]: <${RS}/api?username=a> "My stats"`,
    output: `![Stats][1]\n\n [1]: <${G}/a/stats.svg> "My stats"`,
    actions: ["replace"],
  },
  {
    name: "Markdown destination in angle brackets",
    input: `![Stats](<${RS}/api?username=a>)`,
    output: `![Stats](<${G}/a/stats.svg>)`,
    actions: ["replace"],
  },
  {
    name: "Markdown image with a title",
    input: `![Stats](${RS}/api?username=a "Stats card")`,
    output: `![Stats](${G}/a/stats.svg "Stats card")`,
    actions: ["replace"],
  },
  {
    name: "upper-case host and login",
    input: `![](HTTPS://GitHub-Readme-Stats.Vercel.App/api?username=Torvalds)`,
    output: `![](${G}/torvalds/stats.svg)`,
    actions: ["replace"],
  },
  {
    name: "missing username without a login is flagged",
    input: `![](${RS}/api?theme=dark)`,
    actions: ["flag"],
  },
  {
    name: "missing username takes the login given",
    input: `![](${RS}/api?theme=dark)`,
    output: `![](${G}/octocat/stats.svg)`,
    actions: ["replace"],
    options: { login: "octocat" },
  },
  {
    name: "empty username takes the login given",
    input: `![](${RS}/api?username=&theme=nord)`,
    output: `![](${G}/octocat/stats.svg?theme=nord)`,
    actions: ["replace"],
    options: { login: "octocat" },
  },
  {
    name: "a username that cannot be a login is flagged",
    input: `![](${RS}/api?username=not%20a%20user!)`,
    actions: ["flag"],
    options: { login: "octocat" },
  },
  {
    name: "URL-encoded title and hidden stats",
    input: `![](${RS}/api?username=a&custom_title=My%20GitHub%20Stats&hide=stars%2Ccommits)`,
    output: `![](${G}/a/stats.svg?title=My%20GitHub%20Stats&stats=pullRequests,issues,contributedTo)`,
    actions: ["replace"],
  },
  {
    name: "shown stats are added after the default ones",
    input: `![](${RS}/api?username=a&show=reviews,prs_merged&hide=issues)`,
    output: `![](${G}/a/stats.svg?stats=stars,commits,pullRequests,contributedTo,reviews)`,
    actions: ["replace"],
  },
  {
    name: "custom colours carry over",
    input: `![](${RS}/api?username=a&bg_color=0d1117&title_color=58a6ff&text_color=c9d1d9&icon_color=8b949e&border_color=30363d)`,
    output: `![](${G}/a/stats.svg?bg=0d1117&border_color=30363d&text=c9d1d9&muted=8b949e&accent=58a6ff)`,
    actions: ["replace"],
  },
  {
    name: "a gradient background keeps its first colour",
    input: `![](${RS}/api?username=a&bg_color=30,e96443,904e95)`,
    output: `![](${G}/a/stats.svg?bg=e96443)`,
    actions: ["replace"],
  },
  {
    name: "a light background switches to the light theme",
    input: `![](${RS}/api?username=a&bg_color=fffefe&text_color=333)`,
    output: `![](${G}/a/stats.svg?theme=github-light&bg=fffefe&text=333333)`,
    actions: ["replace"],
  },
  {
    name: "colours with a # encoded and an alpha channel",
    input: `![](${RS}/api?username=a&bg_color=%2300000000)`,
    output: `![](${G}/a/stats.svg?bg=000000)`,
    actions: ["replace"],
  },
  {
    name: "radius is rounded, width carried",
    input: `![](${RS}/api?username=a&border_radius=4.5&card_width=600)`,
    output: `![](${G}/a/stats.svg?width=600&radius=5)`,
    actions: ["replace"],
  },
  {
    name: "a width under the minimum is dropped",
    input: `![](${RS}/api?username=a&card_width=200)`,
    output: `![](${G}/a/stats.svg)`,
    actions: ["replace"],
    dropped: ["card_width"],
  },
  {
    name: "hide_title hides the title",
    input: `![](${RS}/api/top-langs?username=a&hide_title=true)`,
    output: `![](${G}/a/languages.svg?hide=title)`,
    actions: ["replace"],
  },
  {
    name: "the default light theme becomes GitHub light",
    input: `![](${RS}/api?username=a&theme=default)`,
    output: `![](${G}/a/stats.svg?theme=github-light)`,
    actions: ["replace"],
  },
  {
    name: "a theme with no equivalent is dropped",
    input: `![](${RS}/api?username=a&theme=radical)`,
    output: `![](${G}/a/stats.svg)`,
    actions: ["replace"],
    dropped: ["theme"],
  },
  {
    name: "streak card on demolab still works: offered, not forced",
    input: `![Streak](https://streak-stats.demolab.com?user=a&theme=dark)`,
    actions: ["optional"],
  },
  {
    name: "streak card swapped when optional changes are accepted",
    input: `![Streak](https://streak-stats.demolab.com/?user=a&hide_border=true&ring=ff0000&fire=00ff00)`,
    output: `![Streak](${G}/a/streak.svg?accent=ff0000&border=0)`,
    actions: ["optional"],
    options: { acceptOptional: true },
  },
  {
    name: "streak card on Heroku asked as PNG stays a PNG",
    input: `![Streak](https://github-readme-streak-stats.herokuapp.com/?user=a&type=png)`,
    output: `![Streak](${G}/a/streak.png)`,
    actions: ["optional"],
    options: { acceptOptional: new Set(["change-1"]) },
  },
  {
    name: "trophy card becomes the small card",
    input: `[![trophy](https://github-profile-trophy.vercel.app/?username=a&theme=onedark&no-frame=true&row=1&column=7)](https://github.com/ryo-ma/github-profile-trophy)`,
    output: `[![trophy](${G}/a/card.svg?theme=one-dark&border=0)](https://github.com/ryo-ma/github-profile-trophy)`,
    actions: ["replace"],
    dropped: ["row", "column"],
  },
  {
    name: "a trophy mirror is offered",
    input: `![](https://github-profile-trophy-kannwism.vercel.app/?username=a)`,
    actions: ["optional"],
  },
  {
    name: "activity graph on Vercel",
    input: `![Graph](https://github-readme-activity-graph.vercel.app/graph?username=a&theme=tokyo-night&hide_border=true&area=true)`,
    output: `![Graph](${G}/a/activity.svg?theme=tokyo-night&border=0)`,
    actions: ["replace"],
    dropped: ["area"],
  },
  {
    name: "activity graph on its old Heroku host",
    input: `![Graph](https://github-readme-activity-graph.herokuapp.com/graph?username=a&bg_color=000000&color=ffffff&line=ff0000&radius=6)`,
    output: `![Graph](${G}/a/activity.svg?bg=000000&text=ffffff&accent=ff0000&radius=6)`,
    actions: ["replace"],
  },
  {
    name: "gh-card repository card",
    input: `[![vercel/next.js](https://gh-card.dev/repos/vercel/next.js.svg?fullname=)](https://github.com/vercel/next.js)`,
    output: `[![vercel/next.js](${G}/vercel/next.js.svg)](https://github.com/vercel/next.js)`,
    actions: ["replace"],
    dropped: ["fullname"],
  },
  {
    name: "summary cards still work: accepted by id",
    input: `![](https://github-profile-summary-cards.vercel.app/api/cards/profile-details?username=a&theme=dracula)\n![](https://github-profile-summary-cards.vercel.app/api/cards/stats?username=a)`,
    output: `![](https://github-profile-summary-cards.vercel.app/api/cards/profile-details?username=a&theme=dracula)\n![](${G}/a/stats.svg)`,
    actions: ["optional", "optional"],
    options: { acceptOptional: new Set(["change-2"]) },
  },
  {
    name: "productive time has no equivalent",
    input: `![](https://github-profile-summary-cards.vercel.app/api/cards/productive-time?username=a&utcOffset=8)`,
    actions: ["flag"],
  },
  {
    name: "a self-hosted readme-stats copy is offered, not forced",
    input: `![](https://github-readme-stats-eight-theta.vercel.app/api?username=a)`,
    actions: ["optional"],
  },
  {
    name: "the maintained fork on its own host is offered",
    input: `![](https://github-stats-extended.vercel.app/api?username=a&theme=nord)`,
    output: `![](${G}/a/stats.svg?theme=nord)`,
    actions: ["optional"],
    options: { acceptOptional: true },
  },
  {
    name: "an unrelated /api URL is not a card",
    input: `![](https://example.com/api?username=a) ![](https://img.shields.io/badge/api-v1-blue)`,
    actions: [],
  },
  {
    name: "a card inside fenced code is an example: untouched",
    input:
      "```md\n![](" +
      RS +
      '/api?username=a)\n```\n\n~~~\n<img src="' +
      RS +
      '/api?username=a">\n~~~',
    actions: [],
  },
  {
    name: "a card inside inline code is untouched",
    input: `Old: \`![](${RS}/api?username=a)\``,
    actions: [],
  },
  {
    name: "a card inside an HTML comment is untouched",
    input: `<!-- ![](${RS}/api?username=a) -->\n![](${RS}/api?username=c)`,
    output: `<!-- ![](${RS}/api?username=a) -->\n![](${G}/c/stats.svg)`,
    actions: ["replace"],
  },
  {
    name: "a plain link to a card URL is not an image: untouched",
    input: `[my stats](${RS}/api?username=a)`,
    actions: [],
  },
  {
    name: "picture with dark and light sources keeps its structure",
    input: `<picture>\n  <source media="(prefers-color-scheme: dark)" srcset="${RS}/api?username=a&theme=dark">\n  <source media="(prefers-color-scheme: light)" srcset="${RS}/api?username=a">\n  <img src="${RS}/api?username=a" alt="stats">\n</picture>`,
    output: `<picture>\n  <source media="(prefers-color-scheme: dark)" srcset="${G}/a/stats.svg">\n  <source media="(prefers-color-scheme: light)" srcset="${G}/a/stats.svg?theme=github-light">\n  <img src="${G}/a/stats.svg" alt="stats">\n</picture>`,
    actions: ["replace", "replace", "replace"],
  },
  {
    name: "srcset with a density descriptor and commas inside the URL",
    input: `<source srcset="${RS}/api?username=a&hide=stars,commits 2x">`,
    output: `<source srcset="${G}/a/stats.svg?stats=pullRequests%2Cissues%2CcontributedTo 2x">`,
    actions: ["replace"],
  },
  {
    name: "GitHub's mode-only fragments are kept and read as a hint",
    input: `![](${RS}/api?username=a#gh-light-mode-only)\n![](${RS}/api?username=a&theme=dark#gh-dark-mode-only)`,
    output: `![](${G}/a/stats.svg?theme=github-light#gh-light-mode-only)\n![](${G}/a/stats.svg#gh-dark-mode-only)`,
    actions: ["replace", "replace"],
  },
  {
    name: "data-src is not src",
    input: `<img data-src="${RS}/api?username=a" src="/local.png">`,
    actions: [],
  },
  {
    name: "parentheses in a title are encoded so the Markdown still parses",
    input: `![](${RS}/api?username=a&custom_title=Stats%20(2025))`,
    output: `![](${G}/a/stats.svg?title=Stats%20%282025%29)`,
    actions: ["replace"],
  },
  {
    name: "GitBanners URLs are left alone",
    input: `![](${G}/a/stats.svg?theme=nord)`,
    actions: [],
  },
  {
    name: "Windows line endings",
    input: `# Me\r\n\r\n![](${RS}/api?username=a)\r\n`,
    output: `# Me\r\n\r\n![](${G}/a/stats.svg)\r\n`,
    actions: ["replace"],
  },
  {
    name: "protocol-relative URL",
    input: `<img src="//github-readme-stats.vercel.app/api?username=a">`,
    output: `<img src="${G}/a/stats.svg">`,
    actions: ["replace"],
  },
  {
    name: "a login that is also a route of this site gets the @ form",
    input: `![](${RS}/api?username=docs)`,
    output: `![](${G}/@docs/stats.svg)`,
    actions: ["replace"],
  },
];

describe("migrateReadme", () => {
  test("has at least 40 cases", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40);
  });

  for (const testCase of CASES) {
    describe(testCase.name, () => {
      const options = { ...testCase.options, origin: G };
      const result = migrateReadme(testCase.input, options);

      test("output", () => {
        expect(result.markdown).toBe(testCase.output ?? testCase.input);
      });

      test("actions", () => {
        expect(result.changes.map((change) => change.action)).toEqual(
          testCase.actions,
        );
      });

      test("positions point at the old URL", () => {
        for (const change of result.changes) {
          expect(testCase.input.slice(change.start, change.end)).toBe(
            change.from,
          );
          const lines = testCase.input.split("\n");
          const line = lines[change.line - 1] ?? "";
          expect(line.slice(change.column - 1)).toStartWith(
            change.from.split("\n")[0] ?? "",
          );
        }
      });

      test("every change has a reason, and only applied changes reach the output", () => {
        for (const change of result.changes) {
          expect(change.reason.length).toBeGreaterThan(20);
          expect(change.reason).not.toMatch(/[—–]/);
          if (change.action === "flag") expect(change.to).toBeNull();
          if (change.action === "replace") expect(change.applied).toBe(true);
          if (change.applied && change.to) {
            expect(result.markdown).toContain(change.to);
          }
        }
      });

      if (testCase.carried || testCase.dropped) {
        test("reports what carried over and what was dropped", () => {
          const first = result.changes[0];
          for (const item of testCase.carried ?? []) {
            expect(first?.carried).toContain(item);
          }
          for (const item of testCase.dropped ?? []) {
            expect(first?.dropped).toContain(item);
          }
        });
      }

      test("is idempotent", () => {
        const again = migrateReadme(result.markdown, options);
        expect(again.markdown).toBe(result.markdown);
        expect(
          again.changes.some((change) => change.action === "replace"),
        ).toBe(false);
      });
    });
  }
});

describe("the example README", () => {
  const result = migrateReadme(EXAMPLE_README, { origin: G });

  test("has dead cards, a working one and one without an equivalent", () => {
    const actions = new Set(result.changes.map((change) => change.action));
    expect(actions).toEqual(new Set(["replace", "optional", "flag"]));
  });

  test("keeps everything that is not a card URL", () => {
    const strip = (text: string) =>
      text.replace(/https?:\/\/[^\s"')]+/g, "URL");
    expect(strip(result.markdown)).toBe(strip(EXAMPLE_README));
  });

  test("is idempotent with every optional change accepted", () => {
    const all = migrateReadme(EXAMPLE_README, {
      origin: G,
      acceptOptional: true,
    });
    expect(
      migrateReadme(all.markdown, { origin: G, acceptOptional: true }).markdown,
    ).toBe(all.markdown);
  });
});
