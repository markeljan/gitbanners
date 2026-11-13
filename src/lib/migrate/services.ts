/**
 * The card services a README doctor recognises, and how each one is doing.
 *
 * Health was measured with a live request on `SERVICES_CHECKED` (see the
 * README doctor research): a service that answers with an image today is
 * "up" and only offered as optional; one that answers with an error or a web
 * page is "down" and replaced. Copies of a service on other hosts are
 * "unknown": they may well work, so they are offered, never forced.
 */

/** When the health of every service below was last checked by hand. */
export const SERVICES_CHECKED = "2026-11-13";

export type ServiceId =
  | "readme-stats"
  | "readme-stats-copy"
  | "streak-stats"
  | "trophy"
  | "activity-graph"
  | "gh-card"
  | "summary-cards";

export type ServiceHealth = "down" | "up" | "unknown";

export interface CardService {
  id: ServiceId;
  /** How people know it: its repository name. */
  name: string;
  /** Its source repository on GitHub, `owner/name`. */
  repo: string;
}

export const SERVICES: Record<ServiceId, CardService> = {
  "readme-stats": {
    id: "readme-stats",
    name: "github-readme-stats",
    repo: "anuraghazra/github-readme-stats",
  },
  "readme-stats-copy": {
    id: "readme-stats-copy",
    name: "github-readme-stats (another host)",
    repo: "anuraghazra/github-readme-stats",
  },
  "streak-stats": {
    id: "streak-stats",
    name: "github-readme-streak-stats",
    repo: "DenverCoder1/github-readme-streak-stats",
  },
  trophy: {
    id: "trophy",
    name: "github-profile-trophy",
    repo: "ryo-ma/github-profile-trophy",
  },
  "activity-graph": {
    id: "activity-graph",
    name: "github-readme-activity-graph",
    repo: "Ashutosh00710/github-readme-activity-graph",
  },
  "gh-card": { id: "gh-card", name: "gh-card", repo: "nwtgck/gh-card" },
  "summary-cards": {
    id: "summary-cards",
    name: "github-profile-summary-cards",
    repo: "vn7n24fzkq/github-profile-summary-cards",
  },
};

/** What one card URL draws. */
export type CardKind =
  | "stats"
  | "top-langs"
  | "pin"
  | "wakatime"
  | "gist"
  | "streak"
  | "trophy"
  | "activity-graph"
  | "repo-card"
  | "profile-details"
  | "summary-stats"
  | "summary-languages"
  | "productive-time";

export const CARD_NAMES: Record<CardKind, string> = {
  stats: "Stats card",
  "top-langs": "Top languages card",
  pin: "Repository pin",
  wakatime: "WakaTime card",
  gist: "Gist pin",
  streak: "Streak card",
  trophy: "Trophy card",
  "activity-graph": "Activity graph",
  "repo-card": "Repository card",
  "profile-details": "Profile details card",
  "summary-stats": "Stats summary card",
  "summary-languages": "Languages summary card",
  "productive-time": "Productive time card",
};

/** A recognised card URL. */
export interface CardMatch {
  service: ServiceId;
  health: ServiceHealth;
  kind: CardKind;
  /** The query, decoded. Keys are lower-cased; the last value of a key wins. */
  params: ReadonlyMap<string, string>;
  /** Each lower-cased key as the URL spells it, for messages. */
  keys: ReadonlyMap<string, string>;
  /** Owner and name read from the path (gh-card), when there are any. */
  repo?: { owner: string; name: string };
  /** The fragment, including "#", such as "#gh-dark-mode-only". */
  hash: string;
  /** The extension of the image the service was asked for. */
  format: "svg" | "png";
}

/** Hosts of the public deployments, with what a request to them gives today. */
const OFFICIAL: Record<string, { service: ServiceId; health: ServiceHealth }> =
  {
    // 503 DEPLOYMENT_PAUSED; the README says it is no longer maintained.
    "github-readme-stats.vercel.app": {
      service: "readme-stats",
      health: "down",
    },
    // Both answer 200 with an SVG.
    "streak-stats.demolab.com": { service: "streak-stats", health: "up" },
    "github-readme-streak-stats.herokuapp.com": {
      service: "streak-stats",
      health: "up",
    },
    // 402 DEPLOYMENT_DISABLED.
    "github-profile-trophy.vercel.app": { service: "trophy", health: "down" },
    // 402 DEPLOYMENT_DISABLED, and the two earlier hosts are gone (404 on
    // Heroku, no DNS for Cyclic).
    "github-readme-activity-graph.vercel.app": {
      service: "activity-graph",
      health: "down",
    },
    "github-readme-activity-graph.herokuapp.com": {
      service: "activity-graph",
      health: "down",
    },
    "github-readme-activity-graph.cyclic.app": {
      service: "activity-graph",
      health: "down",
    },
    "github-readme-activity-graph.cyclic.cloud": {
      service: "activity-graph",
      health: "down",
    },
    "activity-graph.herokuapp.com": {
      service: "activity-graph",
      health: "down",
    },
    // Discontinued: card URLs answer with an HTML page.
    "gh-card.dev": { service: "gh-card", health: "down" },
    // 200 with an SVG.
    "github-profile-summary-cards.vercel.app": {
      service: "summary-cards",
      health: "up",
    },
  };

