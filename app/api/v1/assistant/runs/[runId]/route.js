import { assistantErrorResponse, assertSameOrigin, requireV1Actor } from "../../../../../../lib/v1/http.mjs";
import { createAssistantStore } from "../../../../../../lib/v1/store.mjs";
import { getDefaultTravelAssistant } from "../../../../../../lib/v1/travel-assistant.mjs";
import { validateSchema, workspaceQuerySchema } from "../../../../../../lib/v1/schemas.mjs";
export async function POST(request, context) {
  try {
    const actor = await requireV1Actor();
    assertSameOrigin(request);
    const { runId } = await context.params;
    validateSchema(workspaceQuerySchema.properties.conversationId, runId);
    const store = createAssistantStore();
    await store.getTurn(runId, actor.email);
    await store.failTurn(runId, "TURN_CANCELLED");
    await store.reconcile(actor.email);
    return Response.json(await getDefaultTravelAssistant().getTurn({ actor, turnId: runId }));
  } catch (error) { return assistantErrorResponse(error); }
}
