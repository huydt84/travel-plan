import { acceptBackgroundTurn } from "../../../../../../../lib/v1/background.mjs";
import { dispatchAssistantJobs } from "../../../../../../../lib/v1/dispatch";
import { assistantErrorResponse, assertSameOrigin, readValidatedJson, requireV1Actor } from "../../../../../../../lib/v1/http.mjs";
import { turnBodySchema } from "../../../../../../../lib/v1/schemas.mjs";
import { after } from "next/server";
import { processAssistantHandoffOutbox } from "../../../../../../../lib/assistant-handoff-outbox";

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
    if (accepted.mode === "handoff") {
      if (!accepted.replayed) after(() => processAssistantHandoffOutbox({ handoffId: accepted.handoff.id }));
      return Response.json({ mode: "handoff", conversationId: accepted.conversation.id,
        message: { ...accepted.message, author: { name: accepted.message.author.name, role: accepted.message.author.role } },
        handoff: { ...accepted.handoff, initiatedBy: { name: accepted.handoff.initiatedBy.name } }, replayed: accepted.replayed }, { status: 202 });
    }
    after(() => dispatchAssistantJobs(accepted.turn.id));
    const turn = accepted.turn;
    return Response.json({ mode: "assistant", runId: turn.id, conversationId: accepted.conversation.id, status: turn.status, turn, replayed: accepted.replayed }, { status: 202 });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
