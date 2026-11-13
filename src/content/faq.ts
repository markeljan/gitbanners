import { proRepoLink } from "@/lib/pro/repo";
import { site } from "@/lib/site";
import type { FaqEntry } from "./types";

const host = new URL(site.url).host;
/** The repository the server checks for Pro. */
const proRepo = proRepoLink();

/** Heading of the FAQ section, in HTML and in Markdown. */
export const FAQ_HEADING = "Frequently asked questions";

/** Shown on the homepage and emitted as FAQPage structured data. */
export const FAQ: readonly FaqEntry[] = [
  {
    id: "what-is-gitbanners",
    question: "What is GitBanners?",
    answer:
      "A free tool that turns a GitHub username, repository or organization into a banner image: contribution graph, stats, top repositories, contributors. Each banner has a URL, so the image updates when the GitHub activity does.",
  },
  {
    id: "add-to-readme",
    question: "How do I add a banner to my GitHub README?",
    answer: `Copy the Markdown under any banner and paste it into your README, for example \`[![GitHub banner](https://${host}/you.svg)](https://${host}/you)\`. For a profile README, the file lives in a repository named after your username.`,
  },
  {
    id: "update-frequency",
    question: "How often do banners update?",
    answer:
      "GitHub data is refreshed every 15 minutes, and the image cache GitHub puts in front of READMEs follows that timing. Headers on X and LinkedIn are uploads, so download a fresh PNG when you want to update them.",
  },
  {
    id: "sign-in",
    question: "Do I need to sign in?",
    answer:
      "No. Anything public works with just a name. Sign in with GitHub to save banners, and star the repository to unlock Pro. Signing in asks GitHub for no permissions beyond your public profile.",
  },
  {
    id: "private-contributions",
    question: "Can a banner include my private contributions?",
    answer:
      'Yes, as counts only. Turn on "Private contributions" in your GitHub profile settings and GitHub includes them in your graph, so your banner shows them too. Names of private repositories never appear on a banner.',
  },
  {
    id: "sizes-and-formats",
    question: "Which sizes and formats are there?",
    answer:
      "SVG and PNG. Presets for README (846 px wide), X header (1500 by 500), LinkedIn banner (1584 by 396), link preview (1200 by 630), GitHub social preview (1280 by 640) and square (1080 by 1080), or any custom size.",
  },
  {
    id: "pro",
    question: "What does Pro add, and what does it cost?",
    answer: `Pro removes the GitBanners mark from saved banners, adds animated SVG, 50 saved banners instead of 3, your own default banner at your profile URL, and redraws saved banners at the edge more often (the GitHub data itself refreshes on the same schedule for everyone). It costs one star: sign in with GitHub and star the [${proRepo.slug}](${proRepo.url}) repository.`,
  },
  {
    id: "readme-stats-alternative",
    question:
      "My github-readme-stats card stopped loading. Can I use GitBanners instead?",
    answer:
      "Yes. Cards that point at a paused or rate-limited server show a broken image. Swap the image URL for a GitBanners one, or paste your README into the [README doctor](/docs/migrate) and copy the fixed version.",
  },
  {
    id: "ai-agents",
    question: "Can AI agents use GitBanners?",
    answer:
      "Yes. Content pages and banner pages have a Markdown version (add `.md` or send `Accept: text/markdown`), there is a keyless JSON API described by [OpenAPI](/openapi.json), an [MCP server](/docs#mcp) with read-only tools, and an [llms.txt](/llms.txt) index.",
  },
];
