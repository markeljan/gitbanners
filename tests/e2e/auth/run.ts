/**
 * HTTP suite for accounts: sign-in, sessions, saved banners, Pro, rate limits
 * and account deletion, driven over real HTTP against `next dev`.
 *
 *   bun tests/e2e/auth/run.ts                 all variants
 *   bun tests/e2e/auth/run.ts memory          JSON-file store only
 *   bun tests/e2e/auth/run.ts upstash         Upstash REST shim only
 *   bun tests/e2e/auth/run.ts unconfigured    a deployment without Redis
 *
 * The script starts everything itself and stops it again: a mock GitHub, the
 * Upstash REST shim, and `bunx next dev -p 3111` once per variant with an
 * environment pointing at those. Port 3111 must be free and no other
 * `next dev` may be running in this checkout.
 *
 * Nothing here talks to github.com. The GitHub CLI is replaced by a stub that
 * is first on PATH, so the developer's real `gh` token is never read, and the
 * server under test runs behind a proxy that refuses every connection that is
 * not to this machine: whatever part of the app tries to reach the internet
 * (with the stub token, for instance) fails fast instead.
 * All state lives in a fresh temporary directory (honours TMPDIR), removed
 * again when every check passed and kept, with the server logs, otherwise.
 *
 * Not named *.test.ts on purpose: `bun test` must not pick it up.
 * Exit code 0 when every check passed.
 */
import { type ChildProcess, spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Redis } from "@upstash/redis";
import { SignJWT } from "jose";
import {
  MOCK_CLIENT_ID,
  MOCK_CLIENT_SECRET,
  type MockGitHub,
  STUB_CLI_TOKEN,
  startMockGitHub,
} from "./mock-github";
import { startUpstashShim, type UpstashShim } from "./upstash-shim";

const PORT = 3111;
const APP = `http://localhost:${PORT}`;
const REPO_ROOT = resolve(import.meta.dir, "../../..");
const VARIANTS = ["memory", "upstash", "unconfigured"] as const;
type Variant = (typeof VARIANTS)[number];

const BANNER_ID = /^b[0-9a-z]{11}$/;
const PROBLEM = "application/problem+json";
const SAME_ORIGIN = { "sec-fetch-site": "same-origin", origin: APP };
const JSON_BODY = { "content-type": "application/json" };

// ---------------------------------------------------------------- reporting

const totals = { passed: 0, failed: 0 };
let current = { passed: 0, failed: 0 };

function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) current.passed++;
  else current.failed++;
  const extra =
    detail === undefined
      ? ""
      : `  ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
  // Details only on failure keep a green run readable.
  console.info(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : extra}`);
}

// ------------------------------------------------------------ HTTP plumbing

/** A minimal browser cookie jar. */
class Jar {
  cookies = new Map<string, string>();
  /** The `Set-Cookie` lines of the last response. */
  last: string[] = [];

  absorb(response: Response): void {
    this.last = response.headers.getSetCookie();
    for (const line of this.last) {
      const [pair = "", ...attributes] = line.split(";").map((s) => s.trim());
      const at = pair.indexOf("=");
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      const maxAge = attributes
        .find((attribute) => /^max-age=/i.test(attribute))
        ?.split("=")[1];
      if (value === "" || maxAge === "0") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  copy(): Jar {
    const jar = new Jar();
    jar.cookies = new Map(this.cookies);
    return jar;
  }

  /** Cookie names and attributes of the last response, values removed. */
  shapes(): string[] {
    return this.last.map((line) =>
      line.replace(/=[^;]*/, "=<v>").replace(/ Expires=[^;]+;/, ""),
    );
  }
}

type Init = Omit<RequestInit, "headers"> & { headers?: Record<string, string> };

async function send(
  jar: Jar,
  path: string,
  init: Init = {},
): Promise<Response> {
  const response = await fetch(path.startsWith("http") ? path : APP + path, {
    redirect: "manual",
    ...init,
    headers: {
      ...(jar.cookies.size > 0 ? { cookie: jar.header() } : {}),
      ...init.headers,
    },
  });
  jar.absorb(response);
  return response;
}

const json = (body: unknown): Init => ({
  body: JSON.stringify(body),
  headers: { ...JSON_BODY, ...SAME_ORIGIN },
});

/** A raw request where the `Host` header can be anything. */
function rawGet(
  path: string,
  headers: Record<string, string>,
): Promise<number | undefined> {
  return new Promise((done, fail) => {
    const request = httpRequest(
      { host: "127.0.0.1", port: PORT, path, headers },
      (response) => {
        response.resume();
        done(response.statusCode);
      },
    );
    request.on("error", fail);
    request.end();
  });
}

function portIsOpen(): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host: "127.0.0.1", port: PORT });
    socket.once("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.once("error", () => done(false));
  });
}

// ---------------------------------------------------------- network sandbox

interface Sandbox {
  url: string;
  /** First request line of every connection that was refused. */
  refused: string[];
  stop(): void;
}

/**
 * An HTTP proxy that refuses everything. With `NODE_USE_ENV_PROXY=1` Node
 * sends every request that is not to a `NO_PROXY` host through it, which makes
 * it the outbound firewall of the server under test.
 */
function startSandbox(): Promise<Sandbox> {
  const refused: string[] = [];
  const server = createServer((socket) => {
    socket.once("data", (chunk) => {
      refused.push(chunk.toString("latin1").split("\r\n")[0] ?? "");
      socket.end(
        "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
    });
    socket.on("error", () => {});
  });
  return new Promise((ready) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      ready({
        url: `http://127.0.0.1:${port}`,
        refused,
        stop: () => server.close(),
      });
    });
  });
}

// ------------------------------------------------------------- dev server

interface Server {
  child: ChildProcess;
  log: string;
}

/** The server currently running, so an interrupt can take it down too. */
let running: Server | undefined;

async function startNext(
  env: Record<string, string>,
  log: string,
): Promise<Server> {
  if (await portIsOpen()) {
    throw new Error(`Port ${PORT} is in use. Stop whatever listens there.`);
  }
  const out = openSync(log, "a");
  const child = spawn("bunx", ["next", "dev", "-p", String(PORT)], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    // Its own process group, so the whole tree can be stopped at once.
    detached: true,
    stdio: ["ignore", out, out],
  });
  running = { child, log };
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`next dev exited early. See ${log}`);
    }
    const ready = await fetch(`${APP}/api/me`)
      .then((response) => response.status === 200)
      .catch(() => false);
    if (ready) return running;
    await Bun.sleep(250);
  }
  await stopNext(running);
  throw new Error(`next dev did not become ready. See ${log}`);
}

