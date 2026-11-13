/**
 * Stateless, signed (HS256) JWTs via jose. No Next.js imports, so everything
 * here is unit-testable anywhere.
 *
 * Two token types share `SESSION_SECRET` and are kept apart by audience, so
 * one can never be replayed as the other:
 *
 *   aud "gb:session"  the session cookie (30 days, re-issued after a day)
 *   aud "gb:signin"   the 10-minute sign-in transaction cookie
 *                     (state + PKCE verifier + return path)
 *
 * `SESSION_SECRET` is base64 of at least 32 random bytes. During a rotation
 * `SESSION_SECRET_PREVIOUS` keeps tokens signed with the old secret valid.
 */
import { errors, type JWTPayload, jwtVerify, SignJWT } from "jose";

const ISSUER = "gitbanners";
const AUDIENCE_SESSION = "gb:session";
const AUDIENCE_SIGN_IN = "gb:signin";
const MIN_SECRET_BYTES = 32;

/** Seconds. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
/** Re-issue the session cookie once it is older than this (sliding expiry). */
export const SESSION_REFRESH_AFTER = 60 * 60 * 24;
/**
 * GitHub's authorization codes live ten minutes, so the transaction does too.
 */
export const SIGN_IN_TX_MAX_AGE = 60 * 10;

/** What a verified session cookie says. Display data only, no secrets. */
export interface Session {
  /** GitHub numeric user id as a string: the key of the user record. */
  uid: string;
  login: string;
  name: string | null;
  avatarUrl: string;
  /** Must equal the user record's `sv`; bumping that revokes every cookie. */
  sv: number;
  /** Issued-at and expiry, seconds since the epoch. */
  iat: number;
  exp: number;
}

/** What a session is made from; the timestamps are set when signing. */
export type SessionClaims = Omit<Session, "iat" | "exp">;

/** State of one sign-in round trip, kept in a short-lived cookie. */
export interface SignInTx {
  state: string;
  codeVerifier: string;
  /** Validated same-origin path to send the user back to. */
  returnTo: string;
}

/**
 * The active secret first, then the previous one if a rotation is under way.
 */
function secretKeys(): Uint8Array[] {
  const keys: Uint8Array[] = [];
  for (const name of ["SESSION_SECRET", "SESSION_SECRET_PREVIOUS"] as const) {
    const raw = process.env[name];
    if (!raw) continue;
    // Buffer, not Uint8Array.fromBase64: that one is missing on Node 24.
    const bytes = new Uint8Array(Buffer.from(raw, "base64"));
    if (bytes.byteLength < MIN_SECRET_BYTES) {
      throw new Error(`${name} must be base64 of at least 32 bytes`);
    }
    keys.push(bytes);
  }
  if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is not set");
  return keys;
}

/**
 * Whether sessions can be issued at all. Lets routes answer "accounts are not
 * configured" instead of failing with a stack trace.
 */
export function hasSessionSecret(): boolean {
  try {
    return secretKeys().length > 0;
  } catch {
    return false;
  }
}

async function sign(
  claims: JWTPayload,
  audience: string,
  maxAgeSeconds: number,
): Promise<string> {
  const [activeKey] = secretKeys();
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(activeKey);
}

async function verify(
  token: string,
  audience: string,
): Promise<JWTPayload | null> {
  let keys: Uint8Array[];
  try {
    keys = secretKeys();
  } catch {
    // Without a usable secret nobody can be signed in. Verification runs on
    // every request, so it answers "invalid" instead of throwing.
    return null;
  }
  for (const key of keys) {
    try {
      const { payload } = await jwtVerify(token, key, {
        // Pinned: the algorithm in the token header is attacker-controlled.
        algorithms: ["HS256"],
        issuer: ISSUER,
        audience,
        requiredClaims: ["iat", "exp"],
      });
      return payload;
    } catch (error) {
      // A bad signature may just mean "signed with the other secret". Anything
      // else (expired, wrong audience, malformed) is final.
      if (error instanceof errors.JWSSignatureVerificationFailed) continue;
      return null;
    }
  }
  return null;
}

/** Mints the value of the session cookie, valid for `SESSION_MAX_AGE`. */
export function signSession(session: SessionClaims): Promise<string> {
  return sign(
    {
      sub: session.uid,
      login: session.login,
      name: session.name,
      avatarUrl: session.avatarUrl,
      sv: session.sv,
    },
    AUDIENCE_SESSION,
    SESSION_MAX_AGE,
  );
}

/**
 * The session a cookie value stands for, or `null` for anything that is not
 * a currently valid session token (missing, forged, expired, another type).
 */
export async function verifySession(
  token: string | undefined,
): Promise<Session | null> {
  if (!token) return null;
  const payload = await verify(token, AUDIENCE_SESSION);
  if (
    !payload ||
    typeof payload.sub !== "string" ||
    typeof payload.login !== "string" ||
    typeof payload.sv !== "number" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }
  return {
    uid: payload.sub,
    login: payload.login,
    name: typeof payload.name === "string" ? payload.name : null,
    avatarUrl: typeof payload.avatarUrl === "string" ? payload.avatarUrl : "",
    sv: payload.sv,
    iat: payload.iat,
    exp: payload.exp,
  };
}

/**
 * Mints the value of the transaction cookie. Signed so the callback can trust
 * the `state` and return path it reads back.
 */
export function signSignInTx(tx: SignInTx): Promise<string> {
  return sign(
    { state: tx.state, cv: tx.codeVerifier, rt: tx.returnTo },
    AUDIENCE_SIGN_IN,
    SIGN_IN_TX_MAX_AGE,
  );
}

/** The transaction a cookie value stands for, or `null`. */
export async function verifySignInTx(
  token: string | undefined,
): Promise<SignInTx | null> {
  if (!token) return null;
  const payload = await verify(token, AUDIENCE_SIGN_IN);
  if (
    !payload ||
    typeof payload.state !== "string" ||
    typeof payload.cv !== "string" ||
    typeof payload.rt !== "string"
  ) {
    return null;
  }
  return {
    state: payload.state,
    codeVerifier: payload.cv,
    returnTo: payload.rt,
  };
}
