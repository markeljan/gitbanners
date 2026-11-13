import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import {
  installFakeCookies,
  installRealFetch,
  randomSecret,
  setEnv,
} from "../../../tests/e2e/auth/helpers";
import {
  type MockGitHub,
  STUB_CLI_TOKEN,
  startMockGitHub,
} from "../../../tests/e2e/auth/mock-github";

installRealFetch();

// Must be in place before the module under test is evaluated.
const cookies = installFakeCookies();

const { getUser } = await import("../db/users");
const { setStore } = await import("../store");
const { MemoryStore } = await import("../store/memory");
const { devLoginAllowed, devSignIn } = await import("./dev-auth");
const { getSession } = await import("./session");

const stubDirs: string[] = [];

/**
 * A directory holding a stand-in `gh` that prints `output` for
 * `gh auth token`. Tests put ONLY this directory on PATH, so the real GitHub
 * CLI, and with it a real token, is out of reach by construction.
 */
function stubGh(output: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "gb-stub-gh-"));
  stubDirs.push(dir);
  if (output !== null) {
    const file = join(dir, "gh");
    writeFileSync(
      file,
      `#!/bin/sh\nif [ "$1" = "auth" ] && [ "$2" = "token" ]; then echo "${output}"; exit 0; fi\nexit 1\n`,
    );
    chmodSync(file, 0o755);
  }
  return dir;
}

const DEV = {
  NODE_ENV: "development",
  GITBANNERS_DEV_GH_LOGIN: "1",
  VERCEL: undefined,
  VERCEL_ENV: undefined,
  VERCEL_URL: undefined,
  AWS_LAMBDA_FUNCTION_NAME: undefined,
};

const request = (
  headers: Record<string, string> = { host: "localhost:3000" },
  query = "",
) => new NextRequest(`http://localhost:3000/api/auth/dev${query}`, { headers });

let mock: MockGitHub;
let store = new MemoryStore();
let restore = () => {};
beforeAll(() => {
  mock = startMockGitHub();
});
afterAll(() => {
  mock.stop();
  for (const dir of stubDirs) rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  restore = setEnv({
    ...DEV,
    SESSION_SECRET: randomSecret(),
    GITHUB_API_URL: mock.url,
    GITHUB_WEB_URL: mock.url,
    // Star checks off: only the sign-in itself is under test here.
    // The server-side stargazer lookup must stay offline in unit tests.
    GITHUB_TOKEN: undefined,
    PRO_REPO: "disabled",
    PRO_LOGINS: undefined,
    PATH: stubGh(STUB_CLI_TOKEN),
  });
  store = new MemoryStore();
  setStore(store);
  cookies.request();
  mock.requests.length = 0;
  mock.state.user = { id: 4242, login: "Octo-Test", name: null };
});
afterEach(() => {
  restore();
  setStore(undefined);
});

describe("devLoginAllowed: every guard must pass", () => {
  test("development, flag set, loopback host", () => {
    for (const host of [
      "localhost",
      "localhost:3000",
      "127.0.0.1:3111",
      "[::1]:3000",
    ]) {
      expect(devLoginAllowed(request({ host }))).toBe(true);
    }
  });

  test("NODE_ENV must be development", () => {
    for (const mode of ["production", "test", undefined]) {
      setEnv({ NODE_ENV: mode });
      expect(devLoginAllowed(request())).toBe(false);
    }
  });

  test("the opt-in flag must be exactly 1", () => {
    for (const flag of [undefined, "", "0", "true", "yes"]) {
      setEnv({ GITBANNERS_DEV_GH_LOGIN: flag });
      expect(devLoginAllowed(request())).toBe(false);
    }
  });

  test("any hosting-platform marker disables it", () => {
    for (const marker of [
      "VERCEL",
      "VERCEL_ENV",
      "VERCEL_URL",
      "AWS_LAMBDA_FUNCTION_NAME",
    ]) {
      const undo = setEnv({ [marker]: "1" });
      expect(devLoginAllowed(request())).toBe(false);
      undo();
    }
    expect(devLoginAllowed(request())).toBe(true);
  });

  test("the request must be addressed to this machine", () => {
    for (const host of [
      "gitbanners.vercel.app",
      "192.168.1.20:3000",
      "localhost.evil.example",
      "evil.example:3000",
      "",
    ]) {
      expect(devLoginAllowed(request({ host }))).toBe(false);
    }
    // Missing Host header altogether.
    expect(devLoginAllowed(request({}))).toBe(false);
  });

  test("a tunnel or proxy in front shows up as a forwarded host", () => {
    expect(
      devLoginAllowed(
        request({
          host: "localhost:3000",
          "x-forwarded-host": "abc.tunnel.example",
        }),
      ),
    ).toBe(false);
    expect(
      devLoginAllowed(
        request({
          host: "localhost:3000",
          "x-forwarded-host": "localhost:3000",
        }),
      ),
    ).toBe(true);
  });
});

