import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { expireTravelPlansCache } from "../trip-cache.js";
import { commitStoredChangeSet } from "./committer.mjs";
import { resolveAgenticV1Config } from "./config.mjs";
import { AssistantFault, assertPilotActor, assistantFault } from "./errors.mjs";
import { createGeminiModelAdapter, createLocalModelAdapter } from "./gemini-adapter.mjs";
import { compilePlanProposal } from "./proposal.mjs";
import { createGoogleResearchAdapters } from "./research.mjs";
import { listAssistantTrips, publicSnapshot, readTripSnapshot } from "./snapshot.mjs";
import { createAssistantStore } from "./store.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const stableJson = (value) => JSON.stringify(value, (_key, nested) => (
  nested && typeof nested === "object" && !Array.isArray(nested)
    ? Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right)))
    : nested
));

const confirmationPayload = ({ id, digest, ownerEmail, baseRevision, expiresAt }) => ({
  id, digest, ownerEmail, baseRevision, expiresAt,
});

const createConfirmationToken = (changeSet, ownerEmail, secret) => {
  const encoded = Buffer.from(stableJson(confirmationPayload({ ...changeSet, ownerEmail }))).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
};

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const publicChangeSet = (changeSet, ownerEmail, secret) => ({
  id: changeSet.id,
  tripSlug: changeSet.tripSlug,
  preview: changeSet.preview,
  citations: changeSet.citations,
  baseRevision: changeSet.baseRevision,
  digest: changeSet.digest,
  expiresAt: changeSet.expiresAt,
  status: changeSet.status,
  receipt: changeSet.receipt,
  confirmationToken: changeSet.status === "staged" && new Date(changeSet.expiresAt).getTime() > Date.now()
    ? createConfirmationToken(changeSet, ownerEmail, secret)
    : null,
});

const publicTurn = (turn, ownerEmail, secret) => ({
  ...turn,
  changeSet: turn.changeSet ? publicChangeSet(turn.changeSet, ownerEmail, secret) : null,
});

const titleFromMessage = (message) => {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 58 ? `${compact.slice(0, 57)}…` : compact;
};

const queue = () => {
  const values = [];
  const waiting = [];
  let done = false;
  return {
    push(value) {
      if (done) return;
      const waiter = waiting.shift();
      if (waiter) waiter({ value, done: false });
      else values.push(value);
    },
    close() {
      done = true;
      while (waiting.length) waiting.shift()({ value: undefined, done: true });
    },
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (values.length) return Promise.resolve({ value: values.shift(), done: false });
          if (done) return Promise.resolve({ value: undefined, done: true });
          return new Promise((resolve) => waiting.push(resolve));
        },
      };
    },
  };
};

