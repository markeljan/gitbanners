import { site } from "@/lib/site";

/**
 * The API index served at `/api` and `/api/v1`: an agent that probes either
 * path gets JSON that points at everything else instead of an HTML page.
 */
export function apiIndex() {
  const base = `${site.url}${site.api.basePath}`;
  return {
    name: `${site.name} API`,
    description:
      "Read-only, keyless JSON API for public GitHub profile, organization and repository data, and for the banner images drawn from it.",
    current_version: site.api.version,
    authentication: "none",
    openapi: `${site.url}/openapi.json`,
    api_catalog: `${site.url}/.well-known/api-catalog`,
    docs: `${site.url}/docs`,
    mcp: `${site.url}/mcp`,
    llms: `${site.url}/llms.txt`,
    operations: {
      owner: `${base}/owners/{login}`,
      repository: `${base}/repos/{owner}/{repo}`,
      search: `${base}/search?q={query}`,
      banner: `${base}/banner?target={login-or-owner/repo}`,
      options: `${base}/options`,
    },
    images: {
      profile: `${site.url}/{login}.svg`,
      profile_preset: `${site.url}/{login}/{preset}.svg`,
      repository: `${site.url}/{owner}/{repo}.svg`,
      repository_preset: `${site.url}/{owner}/{repo}/{preset}.svg`,
      formats: ["svg", "png"],
    },
  };
}
