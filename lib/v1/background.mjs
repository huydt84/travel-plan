import { createAssistantStore } from "./store.mjs";
import { failureDiagnostic } from "./failure-diagnostics.mjs";
import { createBackgroundStore } from "./background-store.mjs";
import { getDefaultTravelAssistant } from "./travel-assistant.mjs";
import { resolveAgenticV1Config } from "./config.mjs";
import { assertPilotActor, assistantFault } from "./errors.mjs";
import { validateSchema, turnBodySchema } from "./schemas.mjs";

export async function acceptBackgroundTurn({ actor, tripSlug, ...body }) {
  const trusted = assertPilotActor(actor);
  validateSchema(turnBodySchema, body);
  const config = resolveAgenticV1Config();
  return createAssistantStore().acceptRequest({ ownerEmail: trusted.email, tripSlug,
    mentions: body.mentions || [], initialPins: body.initialPins || [],
    conversationId: body.conversationId || null, clientTurnId: body.clientTurnId, input: body.message,
    title: body.message.replace(/\s+/g, " ").slice(0, 58), leaseMs: 60_000, retryOfTurnId: body.retryOfTurnId || null,
    maxTurnsPerHour: config.maxTurnsPerHour, background: true });
}

export async function executeBackgroundTurn(turnId, workflowId, segment = 0) {
  const store = createAssistantStore();
  const background = createBackgroundStore(store);
  const config = resolveAgenticV1Config();
  if (!await background.claim(turnId, config.turnDeadlineMs + 10_000, workflowId, segment)) return;
  const job = await background.job(turnId);
  const actor = { email: job.owner_email, isAdmin: true };
  const controller = new AbortController();
  // Stop is persistent and publication checks the same row atomically.
  const timer = setInterval(async () => {
    try { if ((await store.getTurn(turnId, actor.email)).status !== "running") controller.abort(); }
    catch { controller.abort(); }
  }, 500);
  try {
    const run = await getDefaultTravelAssistant().startTurn({ actor,
      conversationId: job.conversation_id, clientTurnId: job.client_turn_id, message: job.input_text,
      signal: controller.signal, accepted: { turn: await store.getTurn(turnId, actor.email),
        conversation: await store.getConversation(job.conversation_id, actor.email), replayed: false } });
    for await (const event of run.events) {
      if (event.type === "accepted") await background.append(turnId, { type: "progress", runId: turnId, phase: "running", label: "Đang chuẩn bị câu trả lời" });
      else await background.append(turnId, { ...event, segment });
    }
  } catch (error) {
    controller.abort();
    await store.failTurn(turnId, assistantFault(error).code, segment, failureDiagnostic(error, "worker"));
  } finally { clearInterval(timer); }
}
