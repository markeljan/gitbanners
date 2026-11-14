/** GET /.well-known/agent-skills/index.json: Agent Skills discovery index. */
import {
  agentSkillsIndex,
  documentResponse,
  jsonBody,
} from "@/lib/agent/discovery";

export function GET(request: Request): Response {
  return documentResponse(
    request,
    jsonBody(agentSkillsIndex()),
    "application/json; charset=utf-8",
  );
}
