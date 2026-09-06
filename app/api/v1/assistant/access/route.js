import { assistantErrorResponse, requireV1Actor } from "../../../../../lib/v1/http.mjs";
import { createAssistantManagement } from "../../../../../lib/v1/assistant-management.mjs";
export async function GET() {
  try {
    const actor = await requireV1Actor();
    return Response.json(await createAssistantManagement().access(actor.email),{ headers:{ "cache-control":"no-store" } });
  } catch(error) { return assistantErrorResponse(error); }
}
