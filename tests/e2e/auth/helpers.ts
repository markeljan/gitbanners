/**
 * Shared helpers for the unit tests of the account layer.
 */
import { beforeAll, expect, mock } from "bun:test";
import {
  RequestCookies,
  ResponseCookies,
} from "next/dist/server/web/spec-extension/cookies";

/**
 * For test files that talk to a local server over real HTTP (the mock GitHub,
 * the Upstash REST shim). Call it at the top of the file.
 *
 * All test files share one process, and some replace `globalThis.fetch` with
 * a fake. One that is not put back would answer the requests of every file
 * that runs later, so these tests install the runtime's own `fetch` instead
 * of trusting whatever is there. It is left in place: it is the pristine one.
 */
export function installRealFetch(): void {
  beforeAll(() => {
    globalThis.fetch = Bun.fetch;
  });
}

/**
 * Sets (or, with `undefined`, removes) environment variables and returns a
 * function that restores the previous values.
 */
export function setEnv(vars: Record<string, string | undefined>): () => void {
  const previous: Record<string, string | undefined> = {};
  for (const name of Object.keys(vars)) previous[name] = process.env[name];
  const apply = (values: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  apply(vars);
  return () => apply(previous);
}

/** A valid `SESSION_SECRET`: base64 of 32 random bytes. */
export function randomSecret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64",
  );
}

const ROUTE_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/**
 * Asserts the method table of a route module: every method is answered by
 * the module itself (none is left to the framework's bare 405, which has no
 * `Allow` header and no body), each one outside `supported` is a 405 problem
 * naming the real ones, and `OPTIONS` lists the same.
 */
export async function expectMethodGuards(
  route: Record<string, unknown>,
  path: string,
  supported: readonly (typeof ROUTE_METHODS)[number][],
): Promise<void> {
  const allow = [
    ...supported,
    ...(supported.includes("GET") ? ["HEAD"] : []),
    "OPTIONS",
  ].join(", ");
  for (const method of ROUTE_METHODS) {
    expect(`${method}: ${typeof route[method]}`).toBe(`${method}: function`);
    if (supported.includes(method)) continue;
    const refuse = route[method] as (request: Request) => Response;
    const response = refuse(
      new Request(`http://localhost:3000${path}`, { method }),
    );
    expect(`${method}: ${response.status}`).toBe(`${method}: 405`);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json",
    );
    expect(response.headers.get("allow")).toBe(allow);
    expect(await response.json()).toMatchObject({
      status: 405,
      code: "method_not_allowed",
      instance: path,
    });
  }
  const options = (route.OPTIONS as () => Response)();
  expect(options.status).toBe(204);
  expect(options.headers.get("allow")).toBe(allow);
}

/** Handle on the fake `cookies()` jar: one simulated request at a time. */
export interface FakeCookies {
  /** Starts a new request with the given `Cookie` header. */
  request(cookieHeader?: string): void;
  /** The `Set-Cookie` lines written during the current request. */
  written(): string[];
  /**
   * The `Cookie` header a browser would send next: the current request's
   * cookies with the written ones applied (empty value or Max-Age=0 removes).
   */
  nextCookieHeader(): string;
}

/**
 * Replaces `cookies()` from `next/headers` with a jar backed by Next's own
 * cookie classes, so tests see the exact `Set-Cookie` strings the framework
 * would emit. Call it at the top of a test file, before importing the module
 * under test.
 */
export function installFakeCookies(): FakeCookies {
  let incoming = new RequestCookies(new Headers());
  let headers = new Headers();
  // One instance per request, as in Next: it serialises the cookie objects it
  // was given. (Re-parsing its own header lines would drop `Max-Age=0`.)
  let outgoing = new ResponseCookies(headers);
  mock.module("next/headers", () => ({
    cookies: async () => ({
      get: (name: string) => incoming.get(name),
      set: (...args: Parameters<ResponseCookies["set"]>) => {
        outgoing.set(...args);
      },
      delete: (...args: Parameters<ResponseCookies["delete"]>) => {
        outgoing.delete(...args);
      },
    }),
  }));
  return {
    request(cookieHeader = "") {
      incoming = new RequestCookies(
        new Headers(cookieHeader ? { cookie: cookieHeader } : {}),
      );
      headers = new Headers();
      outgoing = new ResponseCookies(headers);
    },
    written: () => headers.getSetCookie(),
    nextCookieHeader() {
      const jar = new Map<string, string>();
      for (const { name, value } of incoming.getAll()) jar.set(name, value);
      for (const cookie of outgoing.getAll()) {
        if (cookie.value === "" || cookie.maxAge === 0) jar.delete(cookie.name);
        else jar.set(cookie.name, cookie.value);
      }
      return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    },
  };
}
