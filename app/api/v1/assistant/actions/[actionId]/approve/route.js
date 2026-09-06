import { assistantErrorResponse, assertSameOrigin, requireV1Actor, readValidatedJson } from "../../../../../../../lib/v1/http.mjs";
import { getDefaultTravelAssistant } from "../../../../../../../lib/v1/travel-assistant.mjs";
import { validateSchema, workspaceQuerySchema } from "../../../../../../../lib/v1/schemas.mjs";
import { after } from "next/server";
import { dispatchAssistantJobs } from "../../../../../../../lib/v1/dispatch.js";

export async function POST(request, context) {
  try {
    const actor = await requireV1Actor();
    assertSameOrigin(request);
    const { actionId } = await context.params;
    validateSchema(workspaceQuerySchema.properties.conversationId, actionId);
    const { confirmationToken } = await readValidatedJson(request, { type: "object", additionalProperties: false, required: ["confirmationToken"], properties: { confirmationToken: { type: "string", minLength: 43, maxLength: 43 } } });
    const result = await getDefaultTravelAssistant().approveAction({ actor, actionId, confirmationToken });
    after(() => dispatchAssistantJobs(result.turnId));
    return Response.json(result);
  } catch (error) { return assistantErrorResponse(error); }
}
