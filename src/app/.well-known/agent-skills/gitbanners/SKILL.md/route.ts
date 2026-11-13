/**
 * GET /.well-known/agent-skills/gitbanners/SKILL.md: the agent skill. The
 * bytes served are the string the index hashes; nothing may be added here.
 */
import { documentResponse, SKILL_MD } from "@/lib/agent/discovery";

export function GET(request: Request): Response {
  return documentResponse(request, SKILL_MD, "text/markdown; charset=utf-8");
}
