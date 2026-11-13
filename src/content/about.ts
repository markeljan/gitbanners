import { PRESETS, THEMES } from "@/lib/banner";
import { site } from "@/lib/site";
import { FACTS } from "./facts";
import type { ContentPage } from "./types";

export const about: ContentPage = {
  path: "/about",
  title: `About ${site.name}`,
  description: `What ${site.name} is, who runs it, where its data comes from and what it is built with. An independent project, not affiliated with GitHub.`,
  updated: "2026-11-13",
  heading: `About ${site.name}`,
  lead: `${site.name} turns a public GitHub profile, repository or organization into a banner image with a URL. The image is drawn from live data, so a banner pasted into a README once keeps telling the truth.`,
  sections: [
    {
      id: "what-it-does",
      title: "What it does",
      blocks: [
        {
          type: "list",
          items: [
            `Draws ${PRESETS.length} kinds of banner: profile overviews, contribution graphs, stats, streaks, top repositories, languages, a year in review, repository activity and contributors, and organization overviews.`,
            `Serves each one as SVG or PNG, in ${THEMES.length} themes and in sizes for a README, an X header, a LinkedIn banner, a link preview and GitHub's social preview.`,
            "Gives every banner a stable address, so it can be embedded anywhere an image can.",
            "Offers the same data to software: a keyless [JSON API](/docs#rest-api), an [MCP server](/docs#mcp) and a Markdown version of its pages.",
          ],
        },
      ],
    },
    {
      id: "who-runs-it",
      title: "Who runs it",
      blocks: [
        {
          type: "p",
          text: `${site.name} is an independent project by the GitHub user [${site.maintainer.login}](${site.maintainer.url}). It is not affiliated with, sponsored by or endorsed by GitHub.`,
        },
        {
          type: "p",
          text: "To get in touch, see the [contact page](/contact).",
        },
      ],
    },
    {
      id: "data",
      title: "Where the data comes from",
      blocks: [
        {
          type: "p",
          text: `Everything on a banner comes from GitHub's public API: profiles, public repositories, the public contribution calendar. Nothing private is read. The data is refreshed every ${FACTS.dataRefreshMinutes} minutes, and when GitHub cannot be reached the last good copy is used for up to ${FACTS.lastGoodDays} days, so an embedded banner does not break.`,
        },
        {
          type: "p",
          text: "The [privacy page](/privacy) says what is stored when you sign in, and what is not.",
        },
      ],
    },
    {
      id: "how-it-is-built",
      title: "How it is built",
      blocks: [
        {
          type: "list",
          items: [
            "The site and the image renderer run on Vercel, with functions in Washington, D.C.",
            "Accounts, saved banners and rate limits are kept in an Upstash Redis database in the US East region.",
            "Banners are drawn on the server and cached at the edge, so a page that embeds one does not wait for GitHub.",
          ],
        },
      ],
    },
    {
      id: "credits",
      title: "Credits and licenses",
      blocks: [
        {
          type: "list",
          items: [
            "Banner text is set in Mona Sans, GitHub's typeface, used under the SIL Open Font License 1.1.",
            "Banner icons are Octicons, used under the MIT license.",
            "Emoji are drawn with Twemoji artwork, licensed under CC BY 4.0.",
            "GitHub is a trademark of GitHub, Inc. It is named here only to say what the banners show.",
          ],
        },
      ],
    },
  ],
};
