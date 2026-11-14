import { describe, expect, test } from "bun:test";
import {
  asGitHubError,
  GitHubError,
  type GitHubErrorCode,
  isGitHubError,
  isTransient,
} from "./errors";

/**
 * What a caller of a `'use cache'` function catches in a production build
 * (observed under `next start`, Next.js 16.4.6): React re-creates the error
 * with this fixed message and copies nothing but the digest.
 */
function transportedInProduction(original: GitHubError): Error {
  return Object.assign(
    new Error(
      "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details. A digest property is included on this error instance which may provide additional details about the nature of the error.",
    ),
    { digest: original.digest },
  );
}

/** The same in `next dev`: name and message are transported as well. */
function transportedInDevelopment(original: GitHubError): Error {
  const error = new Error(original.message);
  error.name = original.name;
  return Object.assign(error, { digest: original.digest });
}

describe("GitHubError.digest", () => {
  test("carries code, status and retry delay, never the message", () => {
    const limited = new GitHubError(
      "rate_limited",
      "API rate limit exceeded for user ID 1.",
      { retryAfter: 60 },
    );
    expect(limited.digest).toBe("GITHUB_ERROR;rate_limited;429;60");
    expect(
      new GitHubError("forbidden", "Bad credentials", { status: 401 }).digest,
    ).toBe("GITHUB_ERROR;forbidden;401;");
    expect(new GitHubError("unavailable", "timeout").digest).toBe(
      "GITHUB_ERROR;unavailable;503;",
    );
    expect(new GitHubError("invalid", "bad year").digest).toBe(
      "GITHUB_ERROR;invalid;400;",
    );
  });

  test("is an own property, which is what Next.js looks for", () => {
    const error = new GitHubError("unavailable", "x");
    expect(Object.hasOwn(error, "digest")).toBe(true);
  });

  test("does not collide with the digests Next.js gives a meaning to", () => {
    const { digest } = new GitHubError("invalid", "x");
    for (const reserved of [
      "NEXT_REDIRECT",
      "NEXT_HTTP_ERROR_FALLBACK",
      "NEXT_NOT_FOUND",
      "DYNAMIC_SERVER_USAGE",
      "BAILOUT_TO_CLIENT_SIDE_RENDERING",
      "NEXT_PRERENDER_INTERRUPTED",
    ]) {
      expect(digest.startsWith(reserved)).toBe(false);
    }
  });
});

describe("asGitHubError", () => {
  const cases: [GitHubErrorCode, number | undefined, number | null][] = [
    ["rate_limited", undefined, 60],
    ["rate_limited", 403, 0],
    ["rate_limited", undefined, 3600],
    ["unavailable", 504, null],
    ["unavailable", undefined, 12],
    ["forbidden", 401, null],
    ["invalid", undefined, null],
    ["invalid", 451, null],
  ];

  test.each(cases)(
    "%s (status %p, retry %p) survives a production cache boundary",
    (code, status, retryAfter) => {
      const original = new GitHubError(code, "secret wording from GitHub", {
        status,
        retryAfter,
      });
      const transported = transportedInProduction(original);
      expect(isGitHubError(transported)).toBe(false);

      const revived = asGitHubError(transported);
      expect(revived).toBeInstanceOf(GitHubError);
      expect(revived?.code).toBe(original.code);
      expect(revived?.status).toBe(original.status);
      expect(revived?.retryAfter).toBe(original.retryAfter);
      // Same digest: Next.js then recognises it as the error it already logged.
      expect(revived?.digest).toBe(original.digest);
      expect(revived?.cause).toBe(transported);
      // Production never had the message; it must not be invented either.
      expect(revived?.message).not.toContain("secret wording");
      expect(revived?.message).toContain(code);
      expect(isTransient(revived)).toBe(
        code === "rate_limited" || code === "unavailable",
      );
    },
  );

  test("a development build also gives the message back", () => {
    const original = new GitHubError("unavailable", "GitHub HTTP 502", {
      status: 502,
    });
    const revived = asGitHubError(transportedInDevelopment(original));
    expect(revived).toBeInstanceOf(GitHubError);
    expect(revived?.message).toBe("GitHub HTTP 502");
    expect(revived?.status).toBe(502);
  });

  test("a real instance is returned as it is", () => {
    const error = new GitHubError("forbidden", "x");
    expect(asGitHubError(error)).toBe(error);
  });

  test("an instance of another copy of the module is returned as it is", () => {
    const foreign = Object.assign(new Error("from another bundle"), {
      name: "GitHubError",
      code: "rate_limited",
      status: 429,
      retryAfter: 30,
      digest: "GITHUB_ERROR;rate_limited;429;30",
    });
    expect(asGitHubError(foreign)).toBe(foreign as unknown as GitHubError);
  });

  test.each([
    ["nothing", null],
    ["undefined", undefined],
    ["a string", "GITHUB_ERROR;invalid;400;"],
    ["an error without a digest", new Error("boom")],
    ["a numeric digest", Object.assign(new Error("x"), { digest: 1990687344 })],
    [
      "the hash Next.js assigns to other errors",
      Object.assign(new Error("x"), { digest: "1990687344" }),
    ],
    [
      "a redirect",
      Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;replace;/vercel;307;",
      }),
    ],
    [
      "not found",
      Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), {
        digest: "NEXT_HTTP_ERROR_FALLBACK;404",
      }),
    ],
    [
      "an unknown code",
      Object.assign(new Error("x"), { digest: "GITHUB_ERROR;teapot;418;" }),
    ],
    [
      "a status that is no HTTP status",
      Object.assign(new Error("x"), { digest: "GITHUB_ERROR;invalid;40x;" }),
    ],
    [
      "a status out of range",
      Object.assign(new Error("x"), { digest: "GITHUB_ERROR;invalid;99;" }),
    ],
    [
      "a negative retry delay",
      Object.assign(new Error("x"), {
        digest: "GITHUB_ERROR;rate_limited;429;-5",
      }),
    ],
    [
      "a retry delay that is no number",
      Object.assign(new Error("x"), {
        digest: "GITHUB_ERROR;rate_limited;429;soon",
      }),
    ],
    [
      "extra fields",
      Object.assign(new Error("x"), {
        digest: "GITHUB_ERROR;invalid;400;;more",
      }),
    ],
    [
      "a truncated digest",
      Object.assign(new Error("x"), { digest: "GITHUB_ERROR;invalid" }),
    ],
    [
      "another prefix",
      Object.assign(new Error("x"), { digest: "XGITHUB_ERROR;invalid;400;" }),
    ],
  ])("%s is not a GitHubError", (_label, value) => {
    expect(asGitHubError(value)).toBeNull();
  });

  test("a rebuilt error is not rebuilt twice", () => {
    const once = asGitHubError(
      transportedInProduction(new GitHubError("rate_limited", "x")),
    );
    expect(once).not.toBeNull();
    expect(asGitHubError(once)).toBe(once);
  });
});
