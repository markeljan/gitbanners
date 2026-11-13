// Re-implementation (de-minified) of is-agentic.com's client scoring module `buildPreviewReport`
// Source: https://is-agentic.com/_next/static/immutable/chunks/0a1h9wyly5ifn.js (fetched 2026-11-12)
import { readFileSync } from "node:fs";

export const ESSENTIAL = new Set([
  "agent-crawler-reachability",
  "agent-friendly-404",
  "ax-accessible-names",
  "ax-document-structure",
  "ax-form-labeling",
  "ax-native-controls",
  "bot-detection",
  "content-no-js",
  "docs-auth-gate",
  "json-error-responses",
  "markdown-negotiation-vary",
  "mcp-auth-mechanism",
  "mcp-error-handling",
  "mcp-oauth-metadata",
  "mcp-pkce-s256",
  "mcp-resource-listing",
  "mcp-server-identity",
  "mcp-transport-modern",
  "mcp-view-csp",
  "mcp-view-domain",
  "oauth-protected-resource",
  "oauth-support",
  "openapi-spec",
  "redirect-hygiene",
  "scoped-permissions",
]);
export const EMERGING = new Set([
  "a2ui-support",
  "acp-delegate-payment",
  "acp-support",
  "agent-auth-discovery-metadata",
  "agent-auth-endpoints-reachable",
  "agent-discovery-file",
  "agent-mode-view",
  "agent-plugins-repo",
  "agent-rules-repo",
  "agent-skills-index-v2",
  "agent-ua-markdown",
  "agentic-search-usecase",
  "ap2-support",
  "ard-catalog",
  "ard-entries-valid",
  "ard-trust-manifest",
  "auth-md-exists",
  "auth-md-structure",
  "auth-md-walkthrough-simulation",
  "llms-txt-exists",
  "llms-txt-formatting",
  "llms-txt-links-resolve",
  "markdown-frontmatter",
  "markdown-link-alternate",
  "markdown-negotiation",
  "markdown-url-fallback",
  "mcp-app-registry",
  "mcp-apps-ui-quality",
  "mcp-multi-surface-coverage",
  "mcp-server-card",
  "mcp-well-known-discovery",
  "modular-llms-txt",
  "mpp-support",
  "nlweb-ask",
  "nlweb-schema-feeds",
  "nlweb-streaming",
  "pricing-md",
  "registry-branding",
  "skills-sh-listed",
  "skills-sh-quality",
  "speakable-content",
  "ucp-support",
  "web-bot-auth-directory",
  "webmcp",
  "x402-support",
]);
export const EXCLUDED = new Set([
  "robots-agent-user-policy",
  "robots-ai-policy-quality",
]);
export const NEVER_BONUS = new Set(["markdown-negotiation-vary"]);
export const ALIAS = new Map([["bot-detection", "agent-crawler-reachability"]]);
export const FORCED_BONUS = new Set([
  "a2a-agent-card",
  "acp-delegate-payment",
  "acp-support",
  "agent-plugins-repo",
  "agent-rules-repo",
  "agent-skills-index-v2",
  "ap2-support",
  "ax-tree-injection-safe",
  "batch-endpoints",
  "chatgpt-app-listed",
  "async-job-pattern",
  "idempotency-key-support",
  "json-ld-entity-linking",
  "link-headers-discovery",
  "mcp-registry-listed",
  "mcp-tool-annotations",
  "mpp-support",
  "npm-sdk-package",
  "pagination-shape",
  "registry-branding",
  "rest-sdk-packages",
  "sandbox-environment",
  "schema-type-breadth",
  "sitemap-lastmod",
  "skills-sh-listed",
  "skills-sh-quality",
  "ucp-support",
  "wikipedia-presence",
  "x402-support",
]);
export const API_SURFACE = new Set([
  "agent-auth-www-authenticate",
  "api-catalog-rfc9727",
  "api-error-model",
  "api-schema-analysis",
  "api-versioning-policy",
  "async-job-pattern",
  "batch-endpoints",
  "cli-tool",
  "developer-portal",
  "function-calling-compat",
  "idempotency-key-support",
  "json-error-responses",
  "npm-sdk-package",
  "openapi-spec",
  "pagination-shape",
  "public-api",
  "public-api-docs",
  "rate-limit-headers",
  "response-schema-coverage",
  "rest-sdk-packages",
  "sandbox-environment",
  "schema-type-breadth",
]);
export const AUTH_SURFACE = new Set([
  "agent-auth-discovery-metadata",
  "agent-auth-endpoints-reachable",
  "agent-auth-www-authenticate",
  "auth-md-exists",
  "auth-md-structure",
  "auth-md-walkthrough-simulation",
  "oauth-protected-resource",
  "oauth-support",
  "onboarding-friction",
  "scoped-permissions",
]);
export const COMMERCE_SURFACE = new Set([
  "acp-delegate-payment",
  "acp-support",
  "ap2-support",
  "mpp-support",
  "pricing-info",
  "pricing-md",
  "ucp-support",
  "x402-support",
]);
export const SURFACE_EVIDENCE = {
  api: [
    "public-api",
    "public-api-docs",
    "openapi-spec",
    "api-catalog-rfc9727",
    "api-schema-analysis",
  ],
  auth: [
    "oauth-support",
    "oauth-protected-resource",
    "agent-auth-www-authenticate",
  ],
  mcp: [
    "mcp-server",
    "mcp-tool-listing",
    "mcp-server-identity",
    "mcp-transport-modern",
  ],
  graphql: ["graphql-schema-completeness"],
  commerce: [
    "acp-support",
    "ap2-support",
    "mpp-support",
    "ucp-support",
    "x402-support",
  ],
};

