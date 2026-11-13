/**
 * Test double for the Upstash Redis REST API: real HTTP and the real
 * `@upstash/redis` / `@upstash/ratelimit` clients, with Redis emulated by
 * ioredis-mock (Lua through fengari).
 *
 * Wire format (https://upstash.com/docs/redis/features/restapi):
 *
 *   POST /            ["CMD", ...args]     → {"result": …}
 *                                            or {"error": "…"} with HTTP 400
 *   POST /pipeline    [["CMD", ...], ...]  → [{"result": …} | {"error": "…"}]
 *   POST /multi-exec  [["CMD", ...], ...]  → [{"result": …}]
 *
 * It proves how our code and the real clients handle requests and replies,
 * not how Upstash's servers behave.
 */
import { createHash } from "node:crypto";
import RedisMock from "ioredis-mock";

/** A running shim: point `new Redis({ url, token })` at it. */
export interface UpstashShim {
  url: string;
  token: string;
  /** Every request received, oldest first. Cleared by `flush()`. */
  requests: { path: string; body: unknown }[];
  /** Artificial latency per request, for timeout tests. */
  delayMs: number;
  /** Empties the database and the request log. */
  flush(): Promise<void>;
  stop(): void;
}

type Command = (...args: string[]) => Promise<unknown>;

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");
// "#!lua flags=…" is Redis 7 syntax the emulator does not know.
const stripShebang = (script: string) => script.replace(/^#![^\n]*\n/, "\n");
const SET_OPTION = /^(nx|xx|ex|px|exat|pxat|keepttl|get)$/i;

let instances = 0;

/** Starts a shim with an empty database of its own. */
export function startUpstashShim(port = 0): UpstashShim {
  // The emulator shares data between instances with the same host and port,
  // so every shim gets a host of its own.
  const redis = new RedisMock({ host: `shim-${++instances}` });
  const commands = redis as unknown as Record<string, Command | undefined>;
  const token = "shim_token";
  const scripts = new Map<string, string>();

  async function run(command: unknown[]): Promise<unknown> {
    const [name = "", ...args] = command.map(String);
    const upper = name.toUpperCase();
    if (upper === "EVAL") {
      const script = stripShebang(args[0] ?? "");
      scripts.set(sha1(args[0] ?? ""), script);
      return commands.eval?.call(redis, script, ...args.slice(1));
    }
    if (upper === "EVALSHA") {
      const script = scripts.get(args[0] ?? "");
      if (!script) {
        throw new Error("NOSCRIPT No matching script. Please use EVAL.");
      }
      return commands.eval?.call(redis, script, ...args.slice(1));
    }
    if (upper === "SCRIPT" && args[0]?.toUpperCase() === "LOAD") {
      const source = args[1] ?? "";
      scripts.set(sha1(source), stripShebang(source));
      return sha1(source);
    }
    const fn = commands[name.toLowerCase()];
    if (typeof fn !== "function") {
      throw new Error(`ERR unknown command '${name}'`);
    }
    // The emulator only knows upper-case option keywords; Redis ignores case.
    const normalised =
      upper === "SET"
        ? args.map((arg, i) =>
            i >= 2 && SET_OPTION.test(arg) ? arg.toUpperCase() : arg,
          )
        : args;
    const result = await fn.apply(redis, normalised);
    return Buffer.isBuffer(result) ? result.toString() : result;
  }

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(request) {
      if (request.headers.get("authorization") !== `Bearer ${token}`) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const path = new URL(request.url).pathname;
      const body: unknown = await request.json();
      shim.requests.push({ path, body });
      if (shim.delayMs) await Bun.sleep(shim.delayMs);
      if (path === "/pipeline" || path === "/multi-exec") {
        const results: ({ result: unknown } | { error: string })[] = [];
        for (const command of body as unknown[][]) {
          try {
            results.push({ result: await run(command) });
          } catch (error) {
            results.push({ error: (error as Error).message });
          }
        }
        return Response.json(results);
      }
      try {
        return Response.json({ result: await run(body as unknown[]) });
      } catch (error) {
        return Response.json(
          { error: (error as Error).message },
          { status: 400 },
        );
      }
    },
  });

  const shim: UpstashShim = {
    url: `http://127.0.0.1:${server.port}`,
    token,
    requests: [],
    delayMs: 0,
    async flush() {
      await redis.flushall();
      shim.requests.length = 0;
    },
    stop() {
      server.stop(true);
    },
  };
  return shim;
}
