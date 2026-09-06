import { assistantErrorResponse, assertSameOrigin, requireV1Actor, readValidatedJson } from "../../../../../../../lib/v1/http.mjs";
import { getDefaultTravelAssistant } from "../../../../../../../lib/v1/travel-assistant.mjs";
import { validateSchema, workspaceQuerySchema } from "../../../../../../../lib/v1/schemas.mjs";

export async function POST(request, context) {
  try {
    const actor = await requireV1Actor();
    assertSameOrigin(request);
    const { actionId } = await context.params;
    validateSchema(workspaceQuerySchema.properties.conversationId, actionId);
    await readValidatedJson(request, { type: "object", additionalProperties: false });
    const result = await getDefaultTravelAssistant().rejectAction({ actor, actionId });
    return Response.json(result);
  } catch (error) { return assistantErrorResponse(error); }
}
