/** GET /api/llms.txt: section index of the API, one entry per operation. */
import { documentResponse } from "@/lib/agent/discovery";
import { apiLlmsTxt } from "@/lib/agent/llms";

export function GET(request: Request): Response {
  return documentResponse(request, apiLlmsTxt(), "text/plain; charset=utf-8");
}
