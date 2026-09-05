import { assistantErrorResponse, assertSameOrigin, ndjsonResponse, readValidatedJson, requireV1Actor } from "../../../../../../../lib/v1/http.mjs";
import { turnBodySchema } from "../../../../../../../lib/v1/schemas.mjs";
import { getDefaultTravelAssistant } from "../../../../../../../lib/v1/travel-assistant.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request, context) {
  try {
    const actor = await requireV1Actor();
    assertSameOrigin(request);
    const body = await readValidatedJson(request, turnBodySchema);
    const { slug } = await context.params;
    const run = await getDefaultTravelAssistant().startTurn({
      actor,
      tripSlug: slug,
      conversationId: body.conversationId || null,
      clientTurnId: body.clientTurnId,
      message: body.message.trim(),
      signal: request.signal,
    });
    return ndjsonResponse(run.events, run.cancel);
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