async function stopNext(server: Server): Promise<void> {
  const { pid } = server.child;
  if (pid === undefined) return;
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch {
      // The group is already gone.
    }
  };
  signalGroup("SIGTERM");
  for (let i = 0; i < 40 && (await portIsOpen()); i++) await Bun.sleep(250);
  if (await portIsOpen()) {
    signalGroup("SIGKILL");
    await Bun.sleep(500);
  }
  if (running === server) running = undefined;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    const stopped = running ? stopNext(running) : Promise.resolve();
    stopped.finally(() => process.exit(130));
  });
}

// ------------------------------------------------------------------ flows

interface Context {
  mock: MockGitHub;
  secret: string;
}

/**
 * start → consent on the mock. Returns the callback URL GitHub redirects to.
 */
async function beginSignIn(
  jar: Jar,
  returnTo = "/studio",
): Promise<{ authorize: URL; callbackUrl: string; start: Response }> {
  const start = await send(
    jar,
    `/api/auth/github?returnTo=${encodeURIComponent(returnTo)}`,
  );
  const authorize = new URL(start.headers.get("location") ?? "http://invalid");
  const consent = await fetch(authorize, { redirect: "manual" });
  return {
    authorize,
    callbackUrl: consent.headers.get("location") ?? "",
    start,
  };
}

/** The whole round trip, the way the "check again" button does it. */
async function signIn(jar: Jar, returnTo = "/studio"): Promise<Response> {
  const { callbackUrl } = await beginSignIn(jar, returnTo);
  return send(jar, callbackUrl);
}

async function me(jar: Jar): Promise<{
  user: { id: string; login: string } | null;
  pro: boolean;
  entitlements: { plan: string; maxSavedBanners: number };
  banners: { count: number; max: number };
}> {
  return (await send(jar, "/api/me")).json();
}

const bannerBody = {
  name: "My banner",
  target: { kind: "owner", login: "Octo-Test" },
};

// ------------------------------------------------------------ the checks

