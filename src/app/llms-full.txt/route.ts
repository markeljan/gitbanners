/** GET /llms-full.txt: every content page as one Markdown document. */
import { documentResponse } from "@/lib/agent/discovery";
import { llmsFullTxt } from "@/lib/agent/llms";

export function GET(request: Request): Response {
  return documentResponse(request, llmsFullTxt(), "text/plain; charset=utf-8");
}
