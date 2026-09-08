import { assistantErrorResponse, assertSameOrigin, requireV1Actor, readValidatedJson } from "../../../../../../../lib/v1/http.mjs";
import { getDefaultTravelAssistant } from "../../../../../../../lib/v1/travel-assistant.mjs";
import { reviseBodySchema, validateSchema, workspaceQuerySchema } from "../../../../../../../lib/v1/schemas.mjs";

export async function POST(request, context) {
  try {
    const actor = await requireV1Actor();
    assertSameOrigin(request);
    const { actionId } = await context.params;
    validateSchema(workspaceQuerySchema.properties.conversationId, actionId);
    const body = await readValidatedJson(request, reviseBodySchema);
    const action = await getDefaultTravelAssistant().reviseAction({ actor, actionId, ...body });
    return Response.json({ action });
  } catch (error) { return assistantErrorResponse(error); }
}
