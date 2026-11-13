"use no memo";

import type { BannerSize, SizeId } from "@/lib/banner/types";

/**
 * Canvas sizes, in the shape of the BannerSize contract.
 * Every number is traced in SIZE_FACTS below.
 */
export const SIZES: Record<SizeId, BannerSize> = {
  readme: {
    id: "readme",
    name: "README",
    description: "Fits the GitHub README column. Height follows the content.",
    width: 846,
    height: null,
    safeZone: null,
  },
  x: {
    id: "x",
    name: "X header",
    description: "Profile header on X. Also fits Bluesky and Mastodon.",
    width: 1500,
    height: 500,
    safeZone: {
      x: 0,
      y: 300,
      width: 430,
      height: 200,
      label: "Profile photo",
    },
  },
  linkedin: {
    id: "linkedin",
    name: "LinkedIn banner",
    description: "Background image of a personal LinkedIn profile.",
    width: 1584,
    height: 396,
    safeZone: {
      x: 0,
      y: 170,
      width: 420,
      height: 226,
      label: "Profile photo",
    },
  },
  og: {
    id: "og",
    name: "Link preview",
    description: "Open Graph image for link previews in chats and feeds.",
    width: 1200,
    height: 630,
    safeZone: null,
  },
  social: {
    id: "social",
    name: "GitHub social preview",
    description: "Repository social preview. Upload it in the repo settings.",
    width: 1280,
    height: 640,
    safeZone: null,
  },
  square: {
    id: "square",
    name: "Square",
    description: "Square post for feeds.",
    width: 1080,
    height: 1080,
    safeZone: null,
  },
};

export const DEFAULT_SIZE_ID: SizeId = "readme";

/** Facts behind each size that the BannerSize contract has no field for. */
export interface SizeFacts {
  /** Padding that survives cropping on every client we measured: top, right, bottom, left. */
  inset: readonly [number, number, number, number];
  /** Upload limit of the destination in bytes, when it has one. */
  maxBytes: number | null;
  /** Formats the destination accepts as an upload. Empty when the image is embedded by URL. */
  upload: readonly ("png" | "jpeg" | "gif")[];
  source: string;
}

export const SIZE_FACTS: Record<SizeId, SizeFacts> = {
  readme: {
    inset: [24, 24, 24, 24],
    maxBytes: null,
    upload: [],
    source:
      "github.com DOM, measured 2026-11-12 at 1440px: README column 846px (profile, org), 838px (repo home), 1012px (file view); 293px / 309px on a 375px phone.",
  },
  x: {
    inset: [60, 48, 60, 48],
    maxBytes: null,
    upload: ["png", "jpeg"],
    source:
      "help.x.com: 1500x500 recommended, 60px top and bottom may be cropped. x.com DOM measured 2026-11-12: photo covers x35-400 y312-500 (desktop) and x56-415 y335-500 (375px).",
  },
  linkedin: {
    inset: [40, 48, 40, 48],
    maxBytes: 8_000_000,
    upload: ["png", "jpeg"],
    source:
      "linkedin.com/help a568217: 1584x396, JPG or PNG, under 8MB. Photo zone from a third-party measurement (x56-360 y212-396, 2026-10-08), not verified by us.",
  },
  og: {
    inset: [40, 56, 40, 56],
    maxBytes: 5_000_000,
    upload: ["png", "jpeg"],
    source:
      "developers.facebook.com sharing images: at least 1200x630, about 1.91:1, 8MB. LinkedIn link posts: 1200x627. 5MB is the X card limit (not re-verified).",
  },
  social: {
    inset: [40, 64, 40, 64],
    maxBytes: 1_000_000,
    upload: ["png", "jpeg", "gif"],
    source:
      "docs.github.com social media preview: PNG, JPG or GIF under 1MB, at least 640x320, 1280x640 for best display. No API can set it (GraphQL introspection, 2026-11-12).",
  },
  square: {
    inset: [64, 64, 64, 64],
    maxBytes: null,
    upload: ["png", "jpeg"],
    source: "Convention for feed posts, not an official spec.",
  },
};

/** Sizes worth adding next. Not part of the SizeId contract yet. */
export interface ProposedSize {
  id: string;
  name: string;
  width: number;
  height: number;
  safeZone: BannerSize["safeZone"];
  inset: readonly [number, number, number, number];
  maxBytes: number | null;
  source: string;
}

