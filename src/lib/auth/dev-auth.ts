/**
 * DEVELOPMENT ONLY: sign in as whoever the local GitHub CLI is logged in as
 * (`gh auth token`), so working on account features needs no GitHub app.
 *
 * Layers that keep this out of production; every one of them must pass:
 *
 *  1. the route file is `route.dev.ts`, and "dev.ts" is a page extension only
 *     under `next dev` (next.config.ts), so `next build` never compiles it;
 *  2. `NODE_ENV` must be "development" (`next build` and `next start` force
 *     "production");
 *  3. `GITBANNERS_DEV_GH_LOGIN=1` must be set explicitly (it belongs in
 *     .env.development.local and never on Vercel);
 *  4. no Vercel or AWS Lambda runtime marker may be present;
 *  5. the request must be addressed to a loopback host;
 *  6. it shells out to the `gh` binary, which no serverless function has.
 *
 * The CLI token is used for exactly one request, `GET /user`. Pro is decided
 * without it (allowlist and server-side lookup only), and it is never stored.
 */
import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { NextRequest } from "next/server";
import { problem } from "@/lib/http/problem";
import { accountsAvailable, redirectTo } from "./env";
import { fetchGitHubUser, type GitHubUser, safeReturnTo } from "./github";
import { completeSignIn } from "./session";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const GH_TIMEOUT_MS = 5000;
/**
 * Sent as a response header by this module and by nothing else, so a CI step
 * can grep the production output for it (`.next`, minus `.next/dev`) and fail
 * the build if this module was ever bundled. A string the code uses, not a
 * comment: compiled chunks carry no comments, so a comment would only be found
 * for as long as server source maps are emitted.
 */
const DEV_SIGN_IN_MARKER = "gb-dev-signin-via-gh-cli";
const MARKER_HEADER = "X-GitBanners-Dev-Sign-In";

function withoutPort(host: string): string {
  return host.replace(/:\d+$/, "");
}

/**
 * Guards 2 to 5 from the list above. A function of its own so the matrix can
 * be tested without a GitHub CLI.
 */
export function devLoginAllowed(request: Request): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.GITBANNERS_DEV_GH_LOGIN === "1" &&
    !process.env.VERCEL &&
    !process.env.VERCEL_ENV &&
    !process.env.VERCEL_URL &&
    !process.env.AWS_LAMBDA_FUNCTION_NAME &&
    // `request.url` always carries the server's own hostname, so look at what
    // the client actually sent. A tunnel or proxy shows up in the second
    // header.
    LOOPBACK_HOSTS.has(withoutPort(request.headers.get("host") ?? "")) &&
    LOOPBACK_HOSTS.has(
      withoutPort(request.headers.get("x-forwarded-host") ?? "localhost"),
    )
  );
}

function devProblem(status: number, code: string, detail: string): Response {
  return problem(status, {
    code,
    title: "Development sign-in failed",
    detail,
    headers: { [MARKER_HEADER]: DEV_SIGN_IN_MARKER },
  });
}

/**
 * Handles `GET /api/auth/dev`. Answers a bare 404 unless every guard passes,
 * so a deployment that somehow shipped the route cannot be told apart from
 * one that did not.
 */
export async function devSignIn(request: NextRequest): Promise<Response> {
  // Indistinguishable from a route that does not exist.
  if (!devLoginAllowed(request)) return new Response(null, { status: 404 });
  if (!accountsAvailable()) {
    return devProblem(
      500,
      "accounts_unavailable",
      "Set SESSION_SECRET in .env.development.local (openssl rand -base64 32).",
    );
  }

  let token: string;
  try {
    const { stdout } = await promisify(execFile)("gh", ["auth", "token"], {
      timeout: GH_TIMEOUT_MS,
    });
    token = stdout.trim();
  } catch {
    return devProblem(
      500,
      "gh_cli_unavailable",
      "Could not run `gh auth token`. Install the GitHub CLI and run `gh auth login`.",
    );
  }
  if (!token) {
    return devProblem(
      500,
      "gh_cli_not_logged_in",
      "The GitHub CLI has no token. Run `gh auth login`.",
    );
  }

  let profile: GitHubUser;
  try {
    profile = await fetchGitHubUser(token);
  } catch {
    return devProblem(
      502,
      "github_unreachable",
      "GitHub did not accept the CLI token. Run `gh auth status`.",
    );
  }
  // No token is passed on: Pro comes from the allowlist or the server-side
  // lookup.
  await completeSignIn(profile);
  const response = redirectTo(
    safeReturnTo(request.nextUrl.searchParams.get("returnTo")),
  );
  response.headers.set(MARKER_HEADER, DEV_SIGN_IN_MARKER);
  return response;
}
