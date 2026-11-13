/**
 * Named rate-limit policies and the `RateLimit` response headers.
 *
 * Headers follow draft-ietf-httpapi-ratelimit-headers (structured fields):
 *
 *   RateLimit-Policy: "api";q=120;w=60
 *   RateLimit: "api";r=119;t=18
 *
 * The counting itself is done by the store: Lua on Upstash, a Map in memory.
 */
import { getStore, type RateLimitRule, type Store } from "@/lib/store";

/**
 * Every limit the app enforces, by name. The name is part of the Redis key
 * and of the response headers, so clients can tell which quota they hit.
 */
export const POLICIES = {
  /** JSON API reads, per user or per IP. */
  api: { name: "api", limit: 120, windowSeconds: 60 },
  /** Typeahead search: every call costs an upstream request. */
  search: { name: "search", limit: 60, windowSeconds: 60 },
  /** Writes to saved banners and the account, per user. */
  mutations: { name: "mutations", limit: 30, windowSeconds: 60 },
  /** Completed sign-in round trips, per IP. Each one costs a token exchange. */
  auth: { name: "auth", limit: 20, windowSeconds: 600 },
} as const satisfies Record<string, RateLimitRule>;

/** Name of one of the `POLICIES`. */
export type PolicyName = keyof typeof POLICIES;

/** The outcome of one `limit()` call, with headers ready to send. */
export interface LimitResult {
  /** False when the request must be refused with 429. */
  ok: boolean;
  policy: PolicyName;
  limit: number;
  remaining: number;
  /** Seconds until the window resets. */
  resetSeconds: number;
  /**
   * Ready to spread into a response: policy, counters, and `Retry-After` when
   * blocked.
   */
  headers: Record<string, string>;
}

function policyHeader(rule: RateLimitRule): string {
  return `"${rule.name}";q=${rule.limit};w=${rule.windowSeconds}`;
}

/**
 * Counts one request against `policy` for `identifier` (use `u:{userId}` or
 * `ip:{address}`).
 *
 * Fails open: when the limiter cannot answer, the request goes through and
 * only the static policy is advertised. Counters from a failed or timed-out
 * check are invented numbers and never become headers.
 */
export async function limit(
  policy: PolicyName,
  identifier: string,
  store: Store = getStore(),
): Promise<LimitResult> {
  const rule = POLICIES[policy];
  const open: LimitResult = {
    ok: true,
    policy,
    limit: rule.limit,
    remaining: rule.limit,
    resetSeconds: rule.windowSeconds,
    headers: { "RateLimit-Policy": policyHeader(rule) },
  };
  let outcome: Awaited<ReturnType<Store["rateLimit"]>>;
  try {
    outcome = await store.rateLimit(rule, identifier);
  } catch {
    return open;
  }
  if (outcome.degraded) return open;

  const remaining = Math.max(0, outcome.remaining);
  const resetSeconds = Math.max(
    0,
    Math.ceil((outcome.reset - Date.now()) / 1000),
  );
  const headers: Record<string, string> = {
    "RateLimit-Policy": policyHeader(rule),
    RateLimit: `"${rule.name}";r=${remaining};t=${resetSeconds}`,
  };
  // If both are present Retry-After wins, so it is only sent when blocked.
  if (!outcome.success)
    headers["Retry-After"] = String(Math.max(1, resetSeconds));
  return {
    ok: outcome.success,
    policy,
    limit: rule.limit,
    remaining,
    resetSeconds,
    headers,
  };
}

const LOOPBACK = "127.0.0.1";
/** One shared bucket for values that are not an address at all. */
const UNKNOWN_CLIENT = "unknown";
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HEXTET_RE = /^[0-9a-f]{1,4}$/i;

function ipv4(value: string): string | null {
  const octets = IPV4_RE.exec(value)?.slice(1).map(Number);
  return octets?.every((octet) => octet <= 255) ? octets.join(".") : null;
}

/** The eight groups of an IPv6 address with "::" expanded, or `null`. */
function ipv6Groups(value: string): number[] | null {
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const [head = [], tail] = halves.map((half) => (half ? half.split(":") : []));
  let groups = head;
  if (tail) {
    // "::" stands for at least one group.
    const omitted = 8 - head.length - tail.length;
    if (omitted < 1) return null;
    groups = [...head, ...Array<string>(omitted).fill("0"), ...tail];
  }
  if (groups.length !== 8) return null;
  return groups.every((group) => HEXTET_RE.test(group))
    ? groups.map((group) => Number.parseInt(group, 16))
    : null;
}

/**
 * What a per-IP limit should count for one address: an IPv4 address as it
 * is, an IPv6 address as its /64 network. A single subscriber is handed a
 * whole /64 (2^64 addresses), so counting each address on its own would let
 * one machine rotate through them and never meet a limit.
 */
function limitKey(address: string): string | null {
  // "[v6]:port", "v6%zone" and "v4:port" as some proxies write them.
  const bracketed = /^\[([^\]]*)\](?::\d+)?$/.exec(address);
  if (address.startsWith("[") && !bracketed) return null;
  const bare = (bracketed?.[1] ?? address).replace(/%.*$/, "");
  const v4 = ipv4(bare.replace(/^::ffff:/i, "").replace(/:\d+$/, ""));
  if (v4) return v4;
  const groups = ipv6Groups(bare);
  if (!groups) return null;
  const [a, b, c, d, e, f, g, h] = groups;
  // An IPv4 client seen through a dual-stack socket (::ffff:7f00:1).
  if (a + b + c + d + e === 0 && f === 0xffff) {
    return [g >> 8, g & 0xff, h >> 8, h & 0xff].join(".");
  }
  return `${[a, b, c, d].map((group) => group.toString(16)).join(":")}::/64`;
}

/**
 * The client address for per-IP limits: an IPv4 address, or the /64 network
 * of an IPv6 address (see `limitKey`). Not for display or logging.
 *
 * Vercel overwrites `X-Forwarded-For` with the real client IP, so it cannot
 * be spoofed there; behind any other proxy make sure the proxy does the same.
 * A value that is not an address lands in one shared bucket instead of
 * becoming a rate-limit key of the client's choosing.
 */
export function clientIp(request: Request): string {
  const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!first) return LOOPBACK;
  return limitKey(first) ?? UNKNOWN_CLIENT;
}
