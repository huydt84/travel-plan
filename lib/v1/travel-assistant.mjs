import { createBatchStore } from "./batch-store.mjs";
import { createContextService, canonicalRefs } from "./context.mjs";
import { DateTime } from "luxon";
import { withAbort } from "./cancellation.mjs";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { commitStoredChangeSet } from "./committer.mjs";
import { resolveAgenticV1Config } from "./config.mjs";
import { AssistantFault, assertPilotActor, assistantFault } from "./errors.mjs";
import { createGeminiModelAdapter, createLocalModelAdapter } from "./gemini-adapter.mjs";
import { validateSchema, workspaceQuerySchema, turnBodySchema } from "./schemas.mjs";
import { compilePlanProposal } from "./proposal.mjs";
import { createGoogleResearchAdapters } from "./research.mjs";
import { listAssistantTrips, readTripSnapshot } from "./snapshot.mjs";
import { createAssistantStore } from "./store.mjs";
import { createAssistantManagement } from "./assistant-management.mjs";

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
  tripTitle: changeSet.tripTitle,
  preview: changeSet.preview,
  citations: changeSet.citations,
  baseRevision: changeSet.baseRevision,
  digest: changeSet.digest,
  expiresAt: changeSet.expiresAt,
  status: changeSet.status,
  receipt: changeSet.receipt,
  confirmationToken: null, // Legacy proposals are historical; regenerate through the batch gate.
});

