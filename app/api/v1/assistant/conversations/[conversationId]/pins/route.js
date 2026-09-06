import { requireV1Actor, assertSameOrigin, readValidatedJson, assistantErrorResponse } from "../../../../../../../lib/v1/http.mjs";
import { pinsBodySchema, workspaceQuerySchema, validateSchema } from "../../../../../../../lib/v1/schemas.mjs";
import { createAssistantStore } from "../../../../../../../lib/v1/store.mjs";
import { defaultContextService } from "../../../../../../../lib/v1/context-default.mjs";
import { createAssistantManagement } from "../../../../../../../lib/v1/assistant-management.mjs";
export async function PUT(request, context) {
  try {
    const actor = await requireV1Actor(); assertSameOrigin(request);
    await createAssistantManagement().assertEnabled(actor.email);
    const { conversationId } = await context.params;
    validateSchema(workspaceQuerySchema.properties.conversationId, conversationId);
    const { pins, version } = await readValidatedJson(request, pinsBodySchema);
    const store = createAssistantStore();
    await store.getConversation(conversationId, actor.email);
    const resolved = await defaultContextService().assemble(actor, pins);
    const conversation = await store.updatePins(conversationId, actor.email, pins, version);
    return Response.json({ conversation, pins: resolved });
  } catch (error) { return assistantErrorResponse(error); }
}