const READMESTATS_PATHS: Record<string, CardKind> = {
  "/api": "stats",
  "/api/top-langs": "top-langs",
  "/api/pin": "pin",
  "/api/wakatime": "wakatime",
  "/api/gist": "gist",
};

const SUMMARY_CARDS: Record<string, CardKind> = {
  "profile-details": "profile-details",
  stats: "summary-stats",
  "repos-per-language": "summary-languages",
  "most-commit-language": "summary-languages",
  "productive-time": "productive-time",
};

const ENTITY = /&(?:amp|#0*38|#x0*26);/gi;

/** `&amp;` and its numeric forms back to `&`, as a Markdown or HTML parser reads them. */
export function decodeAmpersands(value: string): string {
  return value.replace(ENTITY, "&");
}

function parseUrl(raw: string): URL | null {
  const value = decodeAmpersands(raw.trim());
  if (!/^(?:https?:)?\/\//i.test(value)) return null;
  try {
    return new URL(value.startsWith("//") ? `https:${value}` : value);
  } catch {
    return null;
  }
}

function paramsOf(url: URL): {
  params: Map<string, string>;
  keys: Map<string, string>;
} {
  const params = new Map<string, string>();
  const keys = new Map<string, string>();
  for (const [key, value] of url.searchParams) {
    params.set(key.toLowerCase(), value);
    keys.set(key.toLowerCase(), key);
  }
  return { params, keys };
}

function formatOf(path: string, params: Map<string, string>): "svg" | "png" {
  if (/\.png$/i.test(path)) return "png";
  return params.get("type")?.toLowerCase() === "png" ? "png" : "svg";
}

/**
 * Which card a URL is, or `null` when it is none of the recognised ones.
 * `raw` is the URL as written in the README: HTML entities are decoded first.
 */
export function identifyCard(raw: string): CardMatch | null {
  const url = parseUrl(raw);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const path = url.pathname.replace(/\/+$/, "").toLowerCase() || "/";
  const { params, keys } = paramsOf(url);
  const base = { params, keys, hash: url.hash, format: formatOf(path, params) };
  const official = OFFICIAL[host];

  const readmeKind = READMESTATS_PATHS[path];
  if (readmeKind) {
    if (official?.service === "readme-stats") {
      return {
        ...base,
        service: "readme-stats",
        health: "down",
        kind: readmeKind,
      };
    }
    // Another host with readme-stats' paths and parameters: a self-hosted
    // copy, or a maintained fork such as github-stats-extended.
    const named = /stats|readme/.test(host) && !official;
    const asks =
      readmeKind === "gist" ? params.has("id") : params.has("username");
    if (named && asks) {
      return {
        ...base,
        service: "readme-stats-copy",
        health: "unknown",
        kind: readmeKind,
      };
    }
    return null;
  }

  if (official?.service === "streak-stats" || host.includes("streak-stats")) {
    if (path !== "/" && path !== "/index.php") return null;
    return {
      ...base,
      service: "streak-stats",
      health: official?.health ?? "unknown",
      kind: "streak",
    };
  }

  if (official?.service === "trophy" || host.includes("profile-trophy")) {
    if (path !== "/") return null;
    return {
      ...base,
      service: "trophy",
      health: official?.health ?? "unknown",
      kind: "trophy",
    };
  }

  if (
    official?.service === "activity-graph" ||
    host.includes("activity-graph")
  ) {
    if (path !== "/graph") return null;
    return {
      ...base,
      service: "activity-graph",
      health: official?.health ?? "unknown",
      kind: "activity-graph",
    };
  }

  if (official?.service === "gh-card") {
    const match = /^\/repos\/([^/]+)\/([^/]+?)\.(?:svg|png)$/i.exec(
      url.pathname,
    );
    if (!match?.[1] || !match[2]) return null;
    return {
      ...base,
      service: "gh-card",
      health: "down",
      kind: "repo-card",
      repo: {
        owner: decodeURIComponent(match[1]),
        name: decodeURIComponent(match[2]),
      },
    };
  }

  if (
    official?.service === "summary-cards" ||
    host.includes("profile-summary-cards")
  ) {
    const card = /^\/api\/cards\/([a-z-]+)$/.exec(path)?.[1];
    const kind = card ? SUMMARY_CARDS[card] : undefined;
    if (!kind) return null;
    return {
      ...base,
      service: "summary-cards",
      health: official?.health ?? "unknown",
      kind,
    };
  }

  return null;
}
