import { assistantErrorResponse, requireV1Actor, ndjsonResponse } from "../../../../../../../lib/v1/http.mjs";
import { createAssistantStore } from "../../../../../../../lib/v1/store.mjs";
import { createBackgroundStore } from "../../../../../../../lib/v1/background-store.mjs";
import { getDefaultTravelAssistant } from "../../../../../../../lib/v1/travel-assistant.mjs";
import { validateSchema, workspaceQuerySchema } from "../../../../../../../lib/v1/schemas.mjs";
import { AssistantFault } from "../../../../../../../lib/v1/errors.mjs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request, context) {
  try {
    const actor = await requireV1Actor();
    const { runId } = await context.params;
    validateSchema(workspaceQuerySchema.properties.conversationId, runId);
    const after = Number(new URL(request.url).searchParams.get("after") || 0);
    if (!Number.isSafeInteger(after) || after < 0) throw new AssistantFault("INVALID_INPUT", "Mốc phản hồi không hợp lệ");
    const store = createAssistantStore();
    await store.getTurn(runId, actor.email);
    const background = createBackgroundStore(store);
    let detached = false;
    async function* events() {
      let cursor = after;
      const end = Date.now() + 20_000;
      while (!detached && !request.signal.aborted && Date.now() < end) {
        await store.reconcile(actor.email);
        const state = await store.getTurn(runId, actor.email);
        if (state.status !== "running") await background.append(runId, {
          runId, segment: state.segment, type: state.errorCode === "TURN_CANCELLED" ? "cancelled" : state.status, turn: state,
        });
        const page = await background.events(runId, cursor);
        for (const event of page) {
          cursor = event.seq;
          if ((event.segment != null && event.segment < state.segment) ||
              (event.type === "awaiting_approval" && state.status !== "awaiting_approval") ||
              (event.type === "awaiting_input" && state.status !== "awaiting_input")) {
            // Preserve the contiguous replay cursor without replaying an old segment.
            yield { runId, seq: event.seq, type: "checkpoint" };
            continue;
          }
          if (["completed", "failed", "cancelled", "awaiting_approval", "awaiting_input"].includes(event.type)) {
            const turn = await getDefaultTravelAssistant().getTurn({ actor, turnId: runId });
            yield { ...event, type: turn.errorCode === "TURN_CANCELLED" ? "cancelled" : turn.status, turn };
            return;
          }
          yield event;
        }
        if (page.length === 100) continue;
        if (state.status !== "running") return;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    return ndjsonResponse(events(), () => { detached = true; });
  } catch (error) { return assistantErrorResponse(error); }
}