const publicTurn = (turn, ownerEmail, secret) => ({
  ...turn,
  changeSet: turn.status === "completed" && turn.changeSet ? publicChangeSet(turn.changeSet, ownerEmail, secret) : null,
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
  contextService = null,
  management = store.sql ? createAssistantManagement(store) : null,
  commitChangeSet = commitStoredChangeSet,
  invalidateCache = async () => (await import("../trip-cache.js")).expireTravelPlansCache(),
} = {}) {
  if (!config.confirmationSecret) {
    throw new AssistantFault("PROVIDER_CONFIG", "AUTH_SECRET là bắt buộc cho xác nhận thay đổi", { status: 503 });
  }
  const research = researchAdapters || createGoogleResearchAdapters({
    geminiApiKey: config.geminiApiKey,
    geminiModel: config.geminiModel,
    mapsApiKey: config.mapsApiKey,
  });
  const context = contextService || createContextService({ research, readSnapshot, maxChars: config.contextMaxChars });
  const model = modelAdapter || (config.localMode && !config.realProviders
    ? createLocalModelAdapter()
    : createGeminiModelAdapter({
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
      research,
      maxModelRequests: config.maxModelRequests,
      maxToolExecutions: config.maxToolExecutions,
      maxConcurrentTools: config.maxConcurrentTools,
      maxContextChars: config.contextMaxChars,
    }));

  const batches = store.sql ? createBatchStore(store.sql, config.confirmationSecret) : null;
  const withActions = async (turns, email) => {
    const actions = batches ? await batches.list(turns.map((t) => t.id), email) : [];
    return turns.map((turn) => ({ ...publicTurn(turn, email, config.confirmationSecret), actions: actions.filter((a) => a.turnId === turn.id) }));
  };
  return {
    async approveAction({ actor, actionId, confirmationToken }) {
      const trusted = assertPilotActor(actor);
      const result = await batches.approve(actionId, trusted.email, confirmationToken);
      try { await invalidateCache(); } catch { console.error("Unable to refresh cache after approved batch"); }
      return result;
    },
    async rejectAction({ actor, actionId }) {
      return batches.reject(actionId, assertPilotActor(actor).email);
    },
    async loadWorkspace({ actor, tripSlug = null, conversationId = null, clientTurnId = null, before = null, historyBefore = null } = {}) {
      validateSchema(workspaceQuerySchema, { conversationId, clientTurnId, before });
      const trusted = assertPilotActor(actor);
      await store.reconcile(trusted.email);
      const request = clientTurnId ? await store.findRequest(trusted.email, clientTurnId) : null;
      if (request) conversationId = request.conversationId;
      let cursor = null;
      try { cursor = before ? JSON.parse(Buffer.from(before, "base64url").toString()) : null; }
      catch { throw new AssistantFault("INVALID_INPUT", "Mốc lịch sử không hợp lệ"); }
      if (cursor) {
        validateSchema(workspaceQuerySchema.properties.cursor, cursor);
        if (!DateTime.fromISO(cursor.createdAt).isValid) throw new AssistantFault("INVALID_INPUT", "Mốc lịch sử không hợp lệ");
      }
      const trips = await listTrips();
      const selectedSlug = tripSlug || null;
      let selectedConversation = null;
      let historyCursor = null;
      if (historyBefore) {
        try { historyCursor = JSON.parse(Buffer.from(historyBefore, "base64url").toString()); }
        catch { throw new AssistantFault("INVALID_INPUT", "Mốc lịch sử không hợp lệ"); }
        validateSchema(workspaceQuerySchema.properties.cursor, { id: historyCursor.id, createdAt: historyCursor.updatedAt });
        if (!DateTime.fromISO(historyCursor.updatedAt).isValid) throw new AssistantFault("INVALID_INPUT", "Mốc lịch sử không hợp lệ");
      }
      const historyPage = await store.listConversations(trusted.email, { limit: 31, before: historyCursor });
      const conversations = historyPage.slice(0, 30);
      if (conversationId) {
        selectedConversation = await store.getConversation(conversationId, trusted.email);

      }
      const [pins, turns] = await Promise.all([
        context.assemble(trusted, selectedConversation?.pins || []),
        selectedConversation ? store.listTurns(selectedConversation.id, trusted.email, { limit: 61, before: cursor }) : [],
      ]);
      return {
        trips,
        selectedTripSlug: selectedSlug,
        pins,
        conversations,
        historyCursor: historyPage.length > 30 ? Buffer.from(JSON.stringify({ id: conversations.at(-1).id, updatedAt: conversations.at(-1).updatedAt })).toString("base64url") : null,
        selectedConversation,
        request: clientTurnId ? { found: Boolean(request), turn: request ? (await withActions([request], trusted.email))[0] : null } : null,
        nextCursor: turns.length > 60 ? Buffer.from(JSON.stringify({ createdAt: turns[1].createdAt, id: turns[1].exchangeId })).toString("base64url") : null,
        turns: await withActions(turns.slice(-60), trusted.email),
        limits: { maxToolExecutions: config.maxToolExecutions, turnDeadlineMs: config.turnDeadlineMs, maxTurnsPerHour: config.maxTurnsPerHour },
        access: management ? await management.access(trusted.email) : null,
      };
    },

    async startTurn({ actor, tripSlug, conversationId = null, clientTurnId, message, mentions = [], initialPins = [], signal = null, accepted = null }) {
      const trusted = assertPilotActor(actor);
      validateSchema(turnBodySchema, { conversationId, clientTurnId, message });
      const started = accepted || await store.acceptRequest({
        ownerEmail: trusted.email, tripSlug, mentions, initialPins, conversationId, clientTurnId, input: message,
        title: titleFromMessage(message), leaseMs: config.turnDeadlineMs + 10_000,
        maxTurnsPerHour: config.maxTurnsPerHour,
      });
      const conversation = started.conversation;
      // Construct execution-scoped adapters. Never change a singleton's model for another account.
      const settings = started.turn.executionSettings;
      const turnResearch = settings && !researchAdapters ? createGoogleResearchAdapters({ geminiApiKey: config.geminiApiKey,
        geminiModel: settings.model, effort: settings.effort, mapsApiKey: config.mapsApiKey }) : research;
      const turnModel = settings && !modelAdapter && !(config.localMode && !config.realProviders)
        ? createGeminiModelAdapter({ apiKey: config.geminiApiKey, model: settings.model, effort: settings.effort,
          research: turnResearch, maxModelRequests: config.maxModelRequests, maxToolExecutions: config.maxToolExecutions, maxConcurrentTools: config.maxConcurrentTools, maxContextChars: config.contextMaxChars }) : model;
      const turnContext = contextService || createContextService({ research: turnResearch, readSnapshot, maxChars: config.contextMaxChars });
      if (started.replayed) {
        if (started.turn.status === "running") throw new AssistantFault("TURN_IN_PROGRESS", "Yêu cầu này đang được xử lý", { status: 409, retryable: true });
        const turn = await store.getTurn(started.turn.id, trusted.email);
        const events = queue();
        events.push({ seq: 1, type: "accepted", runId: turn.id, conversationId: conversation.id, replayed: true });
        events.push(turn.status === "completed"
          ? { seq: 2, runId: turn.id, type: "completed", turn: publicTurn(turn, trusted.email, config.confirmationSecret) }
          : { seq: 2, runId: turn.id, type: "failed", turn: publicTurn(turn, trusted.email, config.confirmationSecret), error: { code: turn.errorCode || "TURN_FAILED", message: "Yêu cầu trước không hoàn tất", retryable: true } });
        events.close();
        return { runId: turn.id, conversationId: conversation.id, events };
      }

      const events = queue();
      let sequence = 0;
      const emit = (event) => events.push({ seq: ++sequence, runId: started.turn.id, ...event });
      emit({ type: "accepted", runId: started.turn.id, conversationId: conversation.id, replayed: false });
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(new Error("deadline exceeded")), config.turnDeadlineMs);
      const abort = () => controller.abort(signal?.reason || new Error("Stream disconnected"));
      if (signal?.aborted) abort();
      signal?.addEventListener("abort", abort, { once: true });

      void (async () => {
        try {
          const [resolvedContext, history] = await withAbort(() => Promise.all([
            turnContext.assemble(trusted, canonicalRefs([...(started.turn.mentions || mentions), ...(started.turn.pinnedContext || initialPins)], 40), { signal: controller.signal }),
            store.listTurns(conversation.id, trusted.email, { limit: config.recentTurnLimit, completedOnly: true }),
          ]), controller.signal);
          await store.saveResolvedContext?.(started.turn.id, trusted.email, resolvedContext);
          const result = await withAbort(() => turnModel.run({
            message, continuation: started.turn.continuation || [],
            resolvedContext, contextService: turnContext, actor: trusted,
            history: history.filter((turn) => turn.id !== started.turn.id && turn.status === "completed"),
            signal: controller.signal,
            onProgress: ({ phase, label }) => emit({ type: "progress", phase, label }),
            onText: (text, reset = false) => emit({ type: "answer-delta", text, reset }),
            onContext: (items) => store.saveUsedContext?.(started.turn.id, trusted.email, items),
            onEvidence: (citations) => emit({ type: "evidence", citations }),
            onToolStart: ({ name, metadata }) => store.createToolRun({ turnId: started.turn.id, toolName: name, requestMetadata: metadata }),
            onToolFinish: (id, resultInfo) => id ? store.finishToolRun(id, {
              status: resultInfo.status,
              resultMetadata: resultInfo.metadata || {},
              errorCode: resultInfo.errorCode || null,
              durationMs: resultInfo.durationMs,
            }) : null,
          }), controller.signal);

          controller.signal.throwIfAborted();
          if (result.pendingAction) {
            if ((started.turn.segment || 0) >= 8) throw new AssistantFault("TOOL_BUDGET_EXCEEDED", "Đã đạt giới hạn 8 nhóm thay đổi cho yêu cầu này. Hãy gửi yêu cầu mới.", { status: 429 });
            await batches.stage({ turnId: started.turn.id, segment: started.turn.segment || 0, ...result.pendingAction,
              citations: result.citations, usedContext: result.usedContext || [], lifetimeMs: config.proposalLifetimeMs, email: trusted.email });
            const turn = (await withActions([await store.getTurn(started.turn.id, trusted.email)], trusted.email))[0];
            emit({ type: "awaiting_approval", turn });
            return;
          }
          let proposal = null;
          if (result.operations?.length) {
            const snapshot = result.targetSnapshot;
            if (!snapshot) throw new AssistantFault("INVALID_INPUT", "Đề xuất thiếu chuyến đi cần sửa");
            const compiled = result.compiledProposal || compilePlanProposal(snapshot, result.operations);
            const id = randomUUID();
            const expiresAt = new Date(Date.now() + config.proposalLifetimeMs);
            const digest = sha256(stableJson({ tripId: snapshot.tripId, operations: compiled.operations, preview: compiled.preview, baseRevision: snapshot.revision }));
            const token = createConfirmationToken({ id, digest, baseRevision: snapshot.revision, expiresAt: expiresAt.toISOString() }, trusted.email, config.confirmationSecret);
            proposal = {
              id,
              turnId: started.turn.id,
              tripSlug: snapshot.trip.slug,
              tripId: snapshot.tripId,
              operations: compiled.operations,
              preview: compiled.preview,
              citations: result.citations,
              baseRevision: snapshot.revision,
              digest,
              tokenHash: sha256(token),
              expiresAt: expiresAt.toISOString(),
            };
          }
          controller.signal.throwIfAborted();
          const turn = await store.publishTurn({
            turnId: started.turn.id,
            proposal,
            output: result.text,
            citations: result.citations,
            providerInteractionId: result.providerInteractionId,
            usedContext: result.usedContext || [],
          });
          emit({
            type: "completed",
            turn: (await withActions([turn], trusted.email))[0],
          });
        } catch (error) {
          const fault = controller.signal.aborted
            ? new AssistantFault("TURN_INTERRUPTED", "Yêu cầu đã bị gián đoạn; hãy thử lại", { status: 409, retryable: true })
            : assistantFault(error);
          await store.failTurn(started.turn.id, fault.code, started.turn.segment || 0).catch(() => {});
          await store.reconcile(trusted.email).catch(() => {});
          emit({ type: "failed", turn: { ...started.turn, status: "failed", errorCode: fault.code }, error: { code: fault.code, message: fault.message, retryable: fault.retryable, details: fault.details } });
        } finally {
          clearTimeout(deadline);
          signal?.removeEventListener("abort", abort);
          events.close();
        }
      })();

      return { runId: started.turn.id, conversationId: conversation.id, events, cancel: abort };
    },

    async getTurn({ actor, turnId }) {
      const trusted = assertPilotActor(actor);
      return (await withActions([await store.getTurn(turnId, trusted.email)], trusted.email))[0];
    },

    async confirmProposal({ actor, proposalId, confirmationToken }) {
      const trusted = assertPilotActor(actor);
      if (management) await management.assertEnabled(trusted.email);
      const changeSet = await store.getChangeSet(proposalId, trusted.email);
      if (changeSet.status !== "applied") throw new AssistantFault("LEGACY_PROPOSAL", "Hãy tạo lại đề xuất để phê duyệt nhóm thay đổi mới.", { status: 409 });
      if (changeSet.turnStatus !== "completed") throw new AssistantFault("PROPOSAL_INCOMPLETE", "Đề xuất thuộc yêu cầu chưa hoàn tất", { status: 409 });
      const expectedToken = createConfirmationToken(changeSet, trusted.email, config.confirmationSecret);
      if (!safeEqual(confirmationToken, expectedToken) || !safeEqual(sha256(confirmationToken), changeSet.tokenHash)) {
        throw new AssistantFault("CONFIRMATION_INVALID", "Mã xác nhận không hợp lệ", { status: 403 });
      }
      const receipt = await commitChangeSet({ store, changeSet, actorEmail: trusted.email });
      try { await invalidateCache(); }
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
