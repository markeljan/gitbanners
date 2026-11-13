import { PRESETS, SIZES, THEMES } from "@/lib/banner";
import { FREE, PRO } from "@/lib/pro/entitlements";
import { site } from "@/lib/site";
import { quota } from "./facts";
import { duration } from "./format";
import type { ContentPage } from "./types";

const sizeCount = Object.keys(SIZES).length;

export const pricing: ContentPage = {
  path: "/pricing",
  title: "Pricing",
  description: `${site.name} is free for public GitHub data. Pro costs one star on the repository: ${PRO.maxSavedBanners} saved banners, no brand mark, animated SVG, faster refresh.`,
  updated: "2026-11-13",
  heading: "Pricing",
  lead: `Every banner, preset, size and theme is free and needs no account. Pro is not for sale: it costs one star on the ${site.name} repository.`,
  sections: [
    {
      id: "plans",
      title: "Plans",
      blocks: [
        {
          type: "table",
          head: ["", "Free", "Pro"],
          rows: [
            ["Price", "$0", "One GitHub star"],
            [
              "Account",
              "None needed for banners. Sign in with GitHub to save them.",
              `Sign in with GitHub and star [${site.repo.slug}](${site.repo.url})`,
            ],
            [
              `Live banners: all ${PRESETS.length} presets, ${sizeCount} sizes and ${THEMES.length} themes`,
              "Yes",
              "Yes",
            ],
            ["SVG and PNG, custom colours and sizes", "Yes", "Yes"],
            ["JSON API and MCP server, no key", "Yes", "Yes"],
            [
              "Saved banners with stable links",
              String(FREE.maxSavedBanners),
              String(PRO.maxSavedBanners),
            ],
            [`${site.name} mark on saved banners`, "Shown", "Can be hidden"],
            ["Animated contribution graph (SVG)", "No", "Yes"],
            ["Your own default banner at your profile URL", "No", "Yes"],
            [
              "Refresh of saved banners at the edge",
              `Every ${duration(FREE.refreshSeconds)}`,
              `Every ${duration(PRO.refreshSeconds)}`,
            ],
          ],
        },
      ],
    },
    {
      id: "free",
      title: "Free",
      blocks: [
        {
          type: "p",
          text: "Free is the whole product for public data, without a sign-in:",
        },
        {
          type: "list",
          items: [
            "A live banner for any public GitHub user, organization or repository, as SVG or PNG.",
            `Every preset, size and theme, plus your own colours, in the URL. The [docs](/docs#variants-and-themes) list them all.`,
            "Embed snippets for READMEs, and PNG downloads sized for X, LinkedIn, link previews and GitHub's social preview.",
            `The JSON API and the MCP server, with the same limits for everyone: ${quota("api")}, and ${quota("search")} for search.`,
            `Sign in with GitHub to keep up to ${FREE.maxSavedBanners} banners with a stable link each.`,
          ],
        },
      ],
    },
    {
      id: "pro",
      title: "Pro",
      blocks: [
        {
          type: "p",
          text: "Pro adds what matters once a banner is part of your profile. To get it:",
        },
        {
          type: "list",
          ordered: true,
          items: [
            `Star [${site.repo.slug}](${site.repo.url}) on GitHub.`,
            "Sign in with GitHub on this site. If you were already signed in, sign in once more so the star is seen.",
            "Pro is active from that moment. There is nothing to pay and no card to enter.",
          ],
        },
        {
          type: "list",
          items: [
            `Save up to ${PRO.maxSavedBanners} banners instead of ${FREE.maxSavedBanners}.`,
            `Hide the small ${site.name} mark on your saved banners.`,
            "Animate the contribution graph of a saved SVG banner.",
            "Choose which saved banner is served at your own profile URL, such as `/your-login.svg`.",
            `Saved banners refresh every ${duration(PRO.refreshSeconds)} instead of every ${duration(FREE.refreshSeconds)}.`,
          ],
        },
        {
          type: "p",
          text: `Pro lasts as long as the star does, and the star is checked again a few times a day. Without it the account is Free again: your saved banners stay, the mark returns on them and animation stops, and new banners can be saved once fewer than ${FREE.maxSavedBanners} are left.`,
        },
      ],
    },
    {
      id: "paid-plans",
      title: "Paid plans",
      blocks: [
        {
          type: "p",
          text: "There are none. Nothing on this site can be bought, and no payment details are ever asked for.",
        },
      ],
    },
  ],
};