export const PROPOSED_SIZES: readonly ProposedSize[] = [
  {
    id: "card",
    name: "README card",
    width: 495,
    height: 195,
    safeZone: null,
    inset: [20, 24, 20, 24],
    maxBytes: null,
    source:
      "De-facto stat card size: github-readme-streak-stats defaults card_width=495, card_height=195.",
  },
  {
    id: "bluesky",
    name: "Bluesky banner",
    width: 1500,
    height: 500,
    safeZone: { x: 0, y: 320, width: 480, height: 180, label: "Avatar" },
    inset: [63, 125, 63, 125],
    maxBytes: 1_000_000,
    source:
      "atproto lexicon app.bsky.actor.profile: png or jpeg, maxSize 1000000. The official app crops to 3:1 and caps the long side at 2000px. bsky.app DOM measured 2026-11-12: the banner box is always 150px tall (4:1 on desktop, 2.5:1 at 375px), avatar 90px at left 12px.",
  },
  {
    id: "linkedin-page",
    name: "LinkedIn page cover",
    width: 1512,
    height: 256,
    safeZone: { x: 0, y: 110, width: 340, height: 146, label: "Logo" },
    inset: [28, 48, 28, 48],
    maxBytes: 3_000_000,
    source:
      "linkedin.com/help a563309: 1512x256 minimum and recommended, PNG or JPEG, 3MB. Logo zone from a third-party measurement (x45-286 y134-256).",
  },
  {
    id: "youtube",
    name: "YouTube banner",
    width: 2560,
    height: 1440,
    safeZone: null,
    inset: [509, 507, 508, 507],
    maxBytes: 6_000_000,
    source:
      "support.google.com/youtube/answer/10456525: minimum 2048x1152 at 16:9, safe area 1235x338 at that size (1546x423 here), 6MB.",
  },
  {
    id: "devto",
    name: "DEV cover",
    width: 1000,
    height: 420,
    safeZone: null,
    inset: [32, 48, 32, 48],
    maxBytes: null,
    source:
      "dev.to/p/editor_guide: cover_image accepts a URL, best size is 1000 x 420.",
  },
  {
    id: "story",
    name: "Story",
    width: 1080,
    height: 1920,
    safeZone: null,
    inset: [250, 64, 250, 64],
    maxBytes: null,
    source: "Convention for 9:16 stories, not an official spec.",
  },
];

/** GitHub's contribution calendar: 10px cells, 3px gaps, 2px radius, 53 week columns by 7 day rows. */
export const GITHUB_HEATMAP = {
  cell: 10,
  gap: 3,
  radius: 2,
  cols: 53,
  rows: 7,
} as const;

/** A heatmap grid sized to a box: cell metrics plus the pixels it occupies. */
export interface HeatmapFit {
  cell: number;
  gap: number;
  radius: number;
  width: number;
  height: number;
}

/**
 * Corner radius for a cell, in whole pixels: GitHub's 0.2 of the cell edge
 * (2 px on its own 10 px cells), at least 1 px so small cells keep the soft
 * look. A cell of 2 px is drawn square: a 1 px radius would make it a dot,
 * which is not the shape the SVG animation looks for either.
 */
export function cellRadius(cell: number): number {
  return cell < 3 ? 0 : Math.max(1, Math.round(cell * 0.2));
}

/** Largest GitHub-proportioned heatmap (gap 0.3 cell, radius 0.2 cell) that fits the box. */
export function fitHeatmap(
  maxWidth: number,
  maxHeight: number,
  cols: number = GITHUB_HEATMAP.cols,
  rows: number = GITHUB_HEATMAP.rows,
): HeatmapFit {
  const byWidth = maxWidth / (cols + (cols - 1) * 0.3);
  const byHeight = maxHeight / (rows + (rows - 1) * 0.3);
  const smallest = Math.min(byWidth, byHeight);
  // Gaps are whole pixels: one rounded down leaves room for a cell a pixel
  // larger than the exact proportion allows (14 px cells with 4 px gaps are
  // 950 px wide, where 13.85 px cells with 4.15 px gaps would be). Start one
  // above the estimate, so a box of exactly a heatmap's size gets that
  // heatmap back, and step down until it fits.
  let cell = Number.isFinite(smallest)
    ? Math.max(2, Math.floor(smallest) + 1)
    : 2;
  let gap = Math.max(1, Math.round(cell * 0.3));
  while (
    cell > 2 &&
    (cols * cell + (cols - 1) * gap > maxWidth ||
      rows * cell + (rows - 1) * gap > maxHeight)
  ) {
    cell -= 1;
    gap = Math.max(1, Math.round(cell * 0.3));
  }
  return {
    cell,
    gap,
    radius: cellRadius(cell),
    width: cols * cell + (cols - 1) * gap,
    height: rows * cell + (rows - 1) * gap,
  };
}