describe("devSignIn", () => {
  test("when not allowed it looks like a route that does not exist", async () => {
    setEnv({ GITBANNERS_DEV_GH_LOGIN: undefined });
    const response = await devSignIn(request());
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    // Nothing gives the route away, the marker header included.
    expect([...response.headers.keys()]).toEqual([]);
    expect(mock.requests).toEqual([]);
    expect(cookies.written()).toEqual([]);
  });

  test("the build marker is a string the module uses, not a comment", async () => {
    // Compiled chunks carry no comments, so the CI guard
    // (`! grep -rq --exclude-dir=dev gb-dev-signin-via-gh-cli .next`) can only
    // rely on a string literal that survives compilation.
    const source = await Bun.file(
      new URL("./dev-auth.ts", import.meta.url),
    ).text();
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(withoutComments).toContain('"gb-dev-signin-via-gh-cli"');
  });

  test("signs in as the CLI user with a single GitHub request", async () => {
    const response = await devSignIn(
      request({ host: "localhost:3000" }, "?returnTo=/studio%3Fx=1"),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/studio?x=1");
    expect(response.headers.get("cache-control")).toBe("no-store");
    // The string a CI step greps the production build for.
    expect(response.headers.get("x-gitbanners-dev-sign-in")).toBe(
      "gb-dev-signin-via-gh-cli",
    );
    // Identity only: the developer's token is never used for the star check.
    expect(mock.requests).toEqual(["GET /user"]);

    expect(await getUser("4242")).toMatchObject({ login: "Octo-Test" });
    cookies.request(cookies.nextCookieHeader());
    expect(await getSession()).toMatchObject({ uid: "4242" });
  });

  test("the CLI token is stored nowhere", async () => {
    await devSignIn(request());
    const dump = JSON.stringify([
      await store.mget(["user:4242", "pro:4242", "login:octo-test"]),
      cookies.written(),
    ]);
    expect(dump).not.toContain(STUB_CLI_TOKEN);
  });

  test("returnTo cannot leave the site", async () => {
    for (const target of ["https://evil.example", "/.//evil.example", "//x"]) {
      const response = await devSignIn(
        request(
          { host: "localhost:3000" },
          `?returnTo=${encodeURIComponent(target)}`,
        ),
      );
      expect(response.headers.get("location")).toBe("/");
    }
  });

  test("no gh binary, or gh not logged in: a clear problem, no session", async () => {
    setEnv({ PATH: stubGh(null) });
    const missing = await devSignIn(request());
    expect(missing.status).toBe(500);
    expect(await missing.json()).toMatchObject({ code: "gh_cli_unavailable" });

    setEnv({ PATH: stubGh("") });
    const loggedOut = await devSignIn(request());
    expect(loggedOut.status).toBe(500);
    expect(await loggedOut.json()).toMatchObject({
      code: "gh_cli_not_logged_in",
    });
    expect(cookies.written()).toEqual([]);
    expect(mock.requests).toEqual([]);
  });

  test("a token GitHub rejects is a 502, and is not echoed back", async () => {
    setEnv({ PATH: stubGh("gho_not_known_to_the_mock") });
    const response = await devSignIn(request());
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ code: "github_unreachable" });
    expect(text).not.toContain("gho_not_known_to_the_mock");
    expect(await getUser("4242")).toBeNull();
  });

  test("without a session secret it says what to configure", async () => {
    setEnv({ SESSION_SECRET: undefined });
    const response = await devSignIn(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      code: "accounts_unavailable",
    });
    expect(mock.requests).toEqual([]);
  });
});