export function fraction(c) {
  if (c.status === "na" || c.status === "pending") return null;
  if (
    typeof c.score === "number" &&
    typeof c.maxScore === "number" &&
    c.maxScore > 0
  )
    return Math.max(0, Math.min(1, c.score / c.maxScore));
  return c.status === "pass" ? 1 : 0.5 * (c.status === "warning");
}
export function surfaceOf(id) {
  return id.startsWith("graphql-")
    ? "graphql"
    : id.startsWith("mcp-")
      ? "mcp"
      : AUTH_SURFACE.has(id)
        ? "auth"
        : API_SURFACE.has(id)
          ? "api"
          : COMMERCE_SURFACE.has(id)
            ? "commerce"
            : "web";
}
const r1 = (x) => Math.round(10 * x) / 10;
function bucket(list, pool) {
  return {
    earned: r1(
      (list.length
        ? list.reduce((a, c) => a + c.fraction, 0) / list.length
        : 0) * pool,
    ),
    available: pool,
    passing: list.filter((c) => c.fraction >= 0.999).length,
    total: list.length,
  };
}

export function score(result) {
  const groups = new Map();
  for (const layer of result.layers)
    for (const c of layer.checks) {
      if (EXCLUDED.has(c.id)) continue;
      const f = fraction(c);
      if (f === null) continue;
      const id = ALIAS.get(c.id) ?? c.id;
      const g = groups.get(id) ?? { checks: [], fractions: [] };
      g.checks.push(c);
      g.fractions.push(f);
      groups.set(id, g);
    }
  const items = Array.from(groups, ([id, g]) => {
    const tier = ESSENTIAL.has(id)
      ? "required"
      : EMERGING.has(id)
        ? "emerging"
        : "recommended";
    const frac = g.fractions.reduce((a, b) => a + b, 0) / g.fractions.length;
    return {
      id,
      tier,
      bonus:
        !NEVER_BONUS.has(id) &&
        (tier === "emerging" ||
          FORCED_BONUS.has(id) ||
          g.checks.some((c) => c.bonus === true)),
      fraction: frac,
      occurrences: g.checks.length,
    };
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  const active = new Set(["web"]);
  for (const [s, ids] of Object.entries(SURFACE_EVIDENCE))
    if (
      ids.some((id) => {
        const x = byId.get(id);
        return !!(x && x.fraction > 0);
      })
    )
      active.add(s);
  const all = result.layers.flatMap((l) => l.checks);
  if (
    result.urlKind === "mcp" ||
    result.urlKind === "mcp-app" ||
    all.some((c) => !!c.mcpUrl)
  )
    active.add("mcp");
  if (result.mcpAuthRequired) active.add("auth");
  const eligible = items.filter((i) => {
    const s = surfaceOf(i.id);
    return s === "web" || active.has(s) || i.bonus;
  });
  const ess = eligible.filter((i) => i.tier === "required" && !i.bonus);
  const rec = eligible.filter((i) => i.tier === "recommended" && !i.bonus);
  const bon = eligible.filter((i) => i.bonus);
  const E = bucket(ess, 80),
    R = bucket(rec, 20),
    B = r1(
      Math.min(
        5,
        bon.reduce((a, c) => a + 0.25 * c.fraction, 0),
      ),
    );
  return {
    score:
      E.total + R.total > 0
        ? Math.round(Math.min(100, E.earned + R.earned + B))
        : null,
    essential: E,
    recommended: R,
    bonusPoints: B,
    bonusSignals: bon.filter((c) => c.fraction > 0).length,
    active: [...active],
    ess,
    rec,
    bon,
  };
}

if (process.argv[2]) {
  const result = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const s = score(result);
  const verbose = process.argv[3] === "-v";
  console.log(
    JSON.stringify({
      domain: result.domain,
      scoringVersion: result.scoringVersion,
      mcpAuthRequired: result.mcpAuthRequired,
      score: s.score,
      essential: s.essential,
      recommended: s.recommended,
      bonusPoints: s.bonusPoints,
      bonusSignals: s.bonusSignals,
      active: s.active,
    }),
  );
  if (verbose) {
    console.log(
      "ESSENTIAL:",
      s.ess.map((c) => `${c.id}=${c.fraction.toFixed(2)}`).join(", "),
    );
    console.log(
      "RECOMMENDED:",
      s.rec.map((c) => `${c.id}=${c.fraction.toFixed(2)}`).join(", "),
    );
    console.log(
      "BONUS:",
      s.bon.map((c) => `${c.id}=${c.fraction.toFixed(2)}`).join(", "),
    );
  }
}
