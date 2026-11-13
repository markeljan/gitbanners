/**
 * The banner variations worth showing off: the homepage rows, the gallery
 * and the examples in llms.txt all come from this list.
 *
 * `path` is a relative banner URL without extension (see `Block` "banner").
 */
export interface ShowcaseItem {
  id: string;
  group: "profile" | "repository" | "organization";
  title: string;
  /** One line on what it shows and when to use it. */
  blurb: string;
  path: string;
  alt: string;
  /** Layout hint: wide social canvases get a full row. */
  shape: "card" | "wide" | "poster";
}

export const SHOWCASE: readonly ShowcaseItem[] = [
  {
    id: "profile-overview",
    group: "profile",
    title: "Profile overview",
    blurb: "Identity, headline numbers and the contribution graph.",
    path: "/torvalds",
    alt: "GitHub banner for torvalds with stats and contribution graph",
    shape: "card",
  },
  {
    id: "profile-activity",
    group: "profile",
    title: "Activity only",
    blurb: "Just the contribution graph: the quietest README banner.",
    path: "/markeljan/activity",
    alt: "Contribution graph banner for markeljan",
    shape: "card",
  },
  {
    id: "profile-repos",
    group: "profile",
    title: "Top repositories and activity",
    blurb: "Pinned and most-starred repositories above the graph.",
    path: "/sindresorhus/repos",
    alt: "Top repositories banner for sindresorhus",
    shape: "card",
  },
  {
    id: "profile-stats",
    group: "profile",
    title: "Stats card",
    blurb: "Commits, pull requests, issues and stars in any theme.",
    path: "/gaearon/stats?theme=dracula",
    alt: "GitHub stats card for gaearon in the Dracula theme",
    shape: "card",
  },
  {
    id: "profile-streak",
    group: "profile",
    title: "Streak",
    blurb: "Current and longest contribution streak.",
    path: "/shadcn/streak?theme=tokyo-night",
    alt: "Contribution streak banner for shadcn in the Tokyo Night theme",
    shape: "card",
  },
  {
    id: "profile-languages",
    group: "profile",
    title: "Languages",
    blurb: "Language mix across top repositories.",
    path: "/antfu/languages?theme=catppuccin-mocha",
    alt: "Languages banner for antfu in the Catppuccin Mocha theme",
    shape: "card",
  },
  {
    id: "profile-x-header",
    group: "profile",
    title: "X header",
    blurb: "1500 by 500, with the photo area kept clear.",
    path: "/torvalds?size=x",
    alt: "X header banner for torvalds",
    shape: "wide",
  },
  {
    id: "profile-wrapped",
    group: "profile",
    title: "Year in review",
    blurb: "A poster of one calendar year, made for sharing.",
    path: "/torvalds/wrapped?year=2025",
    alt: "2025 year in review for torvalds",
    shape: "poster",
  },
  {
    id: "repo-overview",
    group: "repository",
    title: "Repository overview",
    blurb: "Description, stars, forks and the language bar.",
    path: "/vercel/next.js",
    alt: "Repository banner for vercel/next.js",
    shape: "card",
  },
  {
    id: "repo-activity",
    group: "repository",
    title: "Repository activity",
    blurb: "A year of weekly commits.",
    path: "/vercel/next.js/activity",
    alt: "Commit activity banner for vercel/next.js",
    shape: "card",
  },
  {
    id: "repo-contributors",
    group: "repository",
    title: "Contributors",
    blurb: "The people behind a project, with avatars.",
    path: "/react/react/contributors",
    alt: "Contributors banner for react/react",
    shape: "card",
  },
  {
    id: "repo-social",
    group: "repository",
    title: "Social preview",
    blurb: "1280 by 640, ready to upload as the repository's social preview.",
    path: "/vercel/satori/social",
    alt: "Social preview image for vercel/satori",
    shape: "wide",
  },
  {
    id: "org-overview",
    group: "organization",
    title: "Organization overview",
    blurb: "Members, repositories and stars of a whole organization.",
    path: "/vercel",
    alt: "Organization banner for vercel",
    shape: "card",
  },
  {
    id: "org-repos",
    group: "organization",
    title: "Organization repositories",
    blurb: "The most-starred repositories of an organization, light theme.",
    path: "/microsoft/repos?theme=github-light",
    alt: "Top repositories banner for microsoft in the light theme",
    shape: "card",
  },
];

export function showcaseGroup(
  group: ShowcaseItem["group"],
): readonly ShowcaseItem[] {
  return SHOWCASE.filter((item) => item.group === group);
}