export function createTravelAssistant({
  config = resolveAgenticV1Config(),
  store = createAssistantStore(),
  readSnapshot = readTripSnapshot,
  listTrips = listAssistantTrips,
  modelAdapter = null,
  researchAdapters = null,
  commitChangeSet = commitStoredChangeSet,
  invalidateCache = expireTravelPlansCache,
} = {}) {
  if (!config.confirmationSecret) {
    throw new AssistantFault("PROVIDER_CONFIG", "AUTH_SECRET là bắt buộc cho xác nhận thay đổi", { status: 503 });
  }
  const research = researchAdapters || createGoogleResearchAdapters({
    geminiApiKey: config.geminiApiKey,
    geminiModel: config.geminiModel,
    mapsApiKey: config.mapsApiKey,
  });
  const model = modelAdapter || (config.localMode
    ? createLocalModelAdapter()
    : createGeminiModelAdapter({
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
      research,
      maxToolExecutions: config.maxToolExecutions,
    }));

  return {
    async loadWorkspace({ actor, tripSlug = null, conversationId = null } = {}) {
      const trusted = assertPilotActor(actor);
      const trips = await listTrips();
      let selectedSlug = trips.some((trip) => trip.slug === tripSlug) ? tripSlug : trips[0]?.slug || null;
      let selectedConversation = null;
      const conversations = await store.listConversations(trusted.email);
      if (conversationId) {
        selectedConversation = await store.getConversation(conversationId, trusted.email);
        selectedSlug = selectedConversation.tripSlug;
      } else if (selectedSlug) {
        selectedConversation = conversations.find((conversation) => conversation.tripSlug === selectedSlug) || null;
      }
      const [snapshot, turns] = await Promise.all([
        selectedSlug ? readSnapshot(selectedSlug) : null,
        selectedConversation ? store.listTurns(selectedConversation.id, trusted.email) : [],
      ]);
      return {
        trips,
        selectedTripSlug: selectedSlug,
        snapshot: snapshot ? publicSnapshot(snapshot) : null,
        conversations,
        selectedConversation,
        turns: turns.map((turn) => publicTurn(turn, trusted.email, config.confirmationSecret)),
        limits: { maxToolExecutions: config.maxToolExecutions, turnDeadlineMs: config.turnDeadlineMs, maxTurnsPerHour: config.maxTurnsPerHour },
      };
    },

    async startTurn({ actor, tripSlug, conversationId = null, clientTurnId, message, signal = null }) {
      const trusted = assertPilotActor(actor);
      let conversation = conversationId ? await store.getConversation(conversationId, trusted.email) : null;
      if (conversation && conversation.tripSlug !== tripSlug) {
        throw new AssistantFault("CONVERSATION_TRIP_MISMATCH", "Cuộc trò chuyện thuộc chuyến đi khác", { status: 409 });
      }
      if (!conversation) {
        conversation = await store.createConversation({ ownerEmail: trusted.email, tripSlug, title: titleFromMessage(message) });
      }
      const started = await store.beginTurn({
        conversationId: conversation.id,
        ownerEmail: trusted.email,
        clientTurnId,
        input: message,
        leaseMs: config.turnDeadlineMs + 15_000,
        maxTurnsPerHour: config.maxTurnsPerHour,
      });
      if (started.replayed) {
        if (started.turn.status === "running") throw new AssistantFault("TURN_IN_PROGRESS", "Yêu cầu này đang được xử lý", { status: 409, retryable: true });
        const turns = await store.listTurns(conversation.id, trusted.email);
        const turn = turns.find((item) => item.id === started.turn.id) || started.turn;
        const events = queue();
        events.push({ seq: 1, type: "accepted", runId: turn.id, conversationId: conversation.id, replayed: true });
        events.push(turn.status === "completed"
          ? { seq: 2, type: "completed", turn: publicTurn(turn, trusted.email, config.confirmationSecret) }
          : { seq: 2, type: "failed", error: { code: turn.errorCode || "TURN_FAILED", message: "Yêu cầu trước không hoàn tất", retryable: true } });
        events.close();
        return { runId: turn.id, conversationId: conversation.id, events };
      }

      const events = queue();
      let sequence = 0;
      const emit = (event) => events.push({ seq: ++sequence, ...event });
      emit({ type: "accepted", runId: started.turn.id, conversationId: conversation.id, replayed: false });
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(new Error("deadline exceeded")), config.turnDeadlineMs);
      const abort = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", abort, { once: true });

      void (async () => {
        try {
          const [snapshot, history] = await Promise.all([
            readSnapshot(tripSlug),
            store.listTurns(conversation.id, trusted.email, { limit: config.recentTurnLimit }),
          ]);
          const result = await model.run({
            message,
            snapshot,
            history: history.filter((turn) => turn.id !== started.turn.id && turn.status === "completed"),
            signal: controller.signal,
            onProgress: ({ phase, label }) => emit({ type: "progress", phase, label }),
            onToolStart: ({ name, metadata }) => store.createToolRun({ turnId: started.turn.id, toolName: name, requestMetadata: metadata }),
            onToolFinish: (id, resultInfo) => id ? store.finishToolRun(id, {
              status: resultInfo.status,
              resultMetadata: resultInfo.metadata || {},
              errorCode: resultInfo.errorCode || null,
              durationMs: resultInfo.durationMs,
            }) : null,
          });

          let changeSet = null;
          if (result.operations?.length) {
            const compiled = compilePlanProposal(snapshot, result.operations);
            const id = randomUUID();
            const expiresAt = new Date(Date.now() + config.proposalLifetimeMs);
            const digest = sha256(stableJson({ operations: compiled.operations, preview: compiled.preview, baseRevision: snapshot.revision }));
            const token = createConfirmationToken({ id, digest, baseRevision: snapshot.revision, expiresAt: expiresAt.toISOString() }, trusted.email, config.confirmationSecret);
            changeSet = await store.stageChangeSet({
              id,
              turnId: started.turn.id,
              tripSlug,
              operations: compiled.operations,
              preview: compiled.preview,
              citations: result.citations,
              baseRevision: snapshot.revision,
              digest,
              tokenHash: sha256(token),
              expiresAt,
            });
          }
          const turn = await store.completeTurn({
            turnId: started.turn.id,
            output: result.text,
            citations: result.citations,
            providerInteractionId: result.providerInteractionId,
          });
          emit({
            type: "completed",
            turn: publicTurn({ ...turn, changeSet }, trusted.email, config.confirmationSecret),
          });
        } catch (error) {
          const fault = assistantFault(error);
          await store.failTurn(started.turn.id, fault.code).catch(() => {});
          emit({ type: "failed", error: { code: fault.code, message: fault.message, retryable: fault.retryable, details: fault.details } });
        } finally {
          clearTimeout(deadline);
          signal?.removeEventListener("abort", abort);
          events.close();
        }
      })();

      return { runId: started.turn.id, conversationId: conversation.id, events };
    },

    async confirmProposal({ actor, proposalId, confirmationToken }) {
      const trusted = assertPilotActor(actor);
      const changeSet = await store.getChangeSet(proposalId, trusted.email);
      const expectedToken = createConfirmationToken(changeSet, trusted.email, config.confirmationSecret);
      if (!safeEqual(confirmationToken, expectedToken) || !safeEqual(sha256(confirmationToken), changeSet.tokenHash)) {
        throw new AssistantFault("CONFIRMATION_INVALID", "Mã xác nhận không hợp lệ", { status: 403 });
      }
      const receipt = await commitChangeSet({ store, changeSet, actorEmail: trusted.email });
      try { invalidateCache(); }
      catch { console.error("Unable to invalidate trip cache after assistant commit"); }
      return receipt;
    },
  };
}

let defaultAssistant;
export function getDefaultTravelAssistant() {
  if (!defaultAssistant) defaultAssistant = createTravelAssistant();
  return defaultAssistant;
}
