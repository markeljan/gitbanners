/**
 * GET /api/auth/dev?returnTo=/
 *
 * Local development sign-in through the GitHub CLI. This file only becomes a
 * route under `next dev` (see `pageExtensions` in next.config.ts); production
 * builds never compile it. All other guards live in `@/lib/auth/dev-auth`.
 */
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest): Promise<Response> {
  if (process.env.NODE_ENV !== "development") {
    return new Response(null, { status: 404 });
  }
  // Imported lazily so nothing of it is even loaded outside development.
  const { devSignIn } = await import("@/lib/auth/dev-auth");
  return devSignIn(request);
}