async function accountSuite({ mock }: Context): Promise<void> {
  const setMock = (patch: Partial<MockGitHub["state"]>) =>
    Object.assign(mock.state, patch);
  setMock({
    starred: false,
    deny: false,
    checkNeedsScope: false,
    starListTruncated: false,
    user: { id: 4242, login: "Octo-Test", name: null },
  });

  // ---- anonymous
  const anonymous = new Jar();
  {
    const response = await send(anonymous, "/api/me");
    const body = await response.json();
    check(
      "anonymous /api/me: user null on the free plan",
      response.status === 200 &&
        body.user === null &&
        body.pro === false &&
        body.entitlements.plan === "free" &&
        body.entitlements.maxSavedBanners === 3 &&
        body.banners.count === 0 &&
        body.banners.max === 3,
      body,
    );
    check(
      "/api/me is private, no-store and varies on Cookie",
      response.headers.get("cache-control") === "private, no-store" &&
        /cookie/i.test(response.headers.get("vary") ?? ""),
      [response.headers.get("cache-control"), response.headers.get("vary")],
    );
    const list = await send(anonymous, "/api/banners");
    const problem = await list.json();
    check(
      "anonymous /api/banners: 401 problem+json",
      list.status === 401 &&
        list.headers.get("content-type") === PROBLEM &&
        problem.code === "unauthorized" &&
        problem.status === 401 &&
        typeof problem.type === "string",
      problem,
    );
    const write = await send(anonymous, "/api/banners", {
      method: "POST",
      ...json(bannerBody),
    });
    check("anonymous POST /api/banners: 401", write.status === 401);
    const remove = await send(anonymous, "/api/me", {
      method: "DELETE",
      headers: SAME_ORIGIN,
    });
    check("anonymous DELETE /api/me: 401", remove.status === 401);
  }

  // ---- start
  const jar = new Jar();
  const begun = await beginSignIn(jar);
  {
    const { start, authorize } = begun;
    check(
      "start: 302 to the GitHub authorize endpoint",
      start.status === 302 &&
        authorize.origin === mock.url &&
        authorize.pathname === "/login/oauth/authorize",
      start.headers.get("location"),
    );
    check(
      "start: client id, callback URL, state, PKCE, and no scope",
      [...authorize.searchParams.keys()].sort().join() ===
        "allow_signup,client_id,code_challenge,code_challenge_method,redirect_uri,state" &&
        authorize.searchParams.get("client_id") === MOCK_CLIENT_ID &&
        authorize.searchParams.get("redirect_uri") ===
          `${APP}/api/auth/github/callback`,
      Object.fromEntries(authorize.searchParams),
    );
    check(
      "start: PKCE S256 challenge and state are 43 characters",
      authorize.searchParams.get("code_challenge")?.length === 43 &&
        authorize.searchParams.get("state")?.length === 43 &&
        authorize.searchParams.get("code_challenge_method") === "S256",
    );
    check(
      "start: one HttpOnly, SameSite=Lax transaction cookie for ten minutes",
      jar.shapes().join() ===
        "gb_signin=<v>; Path=/; Max-Age=600; HttpOnly; SameSite=lax",
      jar.shapes(),
    );
    const again = await send(new Jar(), "/api/auth/github");
    check(
      "start: a fresh state per request (not prerendered)",
      new URL(again.headers.get("location") ?? APP).searchParams.get(
        "state",
      ) !== authorize.searchParams.get("state"),
    );
    check("start: no-store", start.headers.get("cache-control") === "no-store");
    check(
      "consent: GitHub sends the browser to our callback",
      begun.callbackUrl.startsWith(`${APP}/api/auth/github/callback?`),
      begun.callbackUrl.replace(/=[^&]+/g, "=…"),
    );
  }

  // ---- callback, attacked
  {
    const stranger = await send(new Jar(), begun.callbackUrl);
    check(
      "callback without the transaction cookie: state_mismatch",
      stranger.status === 303 &&
        stranger.headers.get("location") === "/?auth_error=state_mismatch",
      stranger.headers.get("location"),
    );
    const forged = await send(
      jar.copy(),
      begun.callbackUrl.replace(/state=[^&]+/, "state=attacker"),
    );
    check(
      "callback with a forged state: state_mismatch",
      forged.headers.get("location") === "/studio?auth_error=state_mismatch",
      forged.headers.get("location"),
    );
  }

  // ---- callback
  const transactionJar = jar.copy();
  const callback = await send(jar, begun.callbackUrl);
  {
    check(
      "callback: 303 to returnTo",
      callback.status === 303 && callback.headers.get("location") === "/studio",
      callback.headers.get("location"),
    );
    check(
      "callback: transaction cookie cleared, session and hint cookies set",
      jar.shapes().join("|") ===
        [
          "gb_signin=<v>; Path=/; Max-Age=0; HttpOnly; SameSite=lax",
          "gb_session=<v>; Path=/; Max-Age=2592000; HttpOnly; SameSite=lax",
          "gb_in=<v>; Path=/; Max-Age=2592000; SameSite=lax",
        ].join("|"),
      jar.shapes(),
    );
    check(
      "callback: no-store, and a referrer policy that keeps its query private",
      callback.headers.get("cache-control") === "no-store" &&
        // The site-wide policy from next.config.ts: origin only across origins.
        [
          "no-referrer",
          "same-origin",
          "strict-origin",
          "strict-origin-when-cross-origin",
        ].includes(callback.headers.get("referrer-policy") ?? ""),
      [
        callback.headers.get("cache-control"),
        callback.headers.get("referrer-policy"),
      ],
    );
    check(
      "browser now holds the session and hint cookies only",
      [...jar.cookies.keys()].sort().join() === "gb_in,gb_session" &&
        jar.cookies.get("gb_in") === "1",
      [...jar.cookies.keys()],
    );
    const replay = await send(jar.copy(), begun.callbackUrl);
    check(
      "replaying the callback URL without the transaction cookie fails",
      replay.headers.get("location") === "/studio?auth_error=state_mismatch" ||
        replay.headers.get("location") === "/?auth_error=state_mismatch",
      replay.headers.get("location"),
    );
    const stolen = await send(transactionJar, begun.callbackUrl);
    check(
      "replaying it with the cookie fails too: the code is spent",
      stolen.headers.get("location") === "/studio?auth_error=expired_code",
      stolen.headers.get("location"),
    );
  }

  // ---- session
  {
    const response = await send(jar, "/api/me");
    const body = await response.json();
    check(
      "/api/me: the signed-in user on the free plan",
      body.user?.id === "4242" &&
        body.user?.login === "Octo-Test" &&
        body.user?.name === null &&
        body.user?.avatarUrl ===
          "https://avatars.githubusercontent.com/u/4242?v=4" &&
        body.pro === false &&
        body.entitlements.plan === "free" &&
        body.banners.count === 0 &&
        body.banners.max === 3,
      body,
    );
    check(
      "/api/me exposes exactly id, login, name and avatarUrl of the user",
      Object.keys(body.user ?? {})
        .sort()
        .join() === "avatarUrl,id,login,name" &&
        Object.keys(body).sort().join() === "banners,entitlements,pro,user",
      body,
    );
    const forged = new Jar();
    forged.cookies.set("gb_session", "not-a-jwt");
    check(
      "a forged session cookie is nobody",
      (await me(forged)).user === null,
    );
  }

  // ---- CSRF
  {
    const attempts: [string, Record<string, string>][] = [
      [
        "Sec-Fetch-Site: cross-site",
        { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
      ],
      [
        "Sec-Fetch-Site: same-site",
        { "sec-fetch-site": "same-site", origin: "https://sub.gitbanners.dev" },
      ],
      [
        "a foreign Origin and no Fetch Metadata",
        { origin: "https://evil.example" },
      ],
      ["neither Origin nor Sec-Fetch-Site", {}],
    ];
    for (const [label, headers] of attempts) {
      const response = await send(jar, "/api/banners", {
        method: "POST",
        body: JSON.stringify(bannerBody),
        headers: { ...JSON_BODY, ...headers },
      });
      const body = await response.json();
      check(
        `POST with ${label}: 403`,
        response.status === 403 &&
          response.headers.get("content-type") === PROBLEM &&
          body.code === "cross_origin_request",
        body,
      );
    }
    check(
      "none of the blocked writes created anything",
      (await me(jar)).banners.count === 0,
    );
  }

  // ---- saved banners
  const created: string[] = [];
  {
    const first = await send(jar, "/api/banners", {
      method: "POST",
      ...json({
        name: "  First  ",
        target: { kind: "repo", owner: "vercel", name: "next.js" },
        preset: "contributors",
        query: "?theme=dark&size=x",
      }),
    });
    const body = await first.json();
    created.push(body.banner?.id);
    check(
      "create: 201 with the stored banner",
      first.status === 201 &&
        BANNER_ID.test(body.banner?.id) &&
        body.banner.userId === "4242" &&
        body.banner.name === "First" &&
        body.banner.target.kind === "repo" &&
        body.banner.preset === "contributors" &&
        body.banner.query === "theme=dark&size=x" &&
        body.banner.isDefault === false &&
        body.banner.createdAt === body.banner.updatedAt &&
        !Number.isNaN(Date.parse(body.banner.createdAt)),
      body,
    );
    check(
      "create: Location, private no-store and the mutations rate-limit headers",
      first.headers.get("location") === `/api/banners/${body.banner?.id}` &&
        first.headers.get("cache-control") === "private, no-store" &&
        first.headers.get("ratelimit-policy") === '"mutations";q=30;w=60' &&
        /^"mutations";r=\d+;t=\d+$/.test(first.headers.get("ratelimit") ?? ""),
      [...first.headers],
    );
    for (const name of ["Second", "Third"]) {
      const response = await send(jar, "/api/banners", {
        method: "POST",
        ...json({ ...bannerBody, name }),
      });
      created.push((await response.json()).banner?.id);
    }
    check(
      "three banners fit the free plan",
      created.every((id) => BANNER_ID.test(id)) && new Set(created).size === 3,
      created,
    );

    const over = await send(jar, "/api/banners", {
      method: "POST",
      ...json(bannerBody),
    });
    const limit = await over.json();
    check(
      "a fourth: 403 banner_limit_reached",
      over.status === 403 &&
        limit.code === "banner_limit_reached" &&
        limit.limit === 3 &&
        limit.plan === "free" &&
        typeof limit.resolution === "string",
      limit,
    );

    const invalid = await send(jar, "/api/banners", {
      method: "POST",
      ...json({ name: "", target: { kind: "repo", owner: "not a login" } }),
    });
    const problem = await invalid.json();
    check(
      "invalid body: 400 listing each field",
      invalid.status === 400 &&
        problem.code === "invalid_body" &&
        Array.isArray(problem.errors) &&
        problem.errors.some((e: { path: string }) => e.path === "name") &&
        problem.errors.some((e: { path: string }) =>
          e.path.startsWith("target"),
        ),
      problem,
    );
    const unknownKey = await send(jar, "/api/banners", {
      method: "POST",
      ...json({ ...bannerBody, userId: "1" }),
    });
    check("unknown keys are rejected: 400", unknownKey.status === 400);
    const notJson = await send(jar, "/api/banners", {
      method: "POST",
      body: "{ nope",
      headers: { ...JSON_BODY, ...SAME_ORIGIN },
    });
    check("a body that is not JSON: 400", notJson.status === 400);
    const form = await send(jar, "/api/banners", {
      method: "POST",
      body: "name=x",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...SAME_ORIGIN,
      },
    });
    check("a form-encoded body: 415", form.status === 415);
    // What a cross-site form can send without a preflight.
    const disguised = await send(jar, "/api/banners", {
      method: "POST",
      body: JSON.stringify(bannerBody),
      headers: {
        "content-type": "text/plain; application/json",
        ...SAME_ORIGIN,
      },
    });
    check(
      "JSON under a text/plain media type: 415",
      disguised.status === 415 &&
        disguised.headers.get("content-type") === PROBLEM,
    );
    const oversized = await send(jar, "/api/banners", {
      method: "POST",
      body: JSON.stringify({ ...bannerBody, query: "a".repeat(20_000) }),
      headers: { ...JSON_BODY, ...SAME_ORIGIN },
    });
    check(
      "a body over 16 KiB: 413 problem",
      oversized.status === 413 &&
        (await oversized.json()).code === "payload_too_large",
    );

    const list = await send(jar, "/api/banners");
    const listed = await list.json();
    check(
      "list: most recently updated first, with the api rate-limit policy",
      list.status === 200 &&
        listed.banners.map((b: { id: string }) => b.id).join() ===
          [...created].reverse().join() &&
        listed.banners.every((b: { isDefault: boolean }) => !b.isDefault) &&
        list.headers.get("ratelimit-policy") === '"api";q=120;w=60',
      listed,
    );

    const one = await send(jar, `/api/banners/${created[0]}`);
    check(
      "get one",
      one.status === 200 && (await one.json()).banner.name === "First",
    );

    const patch = await send(jar, `/api/banners/${created[0]}`, {
      method: "PATCH",
      ...json({
        name: "Renamed",
        target: { kind: "owner", login: "torvalds" },
        preset: null,
        query: "",
      }),
    });
    const patched = await patch.json();
    check(
      "patch: changes what was sent, keeps the rest",
      patch.status === 200 &&
        patched.banner.id === created[0] &&
        patched.banner.name === "Renamed" &&
        patched.banner.target.login === "torvalds" &&
        patched.banner.preset === null &&
        patched.banner.query === "" &&
        patched.banner.updatedAt > patched.banner.createdAt,
      patched,
    );
    const resorted = await (await send(jar, "/api/banners")).json();
    check(
      "patch: the list is re-sorted",
      resorted.banners[0]?.id === created[0],
    );
    const empty = await send(jar, `/api/banners/${created[0]}`, {
      method: "PATCH",
      ...json({}),
    });
    check("patch with nothing to change: 400", empty.status === 400);

    const freeDefault = await send(jar, `/api/banners/${created[0]}`, {
      method: "PATCH",
      ...json({ isDefault: true }),
    });
    const refused = await freeDefault.json();
    check(
      "free plan cannot set a default banner: 403 pro_required",
      freeDefault.status === 403 &&
        refused.code === "pro_required" &&
        /star/i.test(refused.resolution),
      refused,
    );

    for (const id of ["b00000000000", "nope", "..%2Fuser%3A4242"]) {
      const missing = await send(jar, `/api/banners/${id}`, {
        method: "PATCH",
        ...json({ name: "x" }),
      });
      check(
        `patch /api/banners/${id}: 404 problem, private`,
        missing.status === 404 &&
          missing.headers.get("content-type") === PROBLEM &&
          missing.headers.get("cache-control") === "private, no-store" &&
          (await missing.json()).code === "not_found",
        [...missing.headers],
      );
    }

    const removed = await send(jar, `/api/banners/${created[1]}`, {
      method: "DELETE",
      headers: SAME_ORIGIN,
    });
    check("delete: 204", removed.status === 204);
    const again = await send(jar, `/api/banners/${created[1]}`, {
      method: "DELETE",
      headers: SAME_ORIGIN,
    });
    check("delete again: 404", again.status === 404);
    check(
      "/api/me counts the remaining banners",
      (await me(jar)).banners.count === 2,
    );
  }

  // ---- Pro
  {
    setMock({ starred: true });
    check(
      "starring alone changes nothing until the next check",
      (await me(jar)).pro === false,
    );

    mock.requests.length = 0;
    const again = await signIn(jar);
    const status = await me(jar);
    check(
      '"check again" is a silent sign-in round trip that finds the star',
      again.headers.get("location") === "/studio" &&
        status.pro === true &&
        status.entitlements.plan === "pro" &&
        status.banners.max === 50 &&
        status.banners.count === 2,
      status,
    );
    check(
      "the star was read with the user's own token",
      mock.requests.includes("GET /user/starred/acme/gitbanners"),
      mock.requests,
    );

    const makeDefault = await send(jar, `/api/banners/${created[0]}`, {
      method: "PATCH",
      ...json({ isDefault: true }),
    });
    check(
      "Pro: set the default banner",
      makeDefault.status === 200 &&
        (await makeDefault.json()).banner.isDefault === true,
    );
    await send(jar, `/api/banners/${created[2]}`, {
      method: "PATCH",
      ...json({ isDefault: true }),
    });
    const afterSwitch = await (await send(jar, "/api/banners")).json();
    check(
      "only one banner is the default",
      afterSwitch.banners
        .filter((b: { isDefault: boolean }) => b.isDefault)
        .map((b: { id: string }) => b.id)
        .join() === created[2],
      afterSwitch,
    );
    const cleared = await send(jar, `/api/banners/${created[2]}`, {
      method: "PATCH",
      ...json({ isDefault: false }),
    });
    check(
      "clear the default",
      cleared.status === 200 &&
        (await cleared.json()).banner.isDefault === false,
    );

    const extra: string[] = [];
    for (let i = 0; i < 2; i++) {
      const response = await send(jar, "/api/banners", {
        method: "POST",
        ...json({ ...bannerBody, name: `Pro ${i}`, isDefault: i === 1 }),
      });
      const body = await response.json();
      extra.push(body.banner?.id);
      if (i === 1) {
        check(
          "Pro: more than three banners, created as the default in one call",
          response.status === 201 && body.banner.isDefault === true,
          body,
        );
      }
    }
    const gone = await send(jar, `/api/banners/${extra[1]}`, {
      method: "DELETE",
      headers: SAME_ORIGIN,
    });
    const afterDelete = await (await send(jar, "/api/banners")).json();
    check(
      "deleting the default banner clears the pointer",
      gone.status === 204 &&
        afterDelete.banners.length === 3 &&
        afterDelete.banners.every((b: { isDefault: boolean }) => !b.isDefault),
      afterDelete,
    );

    setMock({ checkNeedsScope: true });
    mock.requests.length = 0;
    await signIn(jar);
    check(
      "a star the check endpoint hides is found in the star list",
      (await me(jar)).pro === true &&
        mock.requests.includes("GET /user/starred"),
      mock.requests,
    );

    setMock({ starred: false, checkNeedsScope: false });
    await signIn(jar);
    const downgraded = await me(jar);
    check(
      "un-starred: the next sign-in ends Pro, saved banners stay",
      downgraded.pro === false &&
        downgraded.banners.max === 3 &&
        downgraded.banners.count === 3,
      downgraded,
    );
    const blocked = await send(jar, "/api/banners", {
      method: "POST",
      ...json(bannerBody),
    });
    check("back on the free quota", blocked.status === 403);
  }

  // ---- someone else's banners
  {
    setMock({ user: { id: 7171, login: "Mallory", name: null } });
    const mallory = new Jar();
    await signIn(mallory);
    const target = `/api/banners/${created[0]}`;
    const before = await (await send(jar, target)).json();
    const unknown = await (
      await send(mallory, "/api/banners/b00000000000")
    ).text();
    const read = await send(mallory, target);
    check(
      "another user's banner: GET is 404, exactly like an unknown id",
      (await me(mallory)).user?.login === "Mallory" &&
        read.status === 404 &&
        read.headers.get("content-type") === PROBLEM &&
        (await read.text()) === unknown,
    );
    const attempts: [string, Init][] = [
      ["PATCH name", { method: "PATCH", ...json({ name: "Hacked" }) }],
      ["PATCH default", { method: "PATCH", ...json({ isDefault: false }) }],
      ["DELETE", { method: "DELETE", headers: SAME_ORIGIN }],
    ];
    for (const [label, init] of attempts) {
      const response = await send(mallory, target, init);
      check(
        `another user's banner: ${label} is 404`,
        response.status === 404 && (await response.json()).code === "not_found",
      );
    }
    const theirs = await (await send(mallory, "/api/banners")).json();
    const after = await (await send(jar, target)).json();
    check(
      "another user's banner: untouched, and in nobody else's list",
      theirs.banners.length === 0 &&
        before.banner?.id === created[0] &&
        JSON.stringify(after) === JSON.stringify(before),
      { theirs, after },
    );

    // A megabyte sent in chunks, so no Content-Length announces it.
    const megabyte = new ReadableStream<Uint8Array>({
      start(controller) {
        const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
        for (let i = 0; i < 16; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const streamed = await send(mallory, "/api/banners", {
      method: "POST",
      body: megabyte,
      headers: { ...JSON_BODY, ...SAME_ORIGIN },
      duplex: "half",
    } as Init);
    check(
      "a large body without Content-Length: 413, read no further than the limit",
      streamed.status === 413 &&
        streamed.headers.get("content-type") === PROBLEM &&
        (await streamed.json()).code === "payload_too_large",
      streamed.status,
    );
    setMock({ user: { id: 4242, login: "Octo-Test", name: null } });
  }

  // ---- allowlist
  const allowlisted = new Jar();
  {
    setMock({ user: { id: 5151, login: "Allow-Listed", name: "Al" } });
    mock.requests.length = 0;
    await signIn(allowlisted);
    const status = await me(allowlisted);
    check(
      "PRO_LOGINS: Pro without a star",
      status.user?.login === "Allow-Listed" && status.pro === true,
      status,
    );
    check(
      "PRO_LOGINS: decided without any star request",
      !mock.requests.some((request) => request.includes("/user/starred")),
      mock.requests,
    );
  }

  // ---- development sign-in through the (stub) GitHub CLI
  {
    setMock({
      user: { id: 6161, login: "Dev-User", name: null },
      starred: true,
    });
    mock.requests.length = 0;
    const dev = new Jar();
    const response = await send(dev, "/api/auth/dev?returnTo=/studio");
    check(
      "dev sign-in: 303 with a session, and the marker a build is checked for",
      response.status === 303 &&
        response.headers.get("location") === "/studio" &&
        dev.cookies.has("gb_session") &&
        response.headers.get("x-gitbanners-dev-sign-in") ===
          "gb-dev-signin-via-gh-cli",
      [response.status, response.headers.get("location")],
    );
    check(
      "dev sign-in: the CLI token is used for GET /user and nothing else",
      mock.requests.join() === "GET /user",
      mock.requests,
    );
    const status = await me(dev);
    check(
      "dev sign-in: signed in, star not looked up with the CLI token",
      status.user?.login === "Dev-User" && status.pro === false,
      status,
    );
    check(
      "dev sign-in: a foreign Host header gets 404",
      (await rawGet("/api/auth/dev", { Host: "gitbanners.vercel.app" })) ===
        404,
    );
    check(
      "dev sign-in: a forwarded host gets 404",
      (await rawGet("/api/auth/dev", {
        Host: `localhost:${PORT}`,
        "X-Forwarded-Host": "gitbanners.vercel.app",
      })) === 404,
    );
    const offSite = await send(
      new Jar(),
      `/api/auth/dev?returnTo=${encodeURIComponent("/.//evil.example")}`,
    );
    check(
      "dev sign-in: returnTo cannot leave the site",
      offSite.headers.get("location") === "/",
      offSite.headers.get("location"),
    );
    setMock({ starred: false });
  }

  // ---- mutations rate limit (the allowlisted user, so nobody else is blocked)
  {
    const response = await send(allowlisted, "/api/banners", {
      method: "POST",
      ...json(bannerBody),
    });
    const id = (await response.json()).banner?.id;
    let blocked: Response | undefined;
    let allowed = 1;
    for (let i = 0; i < 40 && !blocked; i++) {
      const patch = await send(allowlisted, `/api/banners/${id}`, {
        method: "PATCH",
        ...json({ name: `Name ${i}` }),
      });
      if (patch.status === 429) blocked = patch;
      else allowed++;
    }
    const body = blocked ? await blocked.json() : null;
    check(
      "the 31st write within a minute: 429 problem with Retry-After",
      // 31 when the burst straddles a window boundary of the sliding window.
      (allowed === 30 || allowed === 31) &&
        blocked?.headers.get("content-type") === PROBLEM &&
        Number(blocked?.headers.get("retry-after")) >= 1 &&
        /^"mutations";r=0;t=\d+$/.test(
          blocked?.headers.get("ratelimit") ?? "",
        ) &&
        blocked?.headers.get("ratelimit-policy") === '"mutations";q=30;w=60' &&
        body?.code === "rate_limited" &&
        body?.["violated-policies"]?.[0] === "mutations",
      { allowed, body, headers: blocked ? [...blocked.headers] : null },
    );
    const read = await send(allowlisted, "/api/banners");
    check("reads have their own budget", read.status === 200);
    check(
      "another user is not affected",
      (
        await send(jar, `/api/banners/${created[0]}`, {
          method: "PATCH",
          ...json({ name: "Still fine" }),
        })
      ).status === 200,
    );
  }

  // ---- sign out
  setMock({ user: { id: 4242, login: "Octo-Test", name: null } });
  {
    const viaGet = await send(jar, "/api/auth/signout");
    const refusal = await viaGet.json().catch(() => null);
    check(
      "GET /api/auth/signout: 405 problem with Allow, and the session survives",
      viaGet.status === 405 &&
        viaGet.headers.get("content-type") === PROBLEM &&
        viaGet.headers.get("allow") === "POST, OPTIONS" &&
        refusal?.code === "method_not_allowed" &&
        (await me(jar)).user?.id === "4242",
      [viaGet.status, ...viaGet.headers],
    );
    // Wrong methods everywhere else: never the framework's bare 405.
    const wrongMethods: [string, string, string][] = [
      ["PUT", "/api/banners", "GET, POST, HEAD, OPTIONS"],
      ["DELETE", "/api/banners", "GET, POST, HEAD, OPTIONS"],
      [
        "POST",
        `/api/banners/${created[0]}`,
        "GET, PATCH, DELETE, HEAD, OPTIONS",
      ],
      ["POST", "/api/me", "GET, DELETE, HEAD, OPTIONS"],
      ["POST", "/api/auth/github", "GET, HEAD, OPTIONS"],
      [
        "POST",
        "/api/auth/github/callback?code=x&state=y",
        "GET, HEAD, OPTIONS",
      ],
    ];
    for (const [method, path, allow] of wrongMethods) {
      const response = await send(new Jar(), path, {
        method,
        headers: SAME_ORIGIN,
      });
      const body = await response.json().catch(() => null);
      check(
        `${method} ${path.split("?")[0]}: 405 problem, Allow: ${allow}`,
        response.status === 405 &&
          response.headers.get("content-type") === PROBLEM &&
          response.headers.get("allow") === allow &&
          body?.code === "method_not_allowed" &&
          response.headers.getSetCookie().length === 0,
        [response.status, ...response.headers],
      );
    }
    const options = await send(new Jar(), "/api/banners", {
      method: "OPTIONS",
    });
    check(
      "OPTIONS lists what a route really supports, without CORS headers",
      options.status === 204 &&
        options.headers.get("allow") === "GET, POST, HEAD, OPTIONS" &&
        !options.headers.has("access-control-allow-origin"),
      [options.status, ...options.headers],
    );
    const head = await send(jar, "/api/me", { method: "HEAD" });
    check(
      "HEAD /api/me: 200, private, no body",
      head.status === 200 &&
        head.headers.get("cache-control") === "private, no-store" &&
        (await head.text()) === "",
    );
    const crossSite = await send(jar, "/api/auth/signout", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
    });
    check(
      "a cross-site sign-out is blocked",
      crossSite.status === 403 && jar.cookies.has("gb_session"),
    );
    const otherDevice = jar.copy();
    const out = await send(jar, "/api/auth/signout?everywhere=1", {
      method: "POST",
      headers: SAME_ORIGIN,
    });
    check(
      "sign-out: 303 to /, both cookies cleared",
      out.status === 303 &&
        out.headers.get("location") === "/" &&
        jar.cookies.size === 0 &&
        jar.shapes().join("|") ===
          "gb_session=<v>; Path=/; Max-Age=0; HttpOnly; SameSite=lax|gb_in=<v>; Path=/; Max-Age=0; SameSite=lax",
      jar.shapes(),
    );
    // Kept aside: a copy of the revoked cookie, as a thief would hold it.
    const stale = otherDevice.copy();
    const revoked = await send(otherDevice, "/api/me");
    check(
      "everywhere=1 signs the other device out and clears its cookies",
      (await revoked.json()).user === null && otherDevice.cookies.size === 0,
      otherDevice.shapes(),
    );
    await signIn(jar);
    const replayed = await send(stale, "/api/auth/signout?everywhere=1", {
      method: "POST",
      headers: SAME_ORIGIN,
    });
    check(
      "a revoked cookie cannot sign the user out everywhere again",
      replayed.status === 303 &&
        stale.cookies.size === 0 &&
        (await me(jar)).user?.id === "4242",
    );
    const viaFetch = await send(jar, "/api/auth/signout", {
      method: "POST",
      headers: { ...SAME_ORIGIN, accept: "application/json" },
    });
    check(
      "sign-out from fetch: 200 JSON, cookies cleared",
      viaFetch.status === 200 &&
        (await viaFetch.json()).ok === true &&
        jar.cookies.size === 0,
    );
  }

  // ---- account deletion
  {
    await signIn(jar);
    const before = await me(jar);
    const old = jar.copy();
    const crossSite = await send(jar, "/api/me", {
      method: "DELETE",
      headers: { "sec-fetch-site": "cross-site" },
    });
    check(
      "a cross-site account deletion is blocked",
      crossSite.status === 403 && (await me(jar)).user !== null,
    );
    const deleted = await send(jar, "/api/me", {
      method: "DELETE",
      headers: SAME_ORIGIN,
    });
    check(
      "DELETE /api/me: 204, signed out",
      before.banners.count === 3 &&
        deleted.status === 204 &&
        jar.cookies.size === 0,
      [deleted.status, jar.shapes()],
    );
    check(
      "the old cookie is nobody now",
      (await me(old.copy())).user === null &&
        (await send(old.copy(), "/api/banners")).status === 401,
    );
    await signIn(jar);
    const fresh = await me(jar);
    check(
      "signing in again starts from an empty account",
      fresh.user?.id === "4242" && fresh.banners.count === 0,
      fresh,
    );
    check(
      "a cookie from before the deletion stays dead after re-registering",
      (await send(old, "/api/banners")).status === 401,
    );
  }

  // ---- declined, and open redirects
  {
    setMock({ deny: true });
    const declined = new Jar();
    const { callbackUrl } = await beginSignIn(
      declined,
      "https://evil.example/phish",
    );
    const response = await send(declined, callbackUrl);
    check(
      "declined on GitHub: back to / with access_denied, off-site returnTo dropped",
      response.headers.get("location") === "/?auth_error=access_denied" &&
        !declined.cookies.has("gb_session"),
      response.headers.get("location"),
    );
    setMock({ deny: false });
    for (const target of [
      "/.//evil.example",
      "//evil.example",
      "/\\evil.example",
      "/api/auth/github",
    ]) {
      const response = await signIn(new Jar(), target);
      check(
        `returnTo=${target} ends up at /`,
        response.status === 303 && response.headers.get("location") === "/",
        response.headers.get("location"),
      );
    }
    // Line breaks in the value: no header of the attacker's making.
    const split = new Jar();
    const injected = await signIn(split, "/x\r\nSet-Cookie: planted=1");
    check(
      "returnTo with CR LF cannot add a response header",
      injected.status === 303 &&
        injected.headers.get("location") === "/xSet-Cookie:%20planted=1" &&
        !split.cookies.has("planted") &&
        split.last.every((line) => /^gb_(signin|session|in)=/.test(line)),
      [injected.headers.get("location"), split.shapes()],
    );
  }

  // ---- sign-in rate limit, last: it blocks these addresses for ten minutes
  {
    const attempt = async (address: string) => {
      const ip = { "x-forwarded-for": address };
      const visitor = new Jar();
      const start = await send(visitor, "/api/auth/github?returnTo=/studio", {
        headers: ip,
      });
      const state = new URL(
        start.headers.get("location") ?? APP,
      ).searchParams.get("state");
      // A made-up code: passes the limiter, then fails at GitHub.
      const response = await send(
        visitor,
        `/api/auth/github/callback?code=junk&state=${state}`,
        { headers: ip },
      );
      return response.headers.get("location");
    };
    const burst = async (label: string, addressOf: (i: number) => string) => {
      const outcomes: (string | null)[] = [];
      for (let i = 0; i < 22; i++) outcomes.push(await attempt(addressOf(i)));
      const firstBlocked = outcomes.indexOf("/studio?auth_error=rate_limited");
      check(
        label,
        // 21 when the burst straddles a window boundary of the sliding window.
        (firstBlocked === 20 || firstBlocked === 21) &&
          outcomes
            .slice(0, firstBlocked)
            .every(
              (location) => location === "/studio?auth_error=expired_code",
            ),
        outcomes.slice(-4),
      );
    };
    await burst(
      "20 sign-in attempts per address per ten minutes, then rate_limited",
      () => "203.0.113.50",
    );
    await burst(
      "an IPv6 client is limited by its /64: rotating addresses does not help",
      (i) => `2001:db8:abcd:12::${(i + 1).toString(16)}`,
    );
    const elsewhere = await signIn(new Jar());
    check(
      "other addresses can still sign in",
      elsewhere.headers.get("location") === "/studio",
      elsewhere.headers.get("location"),
    );
  }
}

async function unconfiguredSuite({ secret }: Context): Promise<void> {
  const start = await send(new Jar(), "/api/auth/github?returnTo=/studio");
  const text = await start.text();
  const problem = JSON.parse(text);
  check(
    "no database: starting sign-in is a clear 503 problem",
    start.status === 503 &&
      start.headers.get("content-type") === PROBLEM &&
      problem.code === "accounts_unavailable" &&
      problem.title === "Accounts are not configured on this deployment" &&
      start.headers.getSetCookie().length === 0,
    problem,
  );
  check("…and it does not name the protocol", !/oauth/i.test(text), text);

  const anonymous = await (await send(new Jar(), "/api/me")).json();
  check(
    "no database: /api/me answers user null",
    anonymous.user === null && anonymous.pro === false,
    anonymous,
  );

  // A cookie that verifies must still not be anybody.
  const signed = new Jar();
  signed.cookies.set(
    "gb_session",
    await new SignJWT({ login: "Octo-Test", name: null, avatarUrl: "", sv: 1 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("4242")
      .setIssuer("gitbanners")
      .setAudience("gb:session")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new Uint8Array(Buffer.from(secret, "base64"))),
  );
  const withCookie = await send(signed, "/api/me");
  check(
    "no database: a valid session cookie is still nobody, and is left alone",
    (await withCookie.json()).user === null &&
      withCookie.headers.getSetCookie().length === 0,
  );
  check(
    "no database: /api/banners is 401",
    (await send(signed, "/api/banners")).status === 401,
  );
  const callback = await send(
    new Jar(),
    "/api/auth/github/callback?code=x&state=y",
  );
  check(
    "no database: the callback sends the browser back with an error",
    callback.status === 303 &&
      callback.headers.get("location") === "/?auth_error=state_mismatch",
    callback.headers.get("location"),
  );
  check(
    "a hosting-platform marker switches the dev sign-in route off",
    (await send(new Jar(), "/api/auth/dev")).status === 404,
  );
}

// ---------------------------------------------------------------- variants

function randomSecret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64",
  );
}

async function runVariant(variant: Variant, workDir: string): Promise<void> {
  current = { passed: 0, failed: 0 };
  console.info(`\n=== ${variant} ===`);
  const mock = startMockGitHub();
  const sandbox = await startSandbox();
  let shim: UpstashShim | undefined;
  let server: Server | undefined;
  const secret = randomSecret();
  const storeFile = join(workDir, `${variant}-store.json`);
  const log = join(workDir, `${variant}-next-dev.log`);

  // An empty string overrides whatever a local .env file may define.
  const env: Record<string, string> = {
    PATH: `${join(workDir, "bin")}:${process.env.PATH ?? ""}`,
    NEXT_TELEMETRY_DISABLED: "1",
    SESSION_SECRET: secret,
    SESSION_SECRET_PREVIOUS: "",
    GITHUB_CLIENT_ID: MOCK_CLIENT_ID,
    GITHUB_CLIENT_SECRET: MOCK_CLIENT_SECRET,
    GITHUB_WEB_URL: mock.url,
    GITHUB_API_URL: mock.url,
    PRO_REPO: "acme/gitbanners",
    PRO_LOGINS: "someone-else, allow-listed",
    GITBANNERS_DEV_GH_LOGIN: "1",
    GB_STORE_FILE: storeFile,
    KEY_NAMESPACE: "",
    KV_REST_API_URL: "",
    KV_REST_API_TOKEN: "",
    UPSTASH_REDIS_REST_URL: "",
    UPSTASH_REDIS_REST_TOKEN: "",
    // No real GitHub credential may reach the server under test.
    GITHUB_TOKEN: "",
    GH_TOKEN: "",
    // Outbound firewall: only this machine is reachable.
    NODE_USE_ENV_PROXY: "1",
    HTTP_PROXY: sandbox.url,
    HTTPS_PROXY: sandbox.url,
    NO_PROXY: "127.0.0.1,localhost,::1",
  };
  if (variant === "upstash") {
    shim = startUpstashShim();
    env.KV_REST_API_URL = shim.url;
    env.KV_REST_API_TOKEN = shim.token;
  }
  if (variant === "unconfigured") env.VERCEL_ENV = "preview";

  try {
    server = await startNext(env, log);
    const context: Context = { mock, secret };
    if (variant === "unconfigured") await unconfiguredSuite(context);
    else await accountSuite(context);

    if (variant === "memory") {
      const text = readFileSync(storeFile, "utf8");
      const keys = Object.keys(JSON.parse(text).docs);
      check(
        "store file: owner-only, and it holds no GitHub token",
        (statSync(storeFile).mode & 0o777) === 0o600 &&
          !/gho_|ghr_/.test(text) &&
          !keys.some((key) => key.startsWith("tok:")) &&
          keys.some((key) => key.startsWith("user:")),
        keys,
      );
    }
    if (shim) {
      const redis = new Redis({ url: shim.url, token: shim.token });
      const keys = await redis.keys("*");
      check(
        "Redis: every key is namespaced and none holds a token",
        keys.length > 0 &&
          keys.every((key) => key.startsWith("gb:")) &&
          !keys.some((key) => key.includes("tok:")) &&
          !/gho_|ghr_/.test(JSON.stringify(shim.requests)),
        keys,
      );
      check(
        "Redis: the limiter and the store ran through the real clients",
        keys.some((key) => key.startsWith("gb:rl:mutations")) &&
          keys.some((key) => key.startsWith("gb:user:")),
        keys,
      );
    }
    const serverLog = readFileSync(log, "utf8");
    check(
      "server log: no token, code or secret was written",
      !serverLog.includes(STUB_CLI_TOKEN) &&
        !serverLog.includes("gho_mock_") &&
        !serverLog.includes(secret),
    );
  } finally {
    if (server) await stopNext(server);
    mock.stop();
    shim?.stop();
    sandbox.stop();
  }
  check(`port ${PORT} is free again`, !(await portIsOpen()));
  if (sandbox.refused.length > 0) {
    const targets = [...new Set(sandbox.refused)].join(", ");
    console.info(
      `note: ${sandbox.refused.length} outbound connection(s) refused by the sandbox: ${targets}`,
    );
  }
  console.info(
    `--- ${variant}: ${current.passed} passed, ${current.failed} failed`,
  );
  totals.passed += current.passed;
  totals.failed += current.failed;
}

const requested = process.argv.slice(2);
const unknown = requested.filter(
  (name) => !(VARIANTS as readonly string[]).includes(name),
);
if (unknown.length > 0) {
  console.error(
    `Unknown variant: ${unknown.join(", ")}. Use ${VARIANTS.join(", ")}.`,
  );
  process.exit(2);
}
const variants = requested.length > 0 ? (requested as Variant[]) : VARIANTS;

const workDir = mkdtempSync(join(tmpdir(), "gb-e2e-auth-"));
mkdirSync(join(workDir, "bin"));
const stubGh = join(workDir, "bin", "gh");
writeFileSync(
  stubGh,
  `#!/bin/sh\n# Stand-in for the GitHub CLI. Never touches real credentials.\nif [ "$1" = "auth" ] && [ "$2" = "token" ]; then echo "${STUB_CLI_TOKEN}"; exit 0; fi\necho "stub gh: unsupported arguments: $*" >&2\nexit 1\n`,
);
chmodSync(stubGh, 0o755);

let crashed = false;
for (const variant of variants) {
  try {
    await runVariant(variant, workDir);
  } catch (error) {
    crashed = true;
    console.error(`${variant}: aborted:`, error);
  }
}
const allPassed = totals.failed === 0 && !crashed;
console.info(
  `\n${allPassed ? "ALL PASS" : "FAILED"}: ${totals.passed} passed, ${totals.failed} failed`,
);
// The server logs and store files are only worth keeping after a failure.
if (allPassed) rmSync(workDir, { recursive: true, force: true });
else console.info(`Server logs and store files: ${workDir}`);
process.exit(allPassed ? 0 : 1);
