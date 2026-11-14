/** GET /llms.txt: the index of the site for language models (llmstxt.org). */
import { documentResponse } from "@/lib/agent/discovery";
import { llmsTxt } from "@/lib/agent/llms";

export function GET(request: Request): Response {
  return documentResponse(request, llmsTxt(), "text/plain; charset=utf-8");
}
