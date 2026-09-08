import { after } from "next/server";
import { dispatchAssistantJobs } from "../../../../../../../lib/v1/dispatch.js";
import { assistantErrorResponse, assertSameOrigin, readValidatedJson, requireV1Actor } from "../../../../../../../lib/v1/http.mjs";
import { questionAnswerSchema } from "../../../../../../../lib/v1/question-schema.mjs";
import { validateSchema, workspaceQuerySchema } from "../../../../../../../lib/v1/schemas.mjs";
import { getDefaultTravelAssistant } from "../../../../../../../lib/v1/travel-assistant.mjs";

export async function POST(request, context) {
  try {
    const actor = await requireV1Actor();
    assertSameOrigin(request);
    const { questionId } = await context.params;
    validateSchema(workspaceQuerySchema.properties.conversationId, questionId);
    const input = await readValidatedJson(request, questionAnswerSchema);
    const result = await getDefaultTravelAssistant().answerQuestion({ actor, questionId, input });
    after(() => dispatchAssistantJobs(result.turnId));
    return Response.json(result);
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
