/**
 * Documentation of the banner query parameters, one entry per key of
 * `QUERY_KEYS`. Shared by the docs page, `/openapi.json`, the options
 * catalog and the MCP tool descriptions so they cannot drift apart.
 */
import { OPTION_LIMITS, QUERY_KEYS, type QueryKey } from "@/lib/banner";

export interface ParameterDoc {
  name: QueryKey;
  /** Human-readable type, e.g. "hex colour". */
  type: string;
  description: string;
  example: string;
  /** Only honoured on saved Pro banners. */
  pro: boolean;
}

const HEX = "hex colour without #";

const DOCS: Record<QueryKey, Omit<ParameterDoc, "name">> = {
  size: {
    type: "readme | x | linkedin | og | social | square",
    description:
      "Canvas. `readme` is 846 px wide with automatic height; the others are fixed social sizes.",
    example: "og",
    pro: false,
  },
  width: {
    type: `integer ${OPTION_LIMITS.width.min}-${OPTION_LIMITS.width.max}`,
    description: "Custom canvas width in pixels. Overrides `size`.",
    example: "495",
    pro: false,
  },
  height: {
    type: `integer ${OPTION_LIMITS.height.min}-${OPTION_LIMITS.height.max}`,
    description:
      "Custom canvas height in pixels. Without it a custom width gets an automatic height.",
    example: "195",
    pro: false,
  },
  theme: {
    type: "theme id",
    description:
      "Colour theme. Default `github-dark`. See /themes for all of them.",
    example: "dracula",
    pro: false,
  },
  bg: {
    type: HEX,
    description: "Background colour, on top of the theme.",
    example: "0d1117",
    pro: false,
  },
  surface: {
    type: HEX,
    description: "Colour of cards and tiles inside the banner.",
    example: "151b23",
    pro: false,
  },
  border_color: {
    type: HEX,
    description: "Colour of outlines and hairlines.",
    example: "3d444d",
    pro: false,
  },
  text: {
    type: HEX,
    description: "Primary text colour.",
    example: "f0f6fc",
    pro: false,
  },
  muted: {
    type: HEX,
    description: "Secondary text and icon colour.",
    example: "9198a1",
    pro: false,
  },
  accent: {
    type: HEX,
    description: "Accent colour for links, highlights and charts.",
    example: "4493f8",
    pro: false,
  },
  heat: {
    type: `${HEX}, one or five separated by commas`,
    description:
      "Contribution graph colours. One colour is turned into a five-step ramp; five are used as given, from empty to busiest.",
    example: "a855f7",
    pro: false,
  },
  font: {
    type: "mona | mono",
    description: "Typeface: Mona Sans (default) or Mona Sans Mono.",
    example: "mono",
    pro: false,
  },
  radius: {
    type: `integer ${OPTION_LIMITS.radius.min}-${OPTION_LIMITS.radius.max}`,
    description: "Outer corner radius in pixels.",
    example: "0",
    pro: false,
  },
  border: {
    type: "0 | 1",
    description: "Draw the outer 1 px border.",
    example: "0",
    pro: false,
  },
  title: {
    type: `text, at most ${OPTION_LIMITS.title} characters`,
    description: "Custom headline replacing the default title.",
    example: "Open source work",
    pro: false,
  },
  year: {
    type: `integer from ${OPTION_LIMITS.year.min}`,
    description:
      "Calendar year for profile banners. Default: the last 12 months.",
    example: "2025",
    pro: false,
  },
  stats: {
    type: "comma-separated stat ids",
    description:
      "Which numbers to show, in order, e.g. contributions, commits, pullRequests, stars, followers.",
    example: "contributions,stars,followers",
    pro: false,
  },
  show: {
    type: "comma-separated section ids",
    description:
      "Explicit sections in render order, replacing the preset's own: header, stats, heatmap, streak, repos, languages, orgs, people, activity, contributors.",
    example: "header,heatmap,languages",
    pro: false,
  },
  hide: {
    type: "comma-separated element ids",
    description:
      "Elements to leave out: avatar, bio, meta, title, legend, labels, topics, description.",
    example: "bio,legend",
    pro: false,
  },
  count: {
    type: `integer ${OPTION_LIMITS.count.min}-${OPTION_LIMITS.count.max}`,
    description: "How many repositories, contributors or people to show.",
    example: "4",
    pro: false,
  },
  brand: {
    type: "0 | 1",
    description: "Show the small site mark. Turning it off needs Pro.",
    example: "0",
    pro: true,
  },
  animate: {
    type: "0 | 1",
    description:
      "Animate the contribution graph (SVG only). Needs a saved Pro banner.",
    example: "1",
    pro: true,
  },
};

export const PARAMETER_DOCS: readonly ParameterDoc[] = QUERY_KEYS.map(
  (name) => ({ name, ...DOCS[name] }),
);
