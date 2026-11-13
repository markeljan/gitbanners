/**
 * GET /api/v1/repos/{owner}/{repo}
 *
 * A public repository as normalized JSON: counts, languages, weekly commit
 * activity, star history and top contributors.
 */
import { apiMethodNotAllowed, apiPreflight, publicApi } from "@/lib/api/http";
import { getRepoData } from "@/lib/api/service";
import { entityCacheTag } from "@/lib/http/cache-headers";

interface Context {
  params: Promise<{ owner: string; repo: string }>;
}

export async function GET(request: Request, context: Context) {
  // Route params arrive URL-decoded: decoding again would turn `%25` into a
  // lone "%" (and a lone "%" into a URIError) instead of a 400.
  const { owner, repo } = await context.params;
  return publicApi(request, "api", async () => {
    const data = await getRepoData(owner, repo);
    return {
      body: data,
      tags: [
        entityCacheTag("repo", data.fullName),
        entityCacheTag("owner", data.owner.login),
      ],
    };
  });
}

export {
  apiMethodNotAllowed as DELETE,
  apiMethodNotAllowed as PATCH,
  apiMethodNotAllowed as POST,
  apiMethodNotAllowed as PUT,
  apiPreflight as OPTIONS,
};
