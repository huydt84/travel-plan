import { acceptBackgroundTurn } from "../../../../../../../lib/v1/background.mjs";
import { dispatchAssistantJobs } from "../../../../../../../lib/v1/dispatch";
import { assistantErrorResponse, assertSameOrigin, readValidatedJson, requireV1Actor } from "../../../../../../../lib/v1/http.mjs";
import { turnBodySchema } from "../../../../../../../lib/v1/schemas.mjs";
import { createAssistantStore } from "../../../../../../../lib/v1/store.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request, context) {
  try {
    const actor = await requireV1Actor();
    assertSameOrigin(request);
    const body = await readValidatedJson(request, turnBodySchema);
    const { slug } = await context.params;
    const accepted = await acceptBackgroundTurn({ actor, tripSlug: slug, ...body, message: body.message.trim() });
    await dispatchAssistantJobs(accepted.turn.id);
    const turn = await createAssistantStore().getTurn(accepted.turn.id, actor.email);
    return Response.json({ runId: turn.id, conversationId: accepted.conversation.id, status: turn.status, turn, replayed: accepted.replayed }, { status: 202 });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
