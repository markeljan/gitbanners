/**
 * The cookie session and the guards built on it.
 *
 * Three cookies, all host-only, `Path=/`, `SameSite=Lax`:
 *
 *   gb_session  HttpOnly  the signed session (30 days, sliding)
 *   gb_signin   HttpOnly  state of one sign-in round trip (10 minutes)
 *   gb_in                 "1", readable by scripts: lets static pages skip the
 *                         call to /api/me for anonymous visitors
 *
 * In production they carry the `__Host-` prefix and `Secure`.
 */
import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import type { z } from "zod";
import { getUser, type User, upsertUser } from "@/lib/db/users";
import { PRIVATE_NO_STORE } from "@/lib/http/cache-headers";
import {
  badRequest,
  forbidden,
  problem,
  rateLimited,
  unauthorized,
  unavailable,
} from "@/lib/http/problem";
import { decideProAtSignIn } from "@/lib/pro";
import { limit, type PolicyName } from "@/lib/ratelimit";
import { StoreUnavailableError } from "@/lib/store";
import { isSameOrigin } from "./csrf";
import type { GitHubUser } from "./github";
import {
  SESSION_MAX_AGE,
  SESSION_REFRESH_AFTER,
  type Session,
  type SessionClaims,
  SIGN_IN_TX_MAX_AGE,
  type SignInTx,
  signSession,
  signSignInTx,
  verifySession,
  verifySignInTx,
} from "./session-token";

/**
 * Request bodies of the account API are small; anything bigger is a mistake.
 */
const MAX_BODY_BYTES = 16 * 1024;

/**
 * `__Host-` makes the browser insist on `Secure`, `Path=/` and no `Domain`,
 * so the cookie cannot be set or overwritten from a sibling subdomain or over
 * plain HTTP. It needs HTTPS, so `next dev` uses the plain names.
 */
function secureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * The cookie names for a mode. Resolved per call rather than once at import,
 * so tests can exercise both modes.
 */
export function cookieNames(secure: boolean = secureCookies()) {
  const prefix = secure ? "__Host-" : "";
  return {
    session: `${prefix}gb_session`,
    signIn: `${prefix}gb_signin`,
    hint: `${prefix}gb_in`,
  } as const;
}

// SameSite=Lax, not Strict: the sign-in callback is a cross-site top-level
// navigation coming from github.com and must still carry the cookies.
function cookieOptions() {
  return {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
  } as const;
}

/**
 * Who the cookie says is signed in, without a database read (about 20 µs).
 * Good enough for display; anything private or mutating uses `requireUser()`.
 *
 * A request-time API: in Server Components call it under `<Suspense>`.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  return verifySession(jar.get(cookieNames().session)?.value);
});

/**
 * Route Handlers and Server Functions only: cookies cannot be set while
 * rendering.
 */
export async function setSessionCookie(claims: SessionClaims): Promise<void> {
  const jar = await cookies();
  const names = cookieNames();
  const options = { ...cookieOptions(), maxAge: SESSION_MAX_AGE };
  jar.set(names.session, await signSession(claims), options);
  jar.set(names.hint, "1", { ...options, httpOnly: false });
}

/**
 * Sliding expiry: re-issues the cookie once it is older than a day. Call it
 * from a handler that runs on most visits (`GET /api/me`).
 */
export async function refreshSessionCookie(session: Session): Promise<void> {
  if (Date.now() / 1000 - session.iat > SESSION_REFRESH_AFTER) {
    await setSessionCookie(session);
  }
}

/**
 * Signs the browser out.
 *
 * Deliberately not `cookies().delete(name)`: that emits a `Set-Cookie` without
 * `Secure`, and a browser ignores any attempt to touch a `__Host-` cookie
 * that is not itself `Secure` with `Path=/`. The cookie would silently stay.
 */
export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  const names = cookieNames();
  const options = { ...cookieOptions(), maxAge: 0 };
  jar.set(names.session, "", options);
  jar.set(names.hint, "", { ...options, httpOnly: false });
}

/** Remembers one sign-in round trip for the ten minutes a GitHub code lives. */
export async function setSignInCookie(tx: SignInTx): Promise<void> {
  const jar = await cookies();
  jar.set(cookieNames().signIn, await signSignInTx(tx), {
    ...cookieOptions(),
    maxAge: SIGN_IN_TX_MAX_AGE,
  });
}

/** Reads and clears the transaction cookie: one sign-in attempt, one use. */
export async function consumeSignInCookie(): Promise<SignInTx | null> {
  const jar = await cookies();
  const name = cookieNames().signIn;
  const tx = await verifySignInTx(jar.get(name)?.value);
  jar.set(name, "", { ...cookieOptions(), maxAge: 0 });
  return tx;
}

/**
 * The check for mutations and private data: a valid cookie and a user record
 * that still carries the same session version (one read). Returns `null` for
 * a session that was revoked ("sign out everywhere") or whose account is gone.
 */
export async function requireUser(): Promise<{
  session: Session;
  user: User;
} | null> {
  const session = await getSession();
  if (!session) return null;
  const user = await getUser(session.uid);
  if (!user || user.sv !== session.sv) return null;
  return { session, user };
}

/**
 * The last step of every sign-in, whichever way the identity was proven:
 * create or refresh the account, decide Pro, start the session.
 *
 * `accessToken` is only used for the star check and then goes out of scope
 * with the request. It is never written anywhere.
 */
