/** GET /docs/llms.txt: section index of the docs, one entry per topic. */
import { documentResponse } from "@/lib/agent/discovery";
import { docsLlmsTxt } from "@/lib/agent/llms";

export function GET(request: Request): Response {
  return documentResponse(request, docsLlmsTxt(), "text/plain; charset=utf-8");
}
