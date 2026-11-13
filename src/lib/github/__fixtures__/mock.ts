/**
 * Test helpers: recorded GitHub responses and a fake `fetch` that serves
 * them. Imported by the colocated `*.test.ts` files only.
 *
 * Everything under `raw/` was recorded from PUBLIC accounts and repositories
 * with the documents in `queries.ts`. Tests that need a private repository in
 * a response build one by hand from a public fixture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAW_DIR = join(import.meta.dir, "raw");

/** A recorded response body as text. */
export function fixtureText(name: string): string {
  return readFileSync(join(RAW_DIR, name), "utf8");
}

/** A recorded JSON response body. A fresh copy on every call. */
export function fixture(name: string): unknown {
  return JSON.parse(fixtureText(name));
}

/** The `data` member of a recorded GraphQL response. */
export function fixtureData(name: string): unknown {
  const body = fixture(name);
  if (typeof body !== "object" || body === null || !("data" in body)) {
    throw new Error(`${name} is not a GraphQL response`);
  }
  return body.data;
}

/** One request seen by the fake. */
export interface RecordedCall {
  method: string;
  url: URL;
  /** Path and query for REST and github.com requests. */
  path: string;
  /** GraphQL operation name (`OwnerCore`, ...), `null` for other requests. */
  operation: string | null;
  /** GraphQL variables, `null` for other requests. */
  variables: Record<string, unknown> | null;
  headers: Headers;
  signal: AbortSignal | null;
}

/** Produces the response for a matched request. */
export type Handler = (call: RecordedCall) => Response | Promise<Response>;

/** What a route answers with: a handler, a `Response`, or a JSON body. */
export type Reply = Handler | Response | object | null;

/** Routes of {@link fakeGitHub}. */
export interface Routes {
  /** GraphQL replies by operation name. */
  graphql?: Record<string, Reply>;
  /** REST replies: the first pattern matching `path` (incl. query) wins. */
  rest?: readonly (readonly [RegExp, Reply])[];
  /** github.com (HTML) replies, matched like `rest`. */
  web?: readonly (readonly [RegExp, Reply])[];
}

/** Handle on an installed fake. */
export interface FakeGitHub {
  /** Every request, in order. */
  calls: RecordedCall[];
  /** Requests no route matched. Assert this stays empty. */
  unexpected: string[];
  /** Number of GraphQL requests for an operation. */
  count(operation: string): number;
  /** REST / web requests whose path matches. */
  matching(pattern: RegExp): RecordedCall[];
  /** Puts the real `fetch` back. */
  restore(): void;
}

/** A JSON response. */
export function json(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

/** GitHub's HTML error page for a request it killed at ~10 s. */
export function htmlTimeout(status: 502 | 504 = 502): Response {
  return new Response(
    "<html>\n<head><title>502 Bad Gateway</title></head>\n<body><center><h1>502 Bad Gateway</h1></center></body>\n</html>\n",
    { status, headers: { "content-type": "text/html" } },
  );
}

/** A `Link` header as GitHub sends it for page 1 of `pages`. */
export function linkHeader(base: string, pages: number): string {
  return `<${base}&page=2>; rel="next", <${base}&page=${pages}>; rel="last"`;
}

async function answer(reply: Reply, call: RecordedCall): Promise<Response> {
  if (typeof reply === "function") return reply(call);
  // A Response body can be read once; routes may be hit several times.
  if (reply instanceof Response) return reply.clone();
  return json(reply);
}

function toCall(input: RequestInfo | URL, init?: RequestInit): RecordedCall {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const headers = new Headers(init?.headers);
  let operation: string | null = null;
  let variables: Record<string, unknown> | null = null;
  if (url.pathname === "/graphql" && typeof init?.body === "string") {
    const body = JSON.parse(init.body) as {
      query: string;
      variables: Record<string, unknown>;
    };
    operation = body.query.match(/query\s+(\w+)/)?.[1] ?? "anonymous";
    variables = body.variables;
  }
  return {
    method: init?.method ?? "GET",
    url,
    path: `${url.pathname}${url.search}`,
    operation,
    variables,
    headers,
    signal: init?.signal ?? null,
  };
}

/**
 * Replaces `globalThis.fetch` with a router over the given replies. Requests
 * without a route get an HTTP 599 and are listed in `unexpected`, so a test
 * notices a request it did not plan for. Call `restore()` when done.
 */
export function fakeGitHub(routes: Routes): FakeGitHub {
  const original = globalThis.fetch;
  const calls: RecordedCall[] = [];
  const unexpected: string[] = [];

  const handler = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const call = toCall(input, init);
    calls.push(call);
    let reply: Reply | undefined;
    if (call.operation !== null) {
      reply = routes.graphql?.[call.operation];
    } else {
      const table =
        call.url.hostname === "api.github.com" ? routes.rest : routes.web;
      reply = table?.find(([pattern]) => pattern.test(call.path))?.[1];
    }
    if (reply === undefined) {
      unexpected.push(call.operation ?? `${call.method} ${call.url.href}`);
      return new Response("no route in the test", { status: 599 });
    }
    return answer(reply, call);
  };
  globalThis.fetch = handler as typeof fetch;

  return {
    calls,
    unexpected,
    count: (operation) =>
      calls.filter((call) => call.operation === operation).length,
    matching: (pattern) =>
      calls.filter(
        (call) => call.operation === null && pattern.test(call.path),
      ),
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
