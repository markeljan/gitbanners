/**
 * Errors of the public data operations, independent of the transport: the
 * JSON API turns them into problem responses, the MCP server into tool
 * errors. Messages are written for the caller and never quote upstream text.
 */
export interface ApiErrorInit {
  status: number;
  /** Stable snake_case identifier. */
  code: string;
  /** Summary that is the same for every occurrence of the code. */
  title: string;
  /** What the caller can do about it. */
  resolution?: string;
  /** Seconds to wait before retrying, when known. */
  retryAfter?: number | null;
  extra?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly resolution: string | undefined;
  readonly retryAfter: number | null;
  readonly extra: Record<string, unknown> | undefined;

  constructor(detail: string, init: ApiErrorInit) {
    super(detail);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.title = init.title;
    this.resolution = init.resolution;
    this.retryAfter = init.retryAfter ?? null;
    this.extra = init.extra;
  }

  static invalid(detail: string, resolution?: string): ApiError {
    return new ApiError(detail, {
      status: 400,
      code: "invalid_request",
      title: "Invalid request",
      resolution,
    });
  }

  static notFound(detail: string, resolution?: string): ApiError {
    return new ApiError(detail, {
      status: 404,
      code: "not_found",
      title: "Not found",
      resolution: resolution ?? "Check the spelling on github.com, then retry.",
    });
  }

  /** Maps a failure of the GitHub data layer, by its code only. */
  static fromGitHub(error: {
    code: string;
    retryAfter?: number | null;
  }): ApiError {
    if (error.code === "invalid") {
      return ApiError.invalid("GitHub rejected the request as invalid.");
    }
    if (error.code === "rate_limited") {
      const wait = Math.min(3600, Math.max(30, error.retryAfter ?? 60));
      return new ApiError("GitHub is rate limiting this service right now.", {
        status: 503,
        code: "upstream_rate_limited",
        title: "Upstream rate limited",
        resolution: `Retry in ${wait} seconds.`,
        retryAfter: wait,
      });
    }
    return new ApiError("GitHub did not answer in time.", {
      status: 503,
      code: "upstream_unavailable",
      title: "Upstream unavailable",
      resolution: "Retry in 30 seconds.",
      retryAfter: 30,
    });
  }
}
