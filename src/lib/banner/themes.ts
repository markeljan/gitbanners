import type { BannerTheme } from "@/lib/banner/types";

/**
 * Semantic colours that travel with a theme but are not part of the
 * ThemeColors contract (yet). Repo and org banners need them for
 * open / merged / closed states; `link` is for handles and URLs.
 */
export interface ThemeExtras {
  /** Links, @handles, URLs. */
  link: string;
  /** Open / passing / added. */
  success: string;
  /** Attention / pending. */
  warning: string;
  /** Closed / failing / removed. */
  danger: string;
  /** Merged / completed. */
  done: string;
  /** Stroke every heatmap cell with this colour. Only set where heat[0] equals the background. */
  heatBorder?: string;
  family: "github" | "community";
  /** Where the swatches come from. */
  source: string;
}

/**
 * Ordered for the theme picker: GitHub's own themes first, then community themes.
 * `heat` maps 1:1 to ContributionDay.level 0..4.
 */
export const THEMES = [
  {
    id: "github-dark",
    name: "GitHub Dark",
    mode: "dark",
    colors: {
      bg: "#0d1117",
      surface: "#151b23",
      border: "#3d444d",
      text: "#f0f6fc",
      muted: "#9198a1",
      accent: "#4493f8",
      heat: ["#151b23", "#033a16", "#196c2e", "#2ea043", "#56d364"],
    },
  },
  {
    id: "github-light",
    name: "GitHub Light",
    mode: "light",
    colors: {
      bg: "#ffffff",
      surface: "#f6f8fa",
      border: "#d1d9e0",
      text: "#1f2328",
      muted: "#59636e",
      accent: "#0969da",
      heat: ["#eff2f5", "#aceebb", "#4ac26b", "#2da44e", "#116329"],
    },
  },
  {
    id: "github-dark-dimmed",
    name: "GitHub Dark Dimmed",
    mode: "dark",
    colors: {
      bg: "#212830",
      surface: "#262c36",
      border: "#3d444d",
      text: "#d1d7e0",
      muted: "#9198a1",
      accent: "#478be6",
      heat: ["#2a313c", "#1b4721", "#2b6a30", "#46954a", "#6bc46d"],
    },
  },
  // Level 0 equals the background; GitHub outlines every cell with --contribution-default-borderColor-0 (#ffffff).
  {
    id: "github-dark-high-contrast",
    name: "GitHub Dark High Contrast",
    mode: "dark",
    colors: {
      bg: "#010409",
      surface: "#151b23",
      border: "#b7bdc8",
      text: "#ffffff",
      muted: "#b7bdc8",
      accent: "#74b9ff",
      heat: ["#010409", "#007728", "#02a232", "#0ac740", "#4ae168"],
    },
  },
  // Level 0 equals the background; GitHub outlines every cell with --contribution-default-borderColor-0 (#010409).
  {
    id: "github-light-high-contrast",
    name: "GitHub Light High Contrast",
    mode: "light",
    colors: {
      bg: "#ffffff",
      surface: "#e6eaef",
      border: "#454c54",
      text: "#010409",
      muted: "#454c54",
      accent: "#023b95",
      heat: ["#ffffff", "#82e596", "#26a148", "#117f32", "#024c1a"],
    },
  },
  // --contribution-halloween-bgColor-1..4 (dark). Not a monotonic lightness ramp: that is how GitHub ships it.
  {
    id: "github-halloween",
    name: "GitHub Halloween",
    mode: "dark",
    colors: {
      bg: "#0d1117",
      surface: "#151b23",
      border: "#3d444d",
      text: "#f0f6fc",
      muted: "#9198a1",
      accent: "#4493f8",
      heat: ["#151b23", "#fac68f", "#c46212", "#984b10", "#e3d04f"],
    },
  },
  // --contribution-halloween-bgColor-1..4 (light).
  {
    id: "github-halloween-light",
    name: "GitHub Halloween Light",
    mode: "light",
    colors: {
      bg: "#ffffff",
      surface: "#f6f8fa",
      border: "#d1d9e0",
      text: "#1f2328",
      muted: "#59636e",
      accent: "#0969da",
      heat: ["#eff2f5", "#f0db3d", "#ffd642", "#f68c41", "#1f2328"],
    },
  },
  // --contribution-winter-bgColor-1..4 (dark).
  {
    id: "github-winter",
    name: "GitHub Winter",
    mode: "dark",
    colors: {
      bg: "#0d1117",
      surface: "#151b23",
      border: "#3d444d",
      text: "#f0f6fc",
      muted: "#9198a1",
      accent: "#4493f8",
      heat: ["#151b23", "#0c2d6b", "#1158c7", "#58a6ff", "#cae8ff"],
    },
  },
  // --contribution-winter-bgColor-1..4 (light).
  {
    id: "github-winter-light",
    name: "GitHub Winter Light",
    mode: "light",
    colors: {
      bg: "#ffffff",
      surface: "#f6f8fa",
      border: "#d1d9e0",
      text: "#1f2328",
      muted: "#59636e",
      accent: "#0969da",
      heat: ["#eff2f5", "#b6e3ff", "#54aeff", "#0969da", "#0a3069"],
    },
  },
  // Heatmap greens are not in any current official package: treat as legacy/nostalgia palette.
  {
    id: "github-dark-classic",
    name: "GitHub Dark Classic",
    mode: "dark",
    colors: {
      bg: "#0d1117",
      surface: "#151b23",
      border: "#3d444d",
      text: "#f0f6fc",
      muted: "#9198a1",
      accent: "#4493f8",
      heat: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
    },
  },
  // Computed, not published by the theme authors: muted = OKLab mix #6272a4 -> #f8f8f2 until 5:1 on bg; heatmap levels 1-3 = heatRamp(#bd93f9).
  {
    id: "dracula",
    name: "Dracula",
    mode: "dark",
    colors: {
      bg: "#282a36",
      surface: "#343746",
      border: "#44475a",
      text: "#f8f8f2",
      muted: "#8c99bc",
      accent: "#ff79c6",
      heat: ["#343746", "#54446b", "#755c99", "#9874ca", "#bd93f9"],
    },
  },
  // Computed, not published by the theme authors: muted = OKLab mix #737aa2 -> #a9b1d6 until 5:1 on bg; heatmap levels 1-3 = heatRamp(#7aa2f7).
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    mode: "dark",
    colors: {
      bg: "#1a1b26",
      surface: "#24283b",
      border: "#3b4261",
      text: "#c0caf5",
      muted: "#8289b0",
      accent: "#bb9af7",
      heat: ["#292e42", "#364666", "#496193", "#5b7dc4", "#7aa2f7"],
    },
  },
  // Computed, not published by the theme authors: heatmap levels 1-3 = heatRamp(#a6e3a1).
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    mode: "dark",
    colors: {
      bg: "#1e1e2e",
      surface: "#313244",
      border: "#45475a",
      text: "#cdd6f4",
      muted: "#9399b2",
      accent: "#cba6f7",
      heat: ["#313244", "#334931", "#577b54", "#7caf78", "#a6e3a1"],
    },
  },
  // Computed, not published by the theme authors: heatmap levels 1,2,4 = heatRamp(#40a02b).
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    mode: "light",
    colors: {
      bg: "#eff1f5",
      surface: "#e6e9ef",
      border: "#bcc0cc",
      text: "#4c4f69",
      muted: "#5c5f77",
      accent: "#8839ef",
      heat: ["#dce0e8", "#abe2a1", "#5bbb48", "#40a02b", "#246516"],
    },
  },
  // Computed, not published by the theme authors: muted = OKLab mix #616e88 -> #d8dee9 until 5:1 on bg; heatmap levels 1-3 = heatRamp(#88c0d0).
  {
    id: "nord",
    name: "Nord",
    mode: "dark",
    colors: {
      bg: "#2e3440",
      surface: "#3b4252",
      border: "#4c566a",
      text: "#eceff4",
      muted: "#9ca5b9",
      accent: "#88c0d0",
      heat: ["#3b4252", "#495e65", "#5c7d86", "#6c9ca9", "#88c0d0"],
    },
  },
  // Computed, not published by the theme authors: heatmap levels 1-3 = heatRamp(#b8bb26).
  {
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    mode: "dark",
    colors: {
      bg: "#282828",
      surface: "#3c3836",
      border: "#504945",
      text: "#ebdbb2",
      muted: "#a89984",
      accent: "#fabd2f",
      heat: ["#3c3836", "#4c4d1c", "#6e701d", "#929409", "#b8bb26"],
    },
  },
  // Computed, not published by the theme authors: heatmap levels 1-3 = heatRamp(#98c379).
  {
    id: "one-dark",
    name: "One Dark",
    mode: "dark",
    colors: {
      bg: "#21252b",
      surface: "#282c34",
      border: "#3e4452",
      text: "#abb2bf",
      muted: "#828997",
      accent: "#61afef",
      heat: ["#2c313c", "#38482d", "#577045", "#759a5b", "#98c379"],
    },
  },
  // Role mapping is ours: base2 as primary text (stock Solarized uses base0/base1 for body text, ~4.8:1).
  // Computed, not published by the theme authors: border = OKLab mix(#073642, #586e75, 0.5); heatmap levels 1-3 = heatRamp(#859900).
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    mode: "dark",
    colors: {
      bg: "#002b36",
      surface: "#073642",
      border: "#32515b",
      text: "#eee8d5",
      muted: "#93a1a1",
      accent: "#2aa198",
      heat: ["#073642", "#373f13", "#515d10", "#6b7b08", "#859900"],
    },
  },
  // Role mapping is ours: base02 as primary text (stock Solarized uses base00/base01, ~4.1-5.0:1).
  // Computed, not published by the theme authors: border = OKLab mix(#eee8d5, #93a1a1, 0.5); heatmap levels 1,2,4 = heatRamp(#859900).
  {
    id: "solarized-light",
    name: "Solarized Light",
    mode: "light",
    colors: {
      bg: "#fdf6e3",
      surface: "#eee8d5",
      border: "#c0c4bb",
      text: "#073642",
      muted: "#586e75",
      accent: "#d33682",
      heat: ["#eee8d5", "#cedd9a", "#9eb333", "#859900", "#556300"],
    },
  },
  // Computed, not published by the theme authors: heatmap levels 1-3 = heatRamp(#9ccfd8).
  {
    id: "rose-pine",
    name: "Rosé Pine",
    mode: "dark",
    colors: {
      bg: "#191724",
      surface: "#1f1d2e",
      border: "#403d52",
      text: "#e0def4",
      muted: "#908caa",
      accent: "#ebbcba",
      heat: ["#26233a", "#2d3f42", "#506d73", "#739ea5", "#9ccfd8"],
    },
  },
  // Computed, not published by the theme authors: heatmap levels 1-3 = heatRamp(#a6e22e).
  {
    id: "monokai",
    name: "Monokai",
    mode: "dark",
    colors: {
      bg: "#272822",
      surface: "#3e3d32",
      border: "#464741",
      text: "#f8f8f2",
      muted: "#90908a",
      accent: "#e6db74",
      heat: ["#3e3d32", "#3d5316", "#5e811a", "#7fb105", "#a6e22e"],
    },
  },
  // Computed, not published by the theme authors: heatmap levels 1-3 = heatRamp(#ff7edb).
  {
    id: "synthwave-84",
    name: "SynthWave '84",
    mode: "dark",
    colors: {
      bg: "#262335",
      surface: "#34294f",
      border: "#495495",
      text: "#ffffff",
      muted: "#b6b1b1",
      accent: "#36f9f6",
      heat: ["#34294f", "#5f3052", "#94487f", "#cc5fae", "#ff7edb"],
    },
  },
  // Monochrome heatmap = Geist gray-100/500/800/900/1000.
  {
    id: "vercel",
    name: "Vercel",
    mode: "dark",
    colors: {
      bg: "#000000",
      surface: "#0a0a0a",
      border: "#2e2e2e",
      text: "#ededed",
      muted: "#a1a1a1",
      accent: "#0072f5",
      heat: ["#1a1a1a", "#454545", "#7d7d7d", "#a1a1a1", "#ededed"],
    },
  },
  // Computed, not published by the theme authors: muted = OKLab mix #5a6378 -> #bfbdb6 until 5:1 on bg; heatmap levels 1-3 = heatRamp(#aad94c).
  {
    id: "ayu-dark",
    name: "Ayu Dark",
    mode: "dark",
    colors: {
      bg: "#0d1017",
      surface: "#141821",
      border: "#333b44",
      text: "#bfbdb6",
      muted: "#7e838f",
      accent: "#e6b450",
      heat: ["#1b1f29", "#283803", "#516c17", "#7ca325", "#aad94c"],
    },
  },
] as const satisfies readonly BannerTheme[];

