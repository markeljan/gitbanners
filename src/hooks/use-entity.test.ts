import { describe, expect, test } from "bun:test";
import { SAMPLE_REPO, SAMPLE_USER } from "@/lib/github/samples";
import type { User } from "@/lib/github/schema";
import { ApiProblem } from "./api";
import { isFresh, resolveEntity, retryDelay } from "./use-entity";

const preview: User = { ...SAMPLE_USER, complete: false };
const notFound = new ApiProblem(404, "not_found", "No such user.");
const down = new ApiProblem(503, "upstream_unavailable", "GitHub is down.");
const limited = new ApiProblem(429, "rate_limited", "Slow down.", 30);
const aborted = new DOMException("Aborted", "AbortError");
const idle = { isValidating: false };
const loading = { isValidating: true };

describe("resolveEntity", () => {
  test("the full entity wins over everything", () => {
    const state = resolveEntity({
      sample: SAMPLE_USER,
      preview: { data: preview, isValidating: false },
      full: { data: SAMPLE_USER, isValidating: true },
    });
    expect(state.entity).toBe(SAMPLE_USER);
    expect(state.stage).toBe("full");
    expect(state.isUpgrading).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.failure).toBeNull();
  });

  test("the preview is shown while the full entity loads", () => {
    const state = resolveEntity({
      sample: null,
      preview: { data: preview, isValidating: false },
      full: loading,
    });
    expect(state.entity).toBe(preview);
    expect(state.stage).toBe("preview");
    expect(state.isUpgrading).toBe(true);
  });

  test("the preview beats the bundled sample", () => {
    const state = resolveEntity({
      sample: SAMPLE_USER,
      preview: { data: preview, isValidating: false },
      full: loading,
    });
    expect(state.entity).toBe(preview);
    expect(state.stage).toBe("preview");
  });

  test("a sample answers at once and upgrades quietly", () => {
    const state = resolveEntity({
      sample: SAMPLE_USER,
      preview: loading,
      full: loading,
    });
    expect(state.entity).toBe(SAMPLE_USER);
    expect(state.stage).toBe("sample");
    expect(state.isLoading).toBe(false);
    expect(state.isUpgrading).toBe(true);
  });

  test("a sample without requests is simply shown", () => {
    const state = resolveEntity({ sample: SAMPLE_REPO });
    expect(state.entity).toBe(SAMPLE_REPO);
    expect(state.isUpgrading).toBe(false);
  });

  test("something to show wins over a failed upgrade", () => {
    const state = resolveEntity({
      sample: null,
      preview: { data: preview, isValidating: false },
      full: { error: down, isValidating: false },
    });
    expect(state.entity).toBe(preview);
    expect(state.failure).toBeNull();
    expect(state.isUpgrading).toBe(false);
  });

  test("nothing yet and a request in flight is loading", () => {
    const state = resolveEntity({ sample: null, preview: loading, full: idle });
    expect(state.entity).toBeNull();
    expect(state.isLoading).toBe(true);
    expect(state.failure).toBeNull();
  });

  test("not found is final even while the other request runs", () => {
    const state = resolveEntity({
      sample: null,
      preview: { error: notFound, isValidating: false },
      full: loading,
    });
    expect(state.failure).toBe("not_found");
    expect(state.isLoading).toBe(false);
  });

  test("an outage is reported once nothing is in flight", () => {
    expect(
      resolveEntity({
        sample: null,
        preview: { error: down, isValidating: true },
      }).failure,
    ).toBeNull();
    expect(
      resolveEntity({
        sample: null,
        preview: { error: down, isValidating: false },
      }).failure,
    ).toBe("unavailable");
    expect(
      resolveEntity({
        sample: null,
        full: { error: limited, isValidating: false },
      }).failure,
    ).toBe("rate_limited");
  });

  test("an aborted request says nothing about the target", () => {
    const state = resolveEntity({
      sample: null,
      full: { error: aborted, isValidating: false },
    });
    expect(state.failure).toBeNull();
    expect(state.isLoading).toBe(false);
  });

  test("no target, no sample, no requests: nothing to say", () => {
    expect(resolveEntity({ sample: null })).toEqual({
      entity: null,
      stage: null,
      isLoading: false,
      isUpgrading: false,
      failure: null,
    });
  });
});

describe("retryDelay", () => {
  test("answers are never retried", () => {
    expect(retryDelay(notFound, 1)).toBeNull();
    expect(
      retryDelay(new ApiProblem(400, "invalid_request", "x"), 1),
    ).toBeNull();
    expect(retryDelay(aborted, 1)).toBeNull();
  });
  test("outages back off and stop after two tries", () => {
    expect(retryDelay(down, 1)).toBe(1500);
    expect(retryDelay(down, 2)).toBe(3000);
    expect(retryDelay(down, 3)).toBeNull();
  });
  test("a short Retry-After is honoured, a long one is left to the visitor", () => {
    expect(retryDelay(new ApiProblem(429, "rate_limited", "x", 4), 1)).toBe(
      4000,
    );
    expect(retryDelay(new ApiProblem(429, "rate_limited", "x", 0), 1)).toBe(
      1000,
    );
    expect(retryDelay(limited, 1)).toBeNull();
  });
});

describe("isFresh", () => {
  const url = "/api/v1/owners/torvalds?view=preview";
  const state = (inFlight: string[], answered: Record<string, number>) => ({
    inFlight: new Set(inFlight),
    answeredAt: new Map(Object.entries(answered)),
  });
  test("a request in flight is not repeated", () => {
    expect(isFresh(url, 1_000, state([url], {}))).toBe(true);
  });
  test("an answer stays fresh for a minute", () => {
    expect(isFresh(url, 30_000, state([], { [url]: 1_000 }))).toBe(true);
    expect(isFresh(url, 61_001, state([], { [url]: 1_000 }))).toBe(false);
  });
  test("an unknown URL is worth asking", () => {
    expect(isFresh(url, 1_000, state([], {}))).toBe(false);
    expect(
      isFresh(url, 1_000, state(["/api/v1/owners/vercel"], { other: 900 })),
    ).toBe(false);
  });
});
