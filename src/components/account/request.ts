import { ApiProblem, problemFromResponse } from "@/hooks/api";

/**
 * A same-origin write to the account API (`fetchJson` covers reads).
 * Resolves with the JSON body, or `null` for 204; rejects with an
 * `ApiProblem` for every other answer, with code `network` when nothing
 * arrived.
 */
export async function sendJson(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiProblem(0, "network", "The request did not reach the server.");
  }
  if (response.status === 204) return null;
  const parsed: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw problemFromResponse(
      response.status,
      parsed,
      response.headers.get("retry-after"),
    );
  }
  return parsed;
}
