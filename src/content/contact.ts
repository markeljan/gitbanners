import { site } from "@/lib/site";
import type { Block, ContentPage } from "./types";

const { maintainer } = site;

const reach: Block[] = site.contactEmail
  ? [
      {
        type: "p",
        text: `Write to [${site.contactEmail}](mailto:${site.contactEmail}). The maintainer is also on GitHub as [${maintainer.login}](${maintainer.url}).`,
      },
    ]
  : [
      {
        type: "p",
        text: `${site.name} has no support inbox. The way to reach the maintainer is through GitHub: [${maintainer.login}](${maintainer.url}). The profile lists the current ways to get in touch.`,
      },
    ];

const location: Block[] = site.address
  ? [
      {
        type: "p",
        text: `The project is based in ${[
          site.address.locality,
          site.address.region,
          site.address.country,
        ]
          .filter(Boolean)
          .join(", ")}.`,
      },
    ]
  : [];

export const contact: ContentPage = {
  path: "/contact",
  title: `Contact ${site.name}`,
  description: `How to reach the maintainer of ${site.name}, what to include in a report, and what you can do yourself without waiting for an answer.`,
  updated: "2026-11-13",
  heading: "Contact",
  lead: `${site.name} is an independent project with one maintainer. There is no support team and no guaranteed response time, so this page also says what you can sort out yourself.`,
  sections: [
    {
      id: "reach",
      title: "How to reach the maintainer",
      blocks: [...reach, ...location],
    },
    {
      id: "what-to-include",
      title: "What to include",
      blocks: [
        {
          type: "list",
          items: [
            "A banner that draws wrong: the full image URL, and what you expected to see.",
            "A problem with the API or the MCP server: the request, and the `code` and `detail` of the answer.",
            "A sign-in problem: the `auth_error` value in the address bar after the failed attempt.",
            "A security problem: please contact the maintainer before publishing any details.",
          ],
        },
      ],
    },
    {
      id: "self-service",
      title: "What you can do yourself",
      blocks: [
        {
          type: "list",
          items: [
            "A banner shows only what GitHub shows publicly. To change what it says, change it on GitHub; the banner follows within the hour.",
            "To delete your account and every saved banner, use the dashboard. It takes effect at once. The [privacy page](/privacy#retention) has the details.",
            "If Pro did not unlock after you starred the repository, sign in once more: the star is checked at sign-in.",
            "For how URLs, parameters and limits work, see the [docs](/docs).",
          ],
        },
      ],
    },
    {
      id: "not-github",
      title: "This is not GitHub",
      blocks: [
        {
          type: "p",
          text: `${site.name} is not affiliated with GitHub and cannot help with a GitHub account, repository or bill. For that, use GitHub's own support.`,
        },
      ],
    },
  ],
};