export type ThemeId = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME_ID: ThemeId = "github-dark";

export const THEME_EXTRAS: Record<ThemeId, ThemeExtras> = {
  "github-dark": {
    link: "#4493f8",
    success: "#3fb950",
    warning: "#d29922",
    danger: "#f85149",
    done: "#ab7df8",
    family: "github",
    source:
      "@primer/primitives@11.10.0 (identical to live github.com CSS, checked 2026-11-12)",
  },
  "github-light": {
    link: "#0969da",
    success: "#1a7f37",
    warning: "#9a6700",
    danger: "#d1242f",
    done: "#8250df",
    family: "github",
    source:
      "@primer/primitives@11.10.0 (identical to live github.com CSS, checked 2026-11-12)",
  },
  "github-dark-dimmed": {
    link: "#478be6",
    success: "#57ab5a",
    warning: "#c69026",
    danger: "#e5534b",
    done: "#986ee2",
    family: "github",
    source:
      "@primer/primitives@11.10.0 (identical to live github.com CSS, checked 2026-11-12)",
  },
  "github-dark-high-contrast": {
    link: "#74b9ff",
    success: "#2bd853",
    warning: "#f0b72f",
    danger: "#ff9492",
    done: "#d3abff",
    heatBorder: "#ffffff",
    family: "github",
    source:
      "@primer/primitives@11.10.0 (identical to live github.com CSS, checked 2026-11-12)",
  },
  "github-light-high-contrast": {
    link: "#023b95",
    success: "#04591f",
    warning: "#603700",
    danger: "#960d1e",
    done: "#5e2bb4",
    heatBorder: "#010409",
    family: "github",
    source:
      "@primer/primitives@11.10.0 (identical to live github.com CSS, checked 2026-11-12)",
  },
  "github-halloween": {
    link: "#4493f8",
    success: "#3fb950",
    warning: "#d29922",
    danger: "#f85149",
    done: "#ab7df8",
    family: "github",
    source:
      "@primer/primitives@11.10.0 (identical to live github.com CSS, checked 2026-11-12)",
  },
  "github-halloween-light": {
    link: "#0969da",
    success: "#1a7f37",
    warning: "#9a6700",
    danger: "#d1242f",
    done: "#8250df",
    family: "github",
    source:
      "@primer/primitives@11.10.0 (identical to live github.com CSS, checked 2026-11-12)",
  },
  "github-winter": {
    link: "#4493f8",
    success: "#3fb950",
    warning: "#d29922",
    danger: "#f85149",
    done: "#ab7df8",
    family: "github",
    source:
      "@primer/primitives@11.10.0 (identical to live github.com CSS, checked 2026-11-12)",
  },
  "github-winter-light": {
    link: "#0969da",
    success: "#1a7f37",
    warning: "#9a6700",
    danger: "#d1242f",
    done: "#8250df",
    family: "github",
    source:
      "@primer/primitives@11.10.0 (identical to live github.com CSS, checked 2026-11-12)",
  },
  "github-dark-classic": {
    link: "#4493f8",
    success: "#3fb950",
    warning: "#d29922",
    danger: "#f85149",
    done: "#ab7df8",
    family: "github",
    source:
      "@primer/primitives@11.10.0 (identical to live github.com CSS, checked 2026-11-12); heatmap = the 2021-2024 github.com dark greens (no longer in Primer; still what most third-party cards copy)",
  },
  dracula: {
    link: "#8be9fd",
    success: "#50fa7b",
    warning: "#ffb86c",
    danger: "#ff5555",
    done: "#bd93f9",
    family: "community",
    source:
      "dracula/dracula-theme README (spec) + dracula/visual-studio-code src/dracula.yml (BGLight)",
  },
  "tokyo-night": {
    link: "#7dcfff",
    success: "#9ece6a",
    warning: "#e0af68",
    danger: "#f7768e",
    done: "#bb9af7",
    family: "community",
    source: "folke/tokyonight.nvim lua/tokyonight/colors/{night,storm}.lua",
  },
  "catppuccin-mocha": {
    link: "#89b4fa",
    success: "#a6e3a1",
    warning: "#f9e2af",
    danger: "#f38ba8",
    done: "#cba6f7",
    family: "community",
    source: "@catppuccin/palette@1.8.0 css/catppuccin.css",
  },
  "catppuccin-latte": {
    link: "#1e66f5",
    success: "#40a02b",
    warning: "#df8e1d",
    danger: "#d20f39",
    done: "#8839ef",
    family: "community",
    source: "@catppuccin/palette@1.8.0 css/catppuccin.css",
  },
  nord: {
    link: "#81a1c1",
    success: "#a3be8c",
    warning: "#ebcb8b",
    danger: "#bf616a",
    done: "#b48ead",
    family: "community",
    source:
      "nord@0.2.1 src/sass/nord.scss (nord0-nord15) + nordtheme/visual-studio-code (#616e88 comment)",
  },
  "gruvbox-dark": {
    link: "#83a598",
    success: "#b8bb26",
    warning: "#fe8019",
    danger: "#fb4934",
    done: "#d3869b",
    family: "community",
    source:
      "morhetz/gruvbox colors/gruvbox.vim (dark0, dark1, dark2, light1, light4, bright_*)",
  },
  "one-dark": {
    link: "#61afef",
    success: "#98c379",
    warning: "#e5c07b",
    danger: "#e06c75",
    done: "#c678dd",
    family: "community",
    source:
      "atom/one-dark-syntax styles/colors.less (HSL -> hex) + Binaryify/OneDark-Pro (#21252b UI bg, #3e4452 border)",
  },
  "solarized-dark": {
    link: "#268bd2",
    success: "#859900",
    warning: "#b58900",
    danger: "#dc322f",
    done: "#6c71c4",
    family: "community",
    source: "altercation/solarized README (base03..base3 + accents)",
  },
  "solarized-light": {
    link: "#268bd2",
    success: "#859900",
    warning: "#b58900",
    danger: "#dc322f",
    done: "#6c71c4",
    family: "community",
    source: "altercation/solarized README (base03..base3 + accents)",
  },
  "rose-pine": {
    link: "#c4a7e7",
    success: "#9ccfd8",
    warning: "#f6c177",
    danger: "#eb6f92",
    done: "#c4a7e7",
    family: "community",
    source: "@rose-pine/palette@4.0.1 dist/css/rose-pine.css (main variant)",
  },
  monokai: {
    link: "#66d9ef",
    success: "#a6e22e",
    warning: "#fd971f",
    danger: "#f92672",
    done: "#ae81ff",
    family: "community",
    source:
      "microsoft/vscode extensions/theme-monokai/themes/monokai-color-theme.json",
  },
  "synthwave-84": {
    link: "#ff7edb",
    success: "#72f1b8",
    warning: "#fede5d",
    danger: "#fe4450",
    done: "#b893ce",
    family: "community",
    source: "robb0wen/synthwave-vscode themes/synthwave-color-theme.json",
  },
  vercel: {
    link: "#52a8ff",
    success: "#62c073",
    warning: "#ffb224",
    danger: "#ff6166",
    done: "#bf7af0",
    family: "community",
    source:
      "vercel.com/geist/colors CSS (--ds-* dark values, HSL -> hex), fetched 2026-11-12",
  },
  "ayu-dark": {
    link: "#59c2ff",
    success: "#aad94c",
    warning: "#ffb454",
    danger: "#f26d78",
    done: "#d2a6ff",
    family: "community",
    source: "ayu@9.1.0 dist/generated/dark.js",
  },
};

const byId = new Map<string, BannerTheme>(THEMES.map((t) => [t.id, t]));

export function isThemeId(id: string): id is ThemeId {
  return byId.has(id);
}

/** Unknown ids fall back to the default theme, so a typo in a URL never breaks an embedded image. */
export function getTheme(id: string | null | undefined): BannerTheme {
  return (id ? byId.get(id) : undefined) ?? THEMES[0];
}
