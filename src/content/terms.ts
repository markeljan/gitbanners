import { proRepoLink } from "@/lib/pro/repo";
import { site } from "@/lib/site";
import { FACTS, quota } from "./facts";
import type { ContentPage } from "./types";

/** The repository the server checks for Pro. */
const proRepo = proRepoLink();

export const terms: ContentPage = {
  path: "/terms",
  title: "Terms of use",
  description: `The terms for using ${site.name}: what you may do with banners and the API, the rate limits, accounts and Pro, and what is not promised.`,
  updated: "2026-11-13",
  heading: "Terms of use",
  lead: `${site.name} is a free service for making banner images from public GitHub data. By using the site, its images, the API or the MCP server you agree to the terms below.`,
  sections: [
    {
      id: "what-you-may-do",
      title: "What you may do",
      blocks: [
        {
          type: "list",
          items: [
            "Make banners of public GitHub users, organizations and repositories, and embed or upload them wherever images are allowed: READMEs, websites, profiles, social media.",
            "Call the JSON API and the MCP server from your own software, including automated agents, within the rate limits.",
          ],
        },
      ],
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      blocks: [
        { type: "p", text: "In return, do not:" },
        {
          type: "list",
          items: [
            "Work around the rate limits, for example by spreading requests over many addresses.",
            "Use the service to harass someone, or to pass a banner off as a statement by the account it shows.",
            `Present ${site.name} or its banners as a product of GitHub.`,
            "Probe, overload or attack the service, or try to reach data that is not public.",
          ],
        },
        {
          type: "p",
          text: "Access can be limited or removed for use that harms the service or other people.",
        },
      ],
    },
    {
      id: "rate-limits",
      title: "Rate limits",
      blocks: [
        {
          type: "p",
          text: `The API and the MCP server allow ${quota("api")} per client, and search ${quota("search")}. Banner images are cached instead of limited. The limits can change; the current values are in the [docs](/docs#rate-limits) and in the headers of every API answer.`,
        },
      ],
    },
    {
      id: "accounts",
      title: "Accounts and Pro",
      blocks: [
        {
          type: "list",
          items: [
            "Signing in uses your GitHub account. You are responsible for what is done with it here.",
            `Pro is unlocked by starring the [${proRepo.slug}](${proRepo.url}) repository and lasts as long as the star does. It is not sold, and it carries no guarantee of service.`,
            "You can delete your account at any time from the dashboard. The [privacy page](/privacy) says what is stored and for how long.",
          ],
        },
      ],
    },
    {
      id: "github-data",
      title: "GitHub data",
      blocks: [
        {
          type: "p",
          text: "Banners are drawn from public data published on GitHub. That data belongs to the people and projects it describes, and it can be out of date or incomplete: a banner is a picture of what GitHub reported, not a certified record.",
        },
      ],
    },
    {
      id: "availability",
      title: "Availability and changes",
      blocks: [
        {
          type: "list",
          items: [
            "The service is offered without an uptime guarantee. It depends on GitHub and on its hosting provider, and either can fail.",
            `Features, limits and these terms can change. Breaking changes to the API follow the [versioning policy](/docs#versioning-and-deprecation), with at least ${FACTS.deprecationNoticeDays} days of notice.`,
            "The service can be discontinued. If that happens, embedded banners will stop loading.",
          ],
        },
      ],
    },
    {
      id: "no-warranty",
      title: "No warranty",
      blocks: [
        {
          type: "p",
          text: `${site.name} is provided as is, without warranty of any kind. As far as the law allows, the maintainer is not liable for any damage that results from using it or from not being able to use it.`,
        },
      ],
    },
    {
      id: "trademarks",
      title: "Trademarks and licenses",
      blocks: [
        {
          type: "list",
          items: [
            `GitHub is a trademark of GitHub, Inc. ${site.name} is an independent project and is not affiliated with, sponsored by or endorsed by GitHub.`,
            "Mona Sans is used under the SIL Open Font License 1.1, Octicons under the MIT license, and Twemoji artwork under CC BY 4.0.",
            "Theme names such as Dracula, Nord or Catppuccin refer to the colour schemes of those projects and belong to their authors.",
          ],
        },
      ],
    },
    {
      id: "contact",
      title: "Contact",
      blocks: [
        {
          type: "p",
          text: `${site.name} is run by the GitHub user [${site.maintainer.login}](${site.maintainer.url}). The [contact page](/contact) says how to get in touch.`,
        },
      ],
    },
  ],
};
