import { FREE, PRO } from "@/lib/pro/entitlements";
import { proRepoLink } from "@/lib/pro/repo";
import { site } from "@/lib/site";
import { FACTS } from "./facts";
import { duration } from "./format";
import type { ContentPage } from "./types";

const host = new URL(site.url).host;
/** The repository the server checks for Pro. */
const proRepo = proRepoLink();

/**
 * Homepage copy. The page component adds the interactive parts (the input,
 * the live preview, the gallery); this is the text both it and the Markdown
 * version are built from. The FAQ lives in `faq.ts`.
 */
export const home: ContentPage = {
  path: "/",
  title: `${site.name}: live GitHub profile, repo and org banners`,
  description:
    "Turn any GitHub profile, repository or organization into a live banner. One URL, always current. SVG and PNG for READMEs, X, LinkedIn and link previews.",
  updated: "2026-11-13",
  heading: "Live GitHub banners for profiles, repos and orgs",
  lead: "Type a username or owner/repo. Get a banner that updates itself, as SVG or PNG, for your README, X header, LinkedIn and link previews.",
  sections: [
    {
      id: "one-url",
      title: "One URL that stays current",
      blocks: [
        {
          type: "p",
          text: `\`${host}/you\` is a page. Add \`.svg\` or \`.png\` and it is the image. GitHub data refreshes every ${FACTS.dataRefreshMinutes} minutes, so a banner you pasted once keeps telling the truth.`,
        },
        {
          type: "table",
          head: ["URL", "What you get"],
          rows: [
            [`\`${host}/{user}.svg\``, "Profile overview"],
            [`\`${host}/{user}/activity.svg\``, "Only the contribution graph"],
            [`\`${host}/{user}/repos.svg\``, "Top repositories and activity"],
            [`\`${host}/{owner}/{repo}.svg\``, "Repository overview"],
            [
              `\`${host}/{owner}/{repo}/contributors.svg\``,
              "Contributors with avatars",
            ],
            [`\`${host}/{org}.svg\``, "Organization overview"],
            [
              `\`${host}/embed/{user}\``,
              "Extension-less image URL for embedding",
            ],
          ],
        },
        {
          type: "banner",
          path: `/${site.exampleLogin}`,
          alt: `GitHub banner for ${site.exampleLogin}`,
        },
      ],
    },
    {
      id: "banners",
      title: "Banners for people, projects and teams",
      blocks: [
        {
          type: "p",
          text: "Sixteen presets cover the things people put in a README or a header: who you are, what you ship and who you ship it with.",
        },
      ],
    },
    {
      id: "profiles",
      title: "Profiles",
      level: 3,
      blocks: [
        {
          type: "p",
          text: "Overview, activity only, stats, top repositories, languages, streak, a compact card and a year in review. Works for any public account.",
        },
        {
          type: "banner",
          path: "/torvalds",
          alt: "GitHub banner for torvalds",
        },
      ],
    },
    {
      id: "repositories",
      title: "Repositories",
      level: 3,
      blocks: [
        {
          type: "p",
          text: "Overview with the language bar, a year of commit activity, contributors with avatars, the latest release and a social preview sized for GitHub's upload.",
        },
        {
          type: "banner",
          path: "/vercel/next.js/contributors",
          alt: "Contributors banner for vercel/next.js",
        },
      ],
    },
    {
      id: "organizations",
      title: "Organizations",
      level: 3,
      blocks: [
        {
          type: "p",
          text: "Members, repositories and stars of a whole organization, its top repositories, and the combined commit activity of its most active projects.",
        },
        { type: "banner", path: "/vercel", alt: "GitHub banner for vercel" },
      ],
    },
    {
      id: "sizes",
      title: "Sized for where you post",
      blocks: [
        {
          type: "p",
          text: "README, X header, LinkedIn banner, link preview, GitHub social preview and square. In the studio a dashed area shows where each site puts your profile photo, and the layout keeps clear of it.",
        },
        {
          type: "table",
          head: ["Size", "Pixels", "Parameter"],
          rows: [
            ["README", "846 wide, height follows content", "`size=readme`"],
            ["X header", "1500 by 500", "`size=x`"],
            ["LinkedIn banner", "1584 by 396", "`size=linkedin`"],
            ["Link preview", "1200 by 630", "`size=og`"],
            ["GitHub social preview", "1280 by 640", "`size=social`"],
            ["Square", "1080 by 1080", "`size=square`"],
          ],
        },
      ],
    },
    {
      id: "themes",
      title: "Themes that match GitHub and your editor",
      blocks: [
        {
          type: "p",
          text: "The default is GitHub's own dark theme, colour for colour. There are 24 themes in all, including GitHub light and dimmed, Dracula, Tokyo Night, Catppuccin, Nord, Gruvbox and Solarized, and every colour can be overridden in the URL. [Browse all themes](/themes).",
        },
        {
          type: "code",
          lang: "text",
          code: `https://${host}/${site.exampleLogin}.svg?theme=tokyo-night\nhttps://${host}/${site.exampleLogin}.svg?bg=0b1021&accent=ff7ac6&heat=a855f7`,
        },
      ],
    },
    {
      id: "readme",
      title: "Paste it into your README",
      blocks: [
        {
          type: "p",
          text: "Every banner comes with a snippet. The plain Markdown one works everywhere; the picture one follows the reader's light or dark GitHub theme.",
        },
        {
          type: "code",
          lang: "md",
          code: `[![GitHub banner](https://${host}/${site.exampleLogin}.svg)](https://${host}/${site.exampleLogin})`,
        },
        {
          type: "code",
          lang: "html",
          code: `<a href="https://${host}/${site.exampleLogin}">\n  <picture>\n    <source media="(prefers-color-scheme: dark)" srcset="https://${host}/${site.exampleLogin}.svg?theme=github-dark">\n    <img src="https://${host}/${site.exampleLogin}.svg?theme=github-light" alt="GitHub banner">\n  </picture>\n</a>`,
        },
      ],
    },
    {
      id: "migrate",
      title: "Replace the cards that stopped loading",
      blocks: [
        {
          type: "p",
          text: "If your stats, trophy or activity card shows a broken image, paste your README into the [README doctor](/docs/migrate). It finds image URLs that point at dead card servers and gives you working ones back.",
        },
      ],
    },
    {
      id: "pricing",
      title: "Free for public data. Pro for a star.",
      blocks: [
        {
          type: "p",
          text: `Every banner, preset, size and theme is free, with no sign-in. Pro costs one star on [${proRepo.slug}](${proRepo.url}) and adds the things you want once a banner is part of your profile. [See pricing](/pricing).`,
        },
        {
          type: "table",
          head: ["", "Free", "Pro"],
          rows: [
            ["Live banners, all presets, sizes and themes", "Yes", "Yes"],
            ["SVG and PNG, custom colours", "Yes", "Yes"],
            ["Saved banners with stable links", "3", "50"],
            ["GitBanners mark on saved banners", "Shown", "Removable"],
            ["Animated contribution graph (SVG)", "No", "Yes"],
            ["Your own default banner at your profile URL", "No", "Yes"],
            [
              "Saved banners redrawn at the edge",
              `Every ${duration(FREE.refreshSeconds)}`,
              `Every ${duration(PRO.refreshSeconds)}`,
            ],
            [
              "GitHub data refreshed",
              `Every ${FACTS.dataRefreshMinutes} minutes`,
              `Every ${FACTS.dataRefreshMinutes} minutes`,
            ],
            ["Price", "$0", "One GitHub star"],
          ],
        },
      ],
    },
    {
      id: "agents",
      title: "Works for agents",
      blocks: [
        {
          type: "p",
          text: "GitBanners is built to be used by software as much as by people. Nothing needs a key or an account.",
        },
        {
          type: "list",
          items: [
            "Every content page and banner page has a Markdown version: add `.md` to the URL or send `Accept: text/markdown`.",
            "A keyless JSON API under `/api/v1`, described by [OpenAPI](/openapi.json), with standard rate-limit headers and problem+json errors.",
            "An [MCP server](/docs#mcp) with read-only tools for profiles, repositories, search and banner URLs.",
            "An [llms.txt](/llms.txt) index and a full-text [llms-full.txt](/llms-full.txt).",
          ],
        },
      ],
    },
  ],
};
