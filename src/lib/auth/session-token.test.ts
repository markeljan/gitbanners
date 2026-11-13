import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { decodeJwt, decodeProtectedHeader, SignJWT } from "jose";
import { randomSecret, setEnv } from "../../../tests/e2e/auth/helpers";
import {
  hasSessionSecret,
  SESSION_MAX_AGE,
  SIGN_IN_TX_MAX_AGE,
  signSession,
  signSignInTx,
  verifySession,
  verifySignInTx,
} from "./session-token";

const claims = {
  uid: "4242",
  login: "Octo-Test",
  name: null,
  avatarUrl: "https://avatars.githubusercontent.com/u/4242?v=4",
  sv: 7,
};
const tx = {
  state: "s".repeat(43),
  codeVerifier: "v".repeat(43),
  returnTo: "/studio?x=1",
};

const secret = randomSecret();
const key = (value: string) => new Uint8Array(Buffer.from(value, "base64"));

let restore = () => {};
beforeEach(() => {
  restore = setEnv({
    SESSION_SECRET: secret,
    SESSION_SECRET_PREVIOUS: undefined,
  });
});
afterEach(() => restore());

describe("session token", () => {
  test("round trip", async () => {
    const token = await signSession(claims);
    const session = await verifySession(token);
    expect(session).toMatchObject(claims);
    expect(session?.exp).toBe((session?.iat ?? 0) + SESSION_MAX_AGE);
    expect(Math.abs((session?.iat ?? 0) - Date.now() / 1000)).toBeLessThan(5);
  });

  test("is an HS256 JWT with the documented claims and nothing secret", async () => {
    const token = await signSession({ ...claims, name: "Octo" });
    expect(decodeProtectedHeader(token)).toEqual({ alg: "HS256" });
    const payload = decodeJwt(token);
    expect(payload).toMatchObject({
      iss: "gitbanners",
      aud: "gb:session",
      sub: "4242",
      login: "Octo-Test",
      name: "Octo",
      sv: 7,
    });
    expect(Object.keys(payload).sort()).toEqual([
      "aud",
      "avatarUrl",
      "exp",
      "iat",
      "iss",
      "login",
      "name",
      "sub",
      "sv",
    ]);
  });

  test("rejects garbage, tampering and missing tokens", async () => {
    const token = await signSession(claims);
    const [header, payload, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...decodeJwt(token), sub: "1" }),
    ).toString("base64url");
    for (const bad of [
      undefined,
      "",
      "not-a-jwt",
      `${header}.${forged}.${signature}`,
      `${header}.${payload}.${signature.slice(0, -2)}xx`,
      `${header}.${payload}`,
    ]) {
      expect(await verifySession(bad)).toBeNull();
    }
  });

  test("rejects a token signed with another secret", async () => {
    const token = await signSession(claims);
    setEnv({ SESSION_SECRET: randomSecret() });
    expect(await verifySession(token)).toBeNull();
  });

  test("rotation: the previous secret still verifies, the new one signs", async () => {
    const old = await signSession(claims);
    const next = randomSecret();
    setEnv({ SESSION_SECRET: next, SESSION_SECRET_PREVIOUS: secret });
    expect(await verifySession(old)).toMatchObject(claims);
    const fresh = await signSession(claims);
    // Once the previous secret is retired, only tokens of the new one remain.
    setEnv({ SESSION_SECRET: next, SESSION_SECRET_PREVIOUS: undefined });
    expect(await verifySession(fresh)).toMatchObject(claims);
    expect(await verifySession(old)).toBeNull();
  });

  test("rejects expired tokens", async () => {
    const expired = await new SignJWT({ login: "Octo-Test", sv: 7 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("4242")
      .setIssuer("gitbanners")
      .setAudience("gb:session")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 100)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(key(secret));
    expect(await verifySession(expired)).toBeNull();
  });

  test("rejects other algorithms, issuers and incomplete claims", async () => {
    const base = (alg = "HS256") =>
      new SignJWT({ login: "Octo-Test", sv: 7 })
        .setProtectedHeader({ alg })
        .setSubject("4242")
        .setIssuer("gitbanners")
        .setAudience("gb:session")
        .setIssuedAt()
        .setExpirationTime("1h");
    expect(await verifySession(await base().sign(key(secret)))).not.toBeNull();

    // Signed with the right secret but another algorithm of the same family.
    const padded = new Uint8Array(64);
    padded.set(key(secret));
    expect(await verifySession(await base("HS512").sign(padded))).toBeNull();
    expect(await verifySession(await base("HS384").sign(padded))).toBeNull();
    // "alg: none" with an empty signature.
    const [, payload] = (await base().sign(key(secret))).split(".");
    const none = Buffer.from(JSON.stringify({ alg: "none" })).toString(
      "base64url",
    );
    expect(await verifySession(`${none}.${payload}.`)).toBeNull();

    const otherIssuer = await base().setIssuer("someone").sign(key(secret));
    expect(await verifySession(otherIssuer)).toBeNull();
    const noVersion = await new SignJWT({ login: "Octo-Test" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("4242")
      .setIssuer("gitbanners")
      .setAudience("gb:session")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(key(secret));
    expect(await verifySession(noVersion)).toBeNull();
    const noExpiry = await new SignJWT({ login: "Octo-Test", sv: 7 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("4242")
      .setIssuer("gitbanners")
      .setAudience("gb:session")
      .setIssuedAt()
      .sign(key(secret));
    expect(await verifySession(noExpiry)).toBeNull();
  });
});

describe("sign-in transaction token", () => {
  test("round trip, ten minutes", async () => {
    const token = await signSignInTx(tx);
    expect(await verifySignInTx(token)).toEqual(tx);
    const payload = decodeJwt(token);
    expect(payload.aud).toBe("gb:signin");
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(SIGN_IN_TX_MAX_AGE);
  });

  test("the two token types cannot stand in for each other", async () => {
    expect(await verifySession(await signSignInTx(tx))).toBeNull();
    expect(await verifySignInTx(await signSession(claims))).toBeNull();
    expect(await verifySignInTx(undefined)).toBeNull();
  });
});

describe("secret handling", () => {
  test("signing needs a secret of at least 32 bytes", async () => {
    setEnv({ SESSION_SECRET: undefined });
    expect(hasSessionSecret()).toBe(false);
    await expect(signSession(claims)).rejects.toThrow("SESSION_SECRET");

    setEnv({ SESSION_SECRET: Buffer.from("too short").toString("base64") });
    expect(hasSessionSecret()).toBe(false);
    await expect(signSession(claims)).rejects.toThrow("at least 32 bytes");

    setEnv({ SESSION_SECRET: secret });
    expect(hasSessionSecret()).toBe(true);
  });

  test("a too-short previous secret is a configuration error too", async () => {
    setEnv({ SESSION_SECRET_PREVIOUS: "c2hvcnQ=" });
    expect(hasSessionSecret()).toBe(false);
    await expect(signSession(claims)).rejects.toThrow(
      "SESSION_SECRET_PREVIOUS",
    );
  });

  test("verifying without a usable secret answers 'invalid', it does not throw", async () => {
    const token = await signSession(claims);
    setEnv({ SESSION_SECRET: undefined });
    expect(await verifySession(token)).toBeNull();
    expect(await verifySignInTx(token)).toBeNull();
  });
});
