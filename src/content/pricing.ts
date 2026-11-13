import { PRESETS, SIZES, THEMES } from "@/lib/banner";
import { FREE, PRO } from "@/lib/pro/entitlements";
import { proRepoLink } from "@/lib/pro/repo";
import { site } from "@/lib/site";
import { edgeRefreshText, FACTS, quota } from "./facts";
import { duration } from "./format";
import type {
  Block,
  ContentPage,
  FaqEntry,
  Plan,
  Section,
  Step,
} from "./types";

const sizeCount = Object.keys(SIZES).length;
/** The repository the server checks for Pro, the one every step names. */
const proRepo = proRepoLink();
const repo = `[${proRepo.slug}](${proRepo.url})`;

/**
 * The two plans, as the pricing page shows them side by side. Every line is
 * something the image routes or the account API enforce (see
 * `src/lib/pro/entitlements.ts` and the saved banner route).
 */
export const PLANS: readonly Plan[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    summary: "Every public banner, with no account.",
    features: [
      `A live banner for any public GitHub user, organization or repository, as SVG or PNG.`,
      `All ${PRESETS.length} presets, ${sizeCount} sizes and ${THEMES.length} themes, plus your own colours, in the URL.`,
      "Embed snippets for READMEs, and PNG downloads sized for X, LinkedIn, link previews and GitHub's social preview.",
      `The JSON API and the MCP server, no key: ${quota("api")}.`,
      `Sign in with GitHub to keep up to ${FREE.maxSavedBanners} saved banners, each with a stable link.`,
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "One GitHub star",
    summary: `Star ${proRepo.slug} while signed in.`,
    features: [
      "Everything in Free.",
      `Save up to ${PRO.maxSavedBanners} banners instead of ${FREE.maxSavedBanners}.`,
      `Hide the small ${site.name} mark on your saved banners.`,
      "Animate the contribution graph of a saved SVG banner.",
      "Choose which saved banner is served at your own profile URL, such as `/your-login.svg`.",
      edgeRefreshText(),
    ],
  },
];

/** How to unlock Pro, in order. */
export const PRO_STEPS: readonly Step[] = [
  {
    title: "Sign in with GitHub",
    text: "Use the button on this page. GitHub asks for no permissions beyond your public profile.",
  },
  {
    title: `Star ${proRepo.slug}`,
    text: `Open ${repo} on GitHub and press Star. It takes one click and costs nothing.`,
  },
  {
    title: "Come back and press Check again",
    text: `Pro starts as soon as the star is seen. **Check again** looks at once; otherwise it is noticed within ${duration(FACTS.freeRecheckSeconds)} of your next visit.`,
  },
];

/** Questions about price and plans. The site-wide FAQ is on the homepage. */
export const PRICING_FAQ: readonly FaqEntry[] = [
  {
    id: "really-free",
    question: "Is it really free?",
    answer: `Yes. Banners, the API and the MCP server cost nothing and need no account. Pro costs one star on the repository, and nothing on this site can be bought: no payment details are ever asked for.`,
  },
  {
    id: "remove-star",
    question: "What happens if I remove the star?",
    answer: `Pro is checked again every ${FACTS.proRecheckHours} hours. Once the star is gone the account is Free again: your saved banners and their links stay, the mark comes back on them, animation stops, and your profile URL shows the default banner again. To save new banners you then need fewer than ${FREE.maxSavedBanners}.`,
  },
  {
    id: "permissions",
    question: "Do I need to grant any permissions?",
    answer:
      "No. Sign in with GitHub asks for no scopes, so GitHub shows it as access to your public data only. The sign-in is used once, to read who you are and whether you starred the repository, and is not kept.",
  },
  {
    id: "private-data",
    question: "What about private data?",
    answer: `Banners are drawn from public GitHub data only, on Free and on Pro. Private repositories are never read or named. If you turned on "Private contributions" in your GitHub profile, GitHub counts them in your public calendar and a banner shows them as numbers. The [privacy page](/privacy) lists what an account stores.`,
  },
  {
    id: "teams",
    question: "Can a team use it?",
    answer: `Yes. Organization and repository banners are free for anyone, with no account, so a team can embed them right away. Pro belongs to one person: everyone who wants their own saved banners signs in and stars the repository. There is no shared team account.`,
  },
];

function stepsBlock(): Block {
  return {
    type: "list",
    ordered: true,
    items: PRO_STEPS.map((step) => `**${step.title}.** ${step.text}`),
  };
}

function faqSections(): Section[] {
  return [
    {
      id: "questions",
      title: "Questions about pricing",
      blocks: [],
    },
    ...PRICING_FAQ.map(
      (entry): Section => ({
        id: entry.id,
        title: entry.question,
        level: 3,
        blocks: [{ type: "p", text: entry.answer }],
      }),
    ),
  ];
}

/** The comparison table: one row per difference, Free next to Pro. */
export const COMPARISON: Extract<Block, { type: "table" }> = {
  type: "table",
  head: ["", "Free", "Pro"],
  rows: [
    ["Price", "$0", "One GitHub star"],
    [
      "Account",
      "None needed for banners. Sign in with GitHub to save them.",
      `Sign in with GitHub and star ${repo}`,
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
    [
      "Refresh of the GitHub data behind a banner",
      `Every ${FACTS.dataRefreshMinutes} minutes`,
      `Every ${FACTS.dataRefreshMinutes} minutes`,
    ],
  ],
};

const [free, pro] = PLANS;

export const pricing: ContentPage = {
  path: "/pricing",
  title: "Pricing",
  description: `${site.name} is free for public GitHub data. Pro costs one star on the repository: ${PRO.maxSavedBanners} saved banners, no brand mark, animated SVG, a shorter edge cache.`,
  updated: "2026-11-13",
  heading: "Pricing",
  lead: `Every banner, preset, size and theme is free and needs no account. Pro is not for sale: it costs one star on the ${site.name} repository.`,
  sections: [
    { id: "plans", title: "Compare plans", blocks: [COMPARISON] },
    {
      id: "free",
      title: "Free",
      blocks: [
        { type: "p", text: `**${free?.price}.** ${free?.summary}` },
        { type: "list", items: free?.features ?? [] },
      ],
    },
    {
      id: "pro",
      title: "Pro",
      blocks: [
        { type: "p", text: `**${pro?.price}.** ${pro?.summary}` },
        { type: "list", items: pro?.features ?? [] },
      ],
    },
    {
      id: "unlock-pro",
      title: "How to unlock Pro",
      blocks: [stepsBlock()],
    },
    ...faqSections(),
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