export async function completeSignIn(
  profile: GitHubUser,
  options: { accessToken?: string } = {},
): Promise<User> {
  const user = await upsertUser({
    id: String(profile.id),
    login: profile.login,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
  });
  await decideProAtSignIn(user, options);
  await setSessionCookie({
    uid: user.id,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
    sv: user.sv,
  });
  return user;
}

/**
 * 409 for a write that depends on the user's login while the login in their
 * account record is stale: they renamed themselves on GitHub and somebody
 * else registered the old name here. Signing in again refreshes it.
 */
export function loginChanged(): Response {
  return problem(409, {
    code: "login_changed",
    title: "Your GitHub login changed",
    detail:
      "The login this session was created with now belongs to another account.",
    resolution: "Sign in with GitHub again and retry.",
  });
}

type BodyResult<Body> =
  | { ok: true; body: Body }
  | { ok: false; response: Response };

/**
 * Whether the request declares a JSON body. The media type itself must be
 * `application/json`: a substring test would also accept
 * `text/plain; application/json`, which a cross-site form or a `no-cors`
 * fetch can send without a preflight.
 */
function isJsonRequest(request: Request): boolean {
  const [mediaType = ""] = (request.headers.get("content-type") ?? "").split(
    ";",
  );
  return mediaType.trim().toLowerCase() === "application/json";
}

/**
 * The body as text, or `null` once it exceeds `maxBytes`. Read chunk by chunk
 * and abandoned at the limit: `Content-Length` is optional (and a claim, not a
 * fact), so trusting it or buffering the whole body first would let a client
 * make the server hold as much as the platform accepts.
 */
async function readTextUpTo(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  // Decoded the way `request.text()` would: UTF-8, a leading BOM dropped.
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function readBody<Body>(
  request: Request,
  schema: z.ZodType<Body>,
  overrides: { instance: string; headers: Record<string, string> },
): Promise<BodyResult<Body>> {
  const fail = (response: Response) => ({ ok: false, response }) as const;
  if (!isJsonRequest(request)) {
    return fail(
      problem(415, {
        code: "unsupported_media_type",
        title: "Unsupported media type",
        detail: "Send a JSON body with Content-Type: application/json.",
        ...overrides,
      }),
    );
  }
  const tooLarge = () =>
    fail(
      problem(413, {
        code: "payload_too_large",
        title: "Request body too large",
        detail: `The body may be at most ${MAX_BODY_BYTES} bytes.`,
        ...overrides,
      }),
    );
  // The cheap refusal for honest clients; the read below enforces the limit.
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    return tooLarge();
  }
  const text = await readTextUpTo(request, MAX_BODY_BYTES);
  if (text === null) return tooLarge();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail(badRequest("The body is not valid JSON.", overrides));
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return fail(
      badRequest("The body failed validation. See `errors`.", {
        code: "invalid_body",
        ...overrides,
        extra: {
          errors: parsed.error.issues.map((issue) => ({
            path: issue.path.map(String).join("."),
            message: issue.message,
          })),
        },
      }),
    );
  }
  return { ok: true, body: parsed.data };
}

/** What a handler behind `withUser` receives. */
export interface AuthedRequest<Body> {
  user: User;
  session: Session;
  /** The validated JSON body, when a schema was given. */
  body: Body;
}

/**
 * The front door of every cookie-authenticated JSON route, so no handler can
 * forget a step. In order: same-origin check for writes, session and user
 * record, per-user rate limit, then body validation.
 *
 * Every response leaves as `private, no-store`, whatever the handler set: what
 * is behind this function belongs to one user, so no cache may ever keep it.
 * The `RateLimit` headers are added unless the handler set its own. A database
 * outage becomes a 503 problem instead of an opaque 500. Any other exception
 * is rethrown on purpose: Next.js implements `redirect()` and `notFound()` by
 * throwing, so a catch-all here would swallow the framework's own signals.
 */
export async function withUser<Body = undefined>(
  request: Request,
  options: { policy: PolicyName; body?: z.ZodType<Body> },
  handler: (context: AuthedRequest<Body>) => Promise<Response>,
): Promise<Response> {
  const instance = new URL(request.url).pathname;
  const base = { instance, headers: { ...PRIVATE_NO_STORE } };
  const safe = request.method === "GET" || request.method === "HEAD";
  if (!safe && !isSameOrigin(request)) {
    return forbidden("Cross-origin requests cannot change account data.", {
      code: "cross_origin_request",
      ...base,
    });
  }
  try {
    const auth = await requireUser();
    if (!auth) return unauthorized(undefined, base);

    const rate = await limit(options.policy, `u:${auth.user.id}`);
    if (!rate.ok) return rateLimited(rate, base);
    const headers = { ...PRIVATE_NO_STORE, ...rate.headers };

    let body = undefined as Body;
    if (options.body) {
      const read = await readBody(request, options.body, { instance, headers });
      if (!read.ok) return read.response;
      body = read.body;
    }

    const response = await handler({ ...auth, body });
    for (const [name, value] of Object.entries(rate.headers)) {
      if (!response.headers.has(name)) response.headers.set(name, value);
    }
    // Forced, not defaulted: a problem built inside the handler arrives with a
    // bare `no-store`, and a handler must not be able to opt a private
    // response into a shared cache.
    response.headers.set("Cache-Control", PRIVATE_NO_STORE["Cache-Control"]);
    return response;
  } catch (error) {
    if (error instanceof StoreUnavailableError) {
      return unavailable(5, {
        detail: "The account store is temporarily unavailable.",
        ...base,
      });
    }
    throw error;
  }
}
