import { CACHE } from "@/lib/http/cache-headers";
import { SERVICES_CHECKED } from "@/lib/migrate/services";
import { site } from "@/lib/site";
import { duration, longDate } from "./format";
import type { ContentPage } from "./types";

const login = site.exampleLogin;
const checked = longDate(SERVICES_CHECKED);

/**
 * /docs/migrate: the README doctor. The page is the tool plus this copy; the
 * copy is also its Markdown version, so agents learn what the tool does and
 * how to do the same by hand.
 */
export const migrate: ContentPage = {
  path: "/docs/migrate",
  title: "README doctor: fix broken GitHub stats cards",
  description:
    "Fix broken github-readme-stats, trophy and activity graph images in a GitHub README. Paste it, get working banner URLs back. Runs in your browser.",
  updated: "2026-11-13",
  heading: "README doctor",
  lead: `Paste your profile README, or enter your GitHub username, and get it back with every broken stats card swapped for a ${site.name} banner that keeps loading. The doctor runs in your browser: your README is never uploaded.`,
  sections: [
    {
      id: "what-breaks",
      title: "Which cards stopped loading",
      blocks: [
        {
          type: "p",
          text: `Several free card services that READMEs point at have run out of hosting. GitHub shows a broken image wherever one of them answers with an error. This is what each one answered on ${checked}, and what the doctor does with it:`,
        },
        {
          type: "table",
          head: ["Card service", "Today", "What the doctor does"],
          rows: [
            [
              "github-readme-stats on `github-readme-stats.vercel.app`",
              "Paused: `503`. Its README says it is no longer maintained.",
              "Replaces the stats card, top languages and repository pins. Flags WakaTime and gist cards, which have no equivalent.",
            ],
            [
              "github-profile-trophy on `github-profile-trophy.vercel.app`",
              "Disabled: `402`.",
              "Replaces it with the small profile card.",
            ],
            [
              "github-readme-activity-graph",
              "Disabled on Vercel (`402`); the earlier Heroku and Cyclic hosts are gone.",
              "Replaces it with the contribution graph banner.",
            ],
            [
              "gh-card on `gh-card.dev`",
              "Discontinued: the card URL answers with a web page.",
              "Replaces it with the repository banner.",
            ],
            [
              "github-readme-streak-stats on `streak-stats.demolab.com` or Heroku",
              "Works.",
              "Offers the streak banner. You choose.",
            ],
            [
              "github-profile-summary-cards",
              "Works.",
              "Offers the closest banner. You choose.",
            ],
            [
              "A copy of one of these on another host",
              "Unknown.",
              "Offers the swap, never makes it on its own.",
            ],
          ],
        },
        {
          type: "p",
          text: "The doctor looks at image URLs only: Markdown images, `<img src>`, `<source srcset>` inside a `<picture>`, and reference-style definitions. Links around the images, alt text, alignment, tables and everything else stay exactly as they were. Cards inside code blocks and HTML comments are left alone, and so are cards it does not recognise.",
        },
      ],
    },
    {
      id: "presets",
      title: "What each card becomes",
      blocks: [
        {
          type: "table",
          head: ["Old card", `${site.name} banner`],
          rows: [
            ["Stats card", `\`/${login}/stats.svg\`: eight headline numbers.`],
            ["Top languages", `\`/${login}/languages.svg\`: the language mix.`],
            [
              "Repository pin, gh-card",
              "`/{owner}/{repo}.svg`: name, description, numbers and languages.",
            ],
            ["Streak", `\`/${login}/streak.svg\`: current and longest streak.`],
            [
              "Activity graph",
              `\`/${login}/activity.svg\`: the contribution graph with the yearly total.`,
            ],
            [
              "Trophies",
              `\`/${login}/card.svg\`: a small card with three numbers.`,
            ],
            [
              "Summary cards",
              "Profile details become the overview banner, stats the stats banner, languages the languages banner.",
            ],
          ],
        },
        {
          type: "p",
          text: "The banners have their own design, so they will not look like the old cards. README banners are 846 pixels wide and set their own height; to put two side by side, give each `<img>` a `width`, as the old cards needed too. The [docs](/docs#presets) list every preset.",
        },
      ],
    },
    {
      id: "what-carries-over",
      title: "What carries over",
      blocks: [
        {
          type: "table",
          head: ["Old parameter", "Becomes"],
          rows: [
            [
              "`username`, `user`, `repo`",
              "The path: `/{username}` or `/{owner}/{repo}`.",
            ],
            [
              "`theme` with a theme of the same name",
              "`theme`, such as `dracula`, `nord`, `tokyo-night` or `one-dark`.",
            ],
            [
              "A light theme such as `default`, a light `<source media>` or `#gh-light-mode-only`",
              "`theme=github-light`.",
            ],
            ["`hide_border`, `no-frame`", "`border=0`."],
            ["`border_radius`, `radius`", "`radius`, rounded to whole pixels."],
            ["`card_width`", `\`width\`, from 320 pixels.`],
            ["`custom_title`, `hide_title`", "`title`, `hide=title`."],
            [
              "`hide` and `show` on the stats card",
              "`stats`, the numbers to show, in the same order.",
            ],
            ["`langs_count`", "`count`."],
            [
              "`bg_color`, `text_color`, `title_color`, `icon_color`, `border_color` and the streak card's colours",
              "`bg`, `text`, `accent`, `muted`, `border_color`. A gradient keeps its first colour.",
            ],
            ["`type=png` on the streak card", "A `.png` URL."],
          ],
        },
        {
          type: "p",
          text: "Everything else is listed as dropped next to each change: layouts such as `compact` or `donut`, `locale` (banners are in English), icons, ranks, `exclude_repo`, `cache_seconds`, trophy rows and columns, and the number of days of the activity graph. A theme with no equivalent falls back to GitHub dark.",
        },
        {
          type: "p",
          text: "When a card names no user, the doctor uses the username you entered. Without one it flags the card instead of guessing.",
        },
      ],
    },
    {
      id: "why-it-keeps-working",
      title: `Why ${site.name} URLs keep working`,
      blocks: [
        {
          type: "list",
          items: [
            "An image URL always answers `200` with an image. An unknown username or a GitHub outage is drawn as a small card, so a README never shows a broken-image icon because of us.",
            `Every banner is cached at the edge. The copy is refreshed every ${duration(CACHE.banner.edge)} in the background while the previous one is served, and kept for up to ${duration(CACHE.banner.sie)} if GitHub cannot be reached.`,
            "Rendering is cheap and cached, and the same URL is shared by every README that embeds it, so a popular profile costs one render per cache lifetime, not one per view.",
            "There is no key, no account and no deployment of your own to keep alive.",
          ],
        },
        {
          type: "p",
          text: "If you would rather depend on nobody's server, a [GitHub Action](/docs#github-action) can download your banners into your profile repository on a schedule, and your README then points at files in your own repository.",
        },
      ],
    },
    {
      id: "privacy",
      title: "Your README stays in your browser",
      blocks: [
        {
          type: "list",
          items: [
            "The doctor is code that runs in this page. What you paste is never sent anywhere.",
            "With a username, your browser fetches the profile README straight from GitHub (`raw.githubusercontent.com/{username}/{username}`). It does not pass through this site.",
            "The previews load the new banner images, the same requests a README makes when someone reads it.",
          ],
        },
      ],
    },
    {
      id: "by-hand",
      title: "Doing it by hand",
      blocks: [
        {
          type: "p",
          text: "Swap the image URL and keep the rest. A stats card that no longer loads:",
        },
        {
          type: "code",
          lang: "md",
          code: `[![GitHub stats](https://github-readme-stats.vercel.app/api?username=${login}&theme=dracula&hide_border=true)](https://github.com/anuraghazra/github-readme-stats)`,
        },
        { type: "p", text: "becomes:" },
        {
          type: "code",
          lang: "md",
          code: `[![GitHub stats](${site.url}/${login}/stats.svg?theme=dracula&border=0)](${site.url}/${login})`,
        },
        {
          type: "p",
          text: `Linking the banner to its page lets readers make one of their own. The [studio](/studio) builds any other banner and copies its Markdown.`,
        },
      ],
    },
  ],
};
