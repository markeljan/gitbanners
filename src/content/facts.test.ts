import { describe, expect, test } from "bun:test";
import { SESSION_MAX_AGE, SIGN_IN_TX_MAX_AGE } from "@/lib/auth/session-token";
import { CACHE } from "@/lib/http/cache-headers";
import { FREE, PRO, PRO_FRESH_MS } from "@/lib/pro";
import { POLICIES } from "@/lib/ratelimit";
import nextConfig from "../../next.config";
import { edgeRefreshText, FACTS, quota } from "./facts";
import { duration, longDate } from "./format";

describe("facts quoted in the copy", () => {
  test("rate limits are the limiter's", () => {
    expect(FACTS.rateLimits.api).toEqual({ ...POLICIES.api });
    expect(FACTS.rateLimits.search).toEqual({ ...POLICIES.search });
    expect(quota("api")).toBe("120 requests per 60 seconds");
  });

  test("cookie lifetimes are the session's", () => {
    expect(FACTS.sessionDays * 86_400).toBe(SESSION_MAX_AGE);
    expect(FACTS.signInMinutes * 60).toBe(SIGN_IN_TX_MAX_AGE);
  });

  test("data refresh and last good copy match the caches", () => {
    const config = nextConfig("phase-production-build");
    expect(config.cacheLife?.github?.revalidate).toBe(
      FACTS.dataRefreshMinutes * 60,
    );
    expect<number>(CACHE.banner.edge).toBe(FACTS.dataRefreshMinutes * 60);
    expect<number>(CACHE.banner.sie).toBe(FACTS.lastGoodDays * 86_400);
  });
});

describe("what Pro's refresh is", () => {
  test("refreshSeconds is the CDN lifetime of a saved banner, per plan", () => {
    expect<number>(FREE.refreshSeconds).toBe(CACHE.banner.edge);
    expect<number>(PRO.refreshSeconds).toBe(CACHE.bannerPro.edge);
  });

  test("the copy does not sell it as fresher GitHub data", () => {
    // Saved banners of every plan are drawn from the same cached data.
    const config = nextConfig("phase-production-build");
    expect(config.cacheLife?.github?.revalidate).toBe(FREE.refreshSeconds);
    const text = edgeRefreshText();
    expect(text).toContain(`at the edge every ${duration(PRO.refreshSeconds)}`);
    expect(text).toContain(
      `GitHub data behind them refreshes every ${FACTS.dataRefreshMinutes} minutes on both plans`,
    );
  });
});

describe("Pro re-checks quoted on the pricing page", () => {
  test("match how long a decision is trusted", () => {
    expect(FACTS.proRecheckHours * 3_600_000).toBe(PRO_FRESH_MS.pro);
    expect(FACTS.freeRecheckSeconds * 1000).toBe(PRO_FRESH_MS.free);
  });
});

describe("formatters", () => {
  test("duration picks the largest whole unit", () => {
    expect(duration(900)).toBe("15 minutes");
    expect(duration(60)).toBe("1 minute");
    expect(duration(86_400)).toBe("1 day");
    expect(duration(604_800)).toBe("7 days");
    expect(duration(30)).toBe("30 seconds");
    expect(duration(90)).toBe("90 seconds");
    expect(duration(3_600)).toBe("1 hour");
  });

  test("longDate is independent of locale and zone", () => {
    expect(longDate("2026-11-13")).toBe("13 November 2026");
    expect(longDate("2026-01-01T23:30:00Z")).toBe("1 January 2026");
    expect(longDate("soon")).toBe("soon");
  });
});
