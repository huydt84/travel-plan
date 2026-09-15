import { randomUUID } from "node:crypto";
import { canonicalRefs } from "./context.mjs";
import { AssistantFault } from "./errors.mjs";
import { logTurnFailure } from "./failure-diagnostics.mjs";
import { ASSISTANT_TOOL_NAMES, normalizeAllowedTools } from "./tool-catalog.mjs";
import { sanitizeTraceValue } from "./trace.mjs";

const conversationRecord = (row) => ({
  id: String(row.id),
  tripSlug: row.trip_slug,
  tripTitle: row.trip_title,
  title: row.title,
  pins: row.pins || [],
  pinsVersion: row.pins_version || 0,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: row.updated_at_iso || new Date(row.updated_at).toISOString(),
  status: row.status || null,
});

const turnRecord = (row) => ({
  id: String(row.id),
  clientTurnId: String(row.client_turn_id),
  exchangeId: String(row.exchange_id || row.id),
  retryOfTurnId: row.retry_of_turn_id ? String(row.retry_of_turn_id) : null,
  input: row.input_text,
  segment: row.segment || 0,
  continuation: row.continuation || [],
  allowedTools: row.allowed_tools == null ? [...ASSISTANT_TOOL_NAMES] : normalizeAllowedTools(row.allowed_tools) || [],
  executionSettings: row.execution_settings || null,
  mentions: row.mentions || [],
  pinnedContext: row.pinned_context || [],
  resolvedContext: row.resolved_context || [],
  usedContext: row.used_context || [],
  output: row.output_text,
  citations: row.citations || [],
  status: row.status,
  leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at).toISOString() : null,
  errorCode: row.error_code,
  createdAt: row.created_at_iso || new Date(row.created_at).toISOString(),
  completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
});

const changeSetRecord = (row) => row ? ({
  id: String(row.id),
  turnId: String(row.turn_id),
  tripTitle: row.trip_title,
  tripSlug: row.trip_slug,
  operations: row.operations,
  preview: row.preview,
  citations: row.citations || [],
  baseRevision: Number(row.base_revision),
  digest: row.digest,
  expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
  status: row.status,
  receipt: row.receipt,
  appliedAt: row.applied_at ? new Date(row.applied_at).toISOString() : null,
}) : null;

const handoffRecord = (row) => row ? ({
  id: String(row.id),
  conversationId: String(row.conversation_id),
  status: row.status,
  initiatedBy: { email: row.initiated_by_email, name: row.initiated_by_name },
  ownerSeenAt: row.owner_seen_at ? new Date(row.owner_seen_at).toISOString() : null,
  startedAt: new Date(row.started_at).toISOString(),
  closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
}) : null;

const handoffMessageRecord = (row) => ({
  id: String(row.id),
  handoffId: String(row.handoff_id),
  conversationId: String(row.conversation_id),
  clientMessageId: String(row.client_message_id),
  author: { email: row.author_email, name: row.author_name, role: row.author_role },
  body: row.body,
  contextRefs: row.context_refs || [],
  ordinal: Number(row.ordinal || 0),
  createdAt: new Date(row.created_at).toISOString(),
});

// Defer the app-owned connection until first use. Injected stores remain usable
// in Node/Playwright without loading framework-oriented .js modules.
const defaultSql = Object.assign(async (...args) => (await import("../db.js")).getSql()(...args), {
  transaction: async (...args) => (await import("../db.js")).getSql().transaction(...args),
});

export function createAssistantStore({ sql = defaultSql } = {}) {
  const getConversationRow = async (conversationId, ownerEmail) => {
    const rows = await sql`
      SELECT conversation.*, trip.slug AS trip_slug, trip.title AS trip_title
      FROM assistant_conversations conversation
      LEFT JOIN trips trip ON trip.id = conversation.trip_id
      WHERE conversation.id = ${conversationId} AND conversation.owner_email = ${ownerEmail}
      LIMIT 1
    `;
    if (!rows.length) throw new AssistantFault("CONVERSATION_NOT_FOUND", "Không tìm thấy cuộc trò chuyện", { status: 404 });
    return rows[0];
  };

  return {
    async reconcile(ownerEmail) {
      await sql.transaction((tx) => [
        tx`SELECT t.id FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id WHERE c.owner_email=${ownerEmail} AND t.status IN ('running','awaiting_approval','awaiting_input') ORDER BY t.id FOR UPDATE OF t`,
        tx`UPDATE assistant_turns t SET status='failed', error_code='TURN_INTERRUPTED', completed_at=NOW(), lease_expires_at=NULL,error_diagnostics='{"phase":"lease_expired"}'::JSONB
          FROM assistant_conversations c WHERE t.conversation_id=c.id AND c.owner_email=${ownerEmail}
          AND t.status='running' AND t.lease_expires_at <= NOW()
          AND NOT EXISTS(SELECT 1 FROM assistant_jobs j WHERE j.turn_id=t.id AND j.segment=t.segment AND j.segment>0 AND j.attempts=0)`,
        tx`UPDATE assistant_tool_runs r SET status='failed', error_code='TURN_INTERRUPTED'
          FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id
          WHERE r.turn_id=t.id AND c.owner_email=${ownerEmail} AND t.status='failed' AND r.status='running'`,
        tx`UPDATE assistant_change_sets p SET status='expired'
          FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id
          WHERE p.turn_id=t.id AND c.owner_email=${ownerEmail} AND p.status='staged' AND p.expires_at <= NOW()`,
        tx`UPDATE assistant_actions a SET status='expired',decided_at=NOW() FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id
          WHERE a.turn_id=t.id AND c.owner_email=${ownerEmail} AND a.status='pending' AND a.expires_at<=NOW()`,
        tx`UPDATE assistant_turns t SET status='completed',completed_at=NOW() FROM assistant_conversations c WHERE t.conversation_id=c.id AND c.owner_email=${ownerEmail}
          AND t.status='awaiting_approval' AND NOT EXISTS(SELECT 1 FROM assistant_actions a WHERE a.turn_id=t.id AND a.status='pending')`,
        tx`UPDATE assistant_turns t SET status='completed',completed_at=NOW() FROM assistant_conversations c WHERE t.conversation_id=c.id AND c.owner_email=${ownerEmail}
          AND t.status='awaiting_input' AND NOT EXISTS(SELECT 1 FROM assistant_questions q WHERE q.turn_id=t.id AND q.status='pending')`
      ]);
    },

    async getTurn(turnId, ownerEmail) {
      const [row] = await sql`SELECT t.* FROM assistant_turns t
        JOIN assistant_conversations c ON c.id=t.conversation_id
        WHERE t.id=${turnId}::UUID AND c.owner_email=${ownerEmail}`;
      if (!row) throw new AssistantFault("TURN_NOT_FOUND", "Không tìm thấy yêu cầu", { status: 404 });
      const [proposal] = await sql`SELECT p.*, trip.slug AS trip_slug, trip.title AS trip_title FROM assistant_change_sets p
        JOIN trips trip ON trip.id=p.trip_id WHERE p.turn_id=${turnId}::UUID`;
      return { ...turnRecord(row), conversationId: String(row.conversation_id), changeSet: changeSetRecord(proposal) };
    },

    async replaceLatestTurn({ turnId, ownerEmail, clientTurnId, input, leaseMs, maxTurnsPerHour }) {
      const [row] = await sql`SELECT replace_latest_assistant_turn(${ownerEmail},${turnId}::UUID,
        ${clientTurnId}::UUID,${input},${leaseMs},${maxTurnsPerHour}) AS result`;
      const result = row.result;
      if (result.error) {
        const messages = {
          TURN_NOT_FOUND: "Không tìm thấy yêu cầu",
          REPLACE_UNAVAILABLE: "Chỉ có thể sửa hoặc tạo lại tin nhắn mới nhất sau khi trợ lý trả lời xong.",
          REPLACE_APPLIED: "Không thể thay thế tin nhắn có thay đổi đã được áp dụng.",
          IDEMPOTENCY_MISMATCH: "Mã yêu cầu đã được dùng cho nội dung khác",
          TURN_RATE_LIMIT: "Bạn đã dùng hết lượt trợ lý trong giờ này; hãy thử lại sau",
        };
        throw new AssistantFault(result.error, messages[result.error] || "Không thể thay thế tin nhắn", {
          status: result.error === "TURN_NOT_FOUND" ? 404 : result.error === "TURN_RATE_LIMIT" ? 429 : 409,
          retryable: result.error === "TURN_RATE_LIMIT",
        });
      }
      return { turn: await this.getTurn(result.turnId, ownerEmail), replayed: result.replayed };
    },

    async findRequest(ownerEmail, clientTurnId) {
      const [handoff] = await sql`SELECT m.* FROM assistant_handoff_requests r
        JOIN assistant_handoff_messages m ON m.id=r.message_id
        WHERE r.owner_email=${ownerEmail} AND r.client_turn_id=${clientTurnId}::UUID`;
      if (handoff) {
        const [state] = await sql`SELECT * FROM assistant_handoffs WHERE id=${handoff.handoff_id}::UUID`;
        return { mode: "handoff", message: handoffMessageRecord(handoff), handoff: handoffRecord(state) };
      }
      const [row] = await sql`SELECT t.*, c.trip_id, c.id AS conversation_id
        FROM assistant_requests r JOIN assistant_turns t ON t.id=r.turn_id
        JOIN assistant_conversations c ON c.id=t.conversation_id
        WHERE r.owner_email=${ownerEmail} AND r.client_turn_id=${clientTurnId}::UUID`;
      return row ? this.getTurn(String(row.id), ownerEmail) : null;
    },

    async acceptMessage({ actor, tripSlug, conversationId, clientTurnId, input, title,
      leaseMs, maxTurnsPerHour, background = true, retryOfTurnId = null,
      mentions = [], initialPins = [], locale = null, triggerMatch = false,
      notificationRecipient, allowedTools = undefined }) {
      mentions = canonicalRefs(mentions); initialPins = canonicalRefs(initialPins);
      if (allowedTools === undefined && retryOfTurnId) {
        const [original] = await sql`SELECT to_jsonb(t)->'allowed_tools' AS allowed_tools FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id
          WHERE t.id=${retryOfTurnId}::UUID AND c.owner_email=${actor.email}`;
        allowedTools = original?.allowed_tools;
      }
      allowedTools ??= ASSISTANT_TOOL_NAMES;
      allowedTools = normalizeAllowedTools(allowedTools);
      if (!allowedTools) throw new AssistantFault("INVALID_INPUT", "Danh sách công cụ không hợp lệ");
      if (conversationId && initialPins.length) throw new AssistantFault("INVALID_INPUT", "Chỉ đặt ghim ban đầu khi tạo cuộc trò chuyện mới");
      if (tripSlug) {
        const [trip] = await sql`SELECT id FROM trips WHERE slug=${tripSlug}`;
        if (!trip) throw new AssistantFault("TRIP_NOT_FOUND", "Không tìm thấy chuyến đi", { status: 404 });
        const [legacy] = await sql`SELECT t.id FROM assistant_turns t
          JOIN assistant_conversations c ON c.id=t.conversation_id
          WHERE c.owner_email=${actor.email} AND c.trip_id=${trip.id} AND t.context_version=0
            AND (t.client_turn_id=${clientTurnId}::UUID OR t.id=${retryOfTurnId}::UUID) LIMIT 1`;
        if (!legacy) mentions = canonicalRefs([...mentions, { kind: "trip", id: String(trip.id) }]);
      }
      const ids = { conversation: randomUUID(), handoff: randomUUID(), message: randomUUID(), turn: randomUUID() };
      const defaultsOnly = allowedTools.length === ASSISTANT_TOOL_NAMES.length;
      const [row] = defaultsOnly ? await sql`SELECT accept_assistant_handoff_or_request(
        ${actor.email},${actor.name},${actor.isOwner},${conversationId}::UUID,${clientTurnId}::UUID,
        ${input},${title},${ids.conversation}::UUID,${ids.handoff}::UUID,${ids.message}::UUID,
        ${ids.turn}::UUID,${leaseMs},${maxTurnsPerHour},${JSON.stringify(mentions)}::JSONB,
        ${JSON.stringify(initialPins)}::JSONB,${retryOfTurnId}::UUID,${background},${triggerMatch},
        ${notificationRecipient}) AS result` : await sql`SELECT accept_assistant_handoff_or_request_with_tools(
        ${actor.email},${actor.name},${actor.isOwner},${conversationId}::UUID,${clientTurnId}::UUID,
        ${input},${title},${ids.conversation}::UUID,${ids.handoff}::UUID,${ids.message}::UUID,
        ${ids.turn}::UUID,${leaseMs},${maxTurnsPerHour},${JSON.stringify(mentions)}::JSONB,
        ${JSON.stringify(initialPins)}::JSONB,${retryOfTurnId}::UUID,${background},${triggerMatch},
        ${notificationRecipient},${JSON.stringify(allowedTools)}::JSONB) AS result`;
      const result = row.result;
      if (result.error) {
        const messages = {
          TURN_NOT_FOUND: "Không tìm thấy yêu cầu", RETRY_UNAVAILABLE: "Yêu cầu đã thay đổi. Hãy tải lại cuộc trò chuyện.",
          IDEMPOTENCY_MISMATCH: "Mã yêu cầu đã được dùng cho nội dung khác", TRIP_NOT_FOUND: "Không tìm thấy chuyến đi",
          CONVERSATION_NOT_FOUND: "Không tìm thấy cuộc trò chuyện", TURN_RATE_LIMIT: "Bạn đã dùng hết lượt trợ lý trong giờ này; hãy thử lại sau",
          TURN_IN_PROGRESS: "Cuộc trò chuyện đang xử lý một yêu cầu khác",
        };
        throw new AssistantFault(result.error, messages[result.error] || "Không thể nhận tin nhắn", {
          status: result.error.endsWith("NOT_FOUND") ? 404 : result.error === "TURN_RATE_LIMIT" ? 429 : 409,
          retryable: ["TURN_RATE_LIMIT", "TURN_IN_PROGRESS"].includes(result.error),
        });
      }
      const conversation = await this.getConversation(result.conversationId, actor.email);
      if (result.mode === "handoff") {
        const [message] = await sql`SELECT * FROM assistant_handoff_messages WHERE id=${result.messageId}::UUID`;
        const [handoff] = await sql`SELECT * FROM assistant_handoffs WHERE id=${result.handoffId}::UUID`;
        return { mode: "handoff", conversation, message: handoffMessageRecord(message),
          handoff: handoffRecord(handoff), replayed: result.replayed };
      }
      if (locale && !result.replayed) {
        try { await sql`UPDATE assistant_turns SET execution_settings=COALESCE(execution_settings,'{}'::JSONB) || ${JSON.stringify({ locale })}::JSONB WHERE id=${result.turnId}::UUID`; } catch {}
      }
      const [turn] = await sql`SELECT * FROM assistant_turns WHERE id=${result.turnId}::UUID`;
      return { mode: "assistant", turn: turnRecord(turn), conversation, replayed: result.replayed };
    },

    async acceptRequest({ ownerEmail, tripSlug, conversationId, clientTurnId, input, title, leaseMs, maxTurnsPerHour, background = false, retryOfTurnId = null, mentions = [], initialPins = [], locale = null, allowedTools = undefined }) {
      mentions = canonicalRefs(mentions); initialPins = canonicalRefs(initialPins);
      if (allowedTools === undefined && retryOfTurnId) {
        const [original] = await sql`SELECT to_jsonb(t)->'allowed_tools' AS allowed_tools FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id
          WHERE t.id=${retryOfTurnId}::UUID AND c.owner_email=${ownerEmail}`;
        allowedTools = original?.allowed_tools;
      }
      allowedTools ??= ASSISTANT_TOOL_NAMES;
      allowedTools = normalizeAllowedTools(allowedTools);
      if (!allowedTools) throw new AssistantFault("INVALID_INPUT", "Danh sách công cụ không hợp lệ");
      if (conversationId && initialPins.length) throw new AssistantFault("INVALID_INPUT", "Chỉ đặt ghim ban đầu khi tạo cuộc trò chuyện mới");
      if (tripSlug) {
        const [trip] = await sql`SELECT id FROM trips WHERE slug=${tripSlug}`;
        if (!trip) throw new AssistantFault("TRIP_NOT_FOUND", "Không tìm thấy chuyến đi", { status: 404 });
        // Requests accepted by the old API had no message mentions. Preserve
        // that identity on replay/retry; their trip was backfilled as a pin.
        const [legacy] = await sql`SELECT t.id FROM assistant_turns t
          JOIN assistant_conversations c ON c.id=t.conversation_id
          WHERE c.owner_email=${ownerEmail} AND c.trip_id=${trip.id} AND t.context_version=0
            AND (t.client_turn_id=${clientTurnId}::UUID OR t.id=${retryOfTurnId}::UUID) LIMIT 1`;
        if (!legacy) mentions = canonicalRefs([...mentions, { kind: "trip", id: String(trip.id) }]);
      }
      const defaultsOnly = allowedTools.length === ASSISTANT_TOOL_NAMES.length;
      const rows = defaultsOnly ? await sql`SELECT accept_assistant_context_request(${ownerEmail},${conversationId}::UUID,
        ${clientTurnId}::UUID,${input},${title},${randomUUID()}::UUID,${randomUUID()}::UUID,${leaseMs},${maxTurnsPerHour},
        ${JSON.stringify(mentions)}::JSONB,${JSON.stringify(initialPins)}::JSONB,${retryOfTurnId}::UUID,${background}) AS result`
        : await sql`SELECT accept_assistant_context_request_with_tools(${ownerEmail},${conversationId}::UUID,
        ${clientTurnId}::UUID,${input},${title},${randomUUID()}::UUID,${randomUUID()}::UUID,${leaseMs},${maxTurnsPerHour},
        ${JSON.stringify(mentions)}::JSONB,${JSON.stringify(initialPins)}::JSONB,${retryOfTurnId}::UUID,${background},${JSON.stringify(allowedTools)}::JSONB) AS result`;
      const result = rows[0].result;
      if (result.error) {
        const messages = {
          TURN_NOT_FOUND: 'Không tìm thấy yêu cầu', RETRY_UNAVAILABLE: 'Yêu cầu đã thay đổi. Hãy tải lại cuộc trò chuyện.',
          IDEMPOTENCY_MISMATCH: 'Mã yêu cầu đã được dùng cho nội dung khác',
          TRIP_NOT_FOUND: 'Không tìm thấy chuyến đi', CONVERSATION_NOT_FOUND: 'Không tìm thấy cuộc trò chuyện',
          CONVERSATION_TRIP_MISMATCH: 'Cuộc trò chuyện thuộc chuyến đi khác',
          TURN_RATE_LIMIT: 'Bạn đã dùng hết lượt trợ lý trong giờ này; hãy thử lại sau',
          TURN_IN_PROGRESS: 'Cuộc trò chuyện đang xử lý một yêu cầu khác',
        };
        throw new AssistantFault(result.error, messages[result.error], {
          status: result.error.endsWith('NOT_FOUND') ? 404 : result.error === 'TURN_RATE_LIMIT' ? 429 : 409,
          retryable: ['TURN_RATE_LIMIT', 'TURN_IN_PROGRESS'].includes(result.error),
        });
      }
      if (locale && !result.replayed) {
        try { await sql`UPDATE assistant_turns SET execution_settings = COALESCE(execution_settings,'{}'::JSONB) || ${JSON.stringify({ locale })}::JSONB WHERE id=${result.turnId}::UUID`; } catch {}
      }
      const [turn] = await sql`SELECT * FROM assistant_turns WHERE id=${result.turnId}::UUID`;
      return { turn: turnRecord(turn), conversation: await this.getConversation(result.conversationId, ownerEmail), replayed: result.replayed };
    },

    async publishTurn({ turnId, output, citations, providerInteractionId, proposal = null, usedContext = [] }) {
      // The proposal is visible only when the still-live turn completes in the
      // same statement. A late provider response cannot resurrect an expired run.
      const [row] = await sql`WITH finished AS (
        UPDATE assistant_turns SET used_context=${JSON.stringify(usedContext)}::JSONB, output_text=${output}, citations=${JSON.stringify(citations)}::JSONB,
          provider_interaction_id=${providerInteractionId || null}, status='completed', completed_at=NOW(), lease_expires_at=NULL
        WHERE id=${turnId}::UUID AND status='running' AND lease_expires_at > NOW() RETURNING *
      ), staged AS (
        INSERT INTO assistant_change_sets(id,turn_id,trip_id,operations,preview,citations,base_revision,digest,token_hash,expires_at,status)
        SELECT ${proposal?.id || null}::UUID,f.id,${proposal?.tripId || null}::BIGINT,${JSON.stringify(proposal?.operations || [])}::JSONB,
          ${JSON.stringify(proposal?.preview || {})}::JSONB,${JSON.stringify(citations)}::JSONB,
          ${proposal?.baseRevision || 0},${proposal?.digest || ''},${proposal?.tokenHash || ''},${proposal?.expiresAt || null}::TIMESTAMPTZ,'staged'
        FROM finished f JOIN assistant_conversations c ON c.id=f.conversation_id
        WHERE ${Boolean(proposal)}
      ), touched AS (
        UPDATE assistant_conversations c SET updated_at=NOW() FROM finished f WHERE c.id=f.conversation_id
      ) SELECT * FROM finished`;
      if (!row) throw new AssistantFault('TURN_INTERRUPTED', 'Yêu cầu đã bị gián đoạn; hãy thử lại', { status: 409, retryable: true });
      return { ...turnRecord(row), changeSet: proposal ? await this.getChangeSet(proposal.id, null) : null };
    },

    async listConversations(ownerEmail, { tripSlug = null, limit = 30, before = null } = {}) {
      const rows = await sql`
        SELECT conversation.*, trip.slug AS trip_slug, trip.title AS trip_title,
          to_char(conversation.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at_iso,
          CASE WHEN EXISTS(SELECT 1 FROM assistant_handoffs h WHERE h.conversation_id=conversation.id AND h.status='active')
            THEN 'handoff' ELSE (SELECT t.status FROM assistant_turns t WHERE t.conversation_id=conversation.id ORDER BY t.created_at DESC,t.id DESC LIMIT 1) END AS status
        FROM assistant_conversations conversation
        LEFT JOIN trips trip ON trip.id = conversation.trip_id
        WHERE conversation.owner_email = ${ownerEmail}
          AND (${tripSlug}::TEXT IS NULL OR trip.slug = ${tripSlug})
        AND (${before?.updatedAt || null}::TIMESTAMPTZ IS NULL OR
            (conversation.updated_at,conversation.id) < (${before?.updatedAt || null}::TIMESTAMPTZ,${before?.id || null}::UUID))
        ORDER BY conversation.updated_at DESC, conversation.id DESC
        LIMIT ${limit}
      `;
      return rows.map(conversationRecord);
    },

    async getConversation(conversationId, ownerEmail) {
      return conversationRecord(await getConversationRow(conversationId, ownerEmail));
    },

    async createConversation({ ownerEmail, title }) {
      const [row] = await sql`INSERT INTO assistant_conversations(id,owner_email,title) VALUES(${randomUUID()}::UUID,${ownerEmail},${title}) RETURNING *`;
      return conversationRecord(row);
    },

    async getActiveHandoff(conversationId, ownerEmail) {
      const [row] = await sql`SELECT h.* FROM assistant_handoffs h JOIN assistant_conversations c ON c.id=h.conversation_id
        WHERE h.conversation_id=${conversationId}::UUID AND c.owner_email=${ownerEmail} AND h.status='active'`;
      return handoffRecord(row);
    },

    async listHandoffTimeline(conversationId, ownerEmail) {
      await getConversationRow(conversationId, ownerEmail);
      const handoffs = await sql`SELECT * FROM assistant_handoffs WHERE conversation_id=${conversationId}::UUID ORDER BY started_at,id`;
      const messages = await sql`SELECT * FROM assistant_handoff_messages WHERE conversation_id=${conversationId}::UUID ORDER BY ordinal`;
      return {
        handoffs: handoffs.map(handoffRecord),
        messages: messages.map(handoffMessageRecord),
      };
    },

    async listModelHistory(conversationId, ownerEmail, { limit = 24 } = {}) {
      await getConversationRow(conversationId, ownerEmail);
      const rows = await sql`SELECT * FROM (
        SELECT t.created_at,t.id::TEXT AS id,'assistant' AS kind,t.input_text AS user_text,t.output_text AS assistant_text,
          t.mentions,t.pinned_context,t.citations,NULL::BIGINT AS ordinal FROM assistant_turns t
          WHERE t.conversation_id=${conversationId}::UUID AND t.status='completed'
            AND NOT EXISTS(SELECT 1 FROM assistant_turns successor WHERE successor.retry_of_turn_id=t.id)
        UNION ALL
        SELECT m.created_at,m.id::TEXT,'handoff',
          CASE WHEN m.author_role='participant' THEN m.body ELSE NULL END,
          CASE WHEN m.author_role='owner' THEN m.body ELSE NULL END,'[]'::JSONB,'[]'::JSONB,'[]'::JSONB,m.ordinal
          FROM assistant_handoff_messages m JOIN assistant_handoffs h ON h.id=m.handoff_id
          WHERE m.conversation_id=${conversationId}::UUID AND h.status='closed'
      ) history ORDER BY created_at DESC,ordinal DESC NULLS LAST,id DESC LIMIT ${limit}`;
      return rows.reverse().map((row) => row.kind === "assistant"
        ? { id: row.id, kind: "assistant", input: row.user_text, output: row.assistant_text, mentions: row.mentions,
          pinnedContext: row.pinned_context, citations: row.citations }
        : { id: row.id, kind: "handoff", user: row.user_text, owner: row.assistant_text });
    },
    async updatePins(conversationId, ownerEmail, pins, version) {
      await getConversationRow(conversationId, ownerEmail);
      const [row] = await sql`UPDATE assistant_conversations SET pins=${JSON.stringify(canonicalRefs(pins))}::JSONB,pins_version=pins_version+1
        WHERE id=${conversationId}::UUID AND owner_email=${ownerEmail} AND pins_version=${version} RETURNING *`;
      if (!row) throw new AssistantFault("CONTEXT_CONFLICT", "Ngữ cảnh đã thay đổi. Hãy tải lại cuộc trò chuyện.", { status: 409 });
      return conversationRecord(row);
    },
    async saveUsedContext(turnId, ownerEmail, context) {
      await sql`UPDATE assistant_turns t SET used_context=${JSON.stringify(context)}::JSONB FROM assistant_conversations c
        WHERE t.id=${turnId}::UUID AND c.id=t.conversation_id AND c.owner_email=${ownerEmail} AND t.status='running'`;
    },
    async saveResolvedContext(turnId, ownerEmail, context) {
      await sql`UPDATE assistant_turns t SET resolved_context=${JSON.stringify(context)}::JSONB FROM assistant_conversations c
        WHERE t.id=${turnId}::UUID AND c.id=t.conversation_id AND c.owner_email=${ownerEmail} AND t.status='running'`;
    },

    async listTurns(conversationId, ownerEmail, { limit = 60, before = null, completedOnly = false } = {}) {
      await getConversationRow(conversationId, ownerEmail);
      const rows = await sql`
        SELECT turn.*, to_char(root.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso
        FROM assistant_turns turn
        JOIN assistant_turns root ON root.id=COALESCE(turn.exchange_id,turn.id)
        WHERE NOT EXISTS (SELECT 1 FROM assistant_turns successor WHERE successor.retry_of_turn_id=turn.id)
          AND turn.conversation_id = ${conversationId}
          AND (${completedOnly} = false OR turn.status = 'completed')
          AND (${before?.createdAt || null}::TIMESTAMPTZ IS NULL OR (root.created_at, root.id) < (${before?.createdAt || null}::TIMESTAMPTZ, ${before?.id || null}::UUID))
        ORDER BY root.created_at DESC, root.id DESC
        LIMIT ${limit}
      `;
      const changeRows = await sql`
        SELECT change_set.*, trip.slug AS trip_slug, trip.title AS trip_title
        FROM assistant_change_sets change_set
        JOIN trips trip ON trip.id = change_set.trip_id
        JOIN assistant_turns turn ON turn.id = change_set.turn_id
        JOIN assistant_conversations conversation ON conversation.id = turn.conversation_id
        WHERE conversation.id = ${conversationId} AND conversation.owner_email = ${ownerEmail}
          AND turn.id = ANY(${rows.map((row) => String(row.id))}::UUID[])
      `;
      const changeByTurn = new Map(changeRows.map((row) => [String(row.turn_id), changeSetRecord(row)]));
      return rows.reverse().map((row) => ({ ...turnRecord(row), changeSet: changeByTurn.get(String(row.id)) || null }));
    },

    async failTurn(turnId, code, segment = null, diagnostic = { phase: "execution" }) {
      const rows = await sql`
        UPDATE assistant_turns
        SET status = 'failed', error_code = ${code}, completed_at = NOW(), lease_expires_at = NULL,error_diagnostics=${JSON.stringify(diagnostic)}::JSONB
        WHERE id = ${turnId}::UUID AND status IN ('running','awaiting_approval','awaiting_input') AND (${segment}::INTEGER IS NULL OR segment=${segment}) RETURNING id
      `;
      if (rows.length && code !== "TURN_CANCELLED") logTurnFailure(turnId, code, diagnostic);
    },

    async createToolRun({ turnId, toolName, requestMetadata = {} }) {
      const id = randomUUID();
      const rows = await sql`
        INSERT INTO assistant_tool_runs (id, turn_id, tool_name, status, request_metadata)
        SELECT ${id}::UUID, t.id, ${toolName}, 'running', ${JSON.stringify(sanitizeTraceValue(requestMetadata))}::JSONB
        FROM assistant_turns t WHERE t.id=${turnId}::UUID AND t.status='running' AND t.lease_expires_at > NOW() RETURNING id
      `;
      return rows[0]?.id || null;
    },

    async finishToolRun(id, { status = "completed", resultMetadata = {}, errorCode = null, durationMs = null } = {}) {
      await sql`
        UPDATE assistant_tool_runs
        SET status = ${status}, result_metadata = ${JSON.stringify(sanitizeTraceValue(resultMetadata))}::JSONB,
            error_code = ${errorCode}, duration_ms = ${durationMs}
        WHERE id = ${id}::UUID AND status = 'running'
      `;
    },

    async stageChangeSet({ id = randomUUID(), turnId, tripSlug, operations, preview, citations, baseRevision, digest, tokenHash, expiresAt }) {
      const rows = await sql`
        INSERT INTO assistant_change_sets (
          id, turn_id, trip_id, operations, preview, citations, base_revision,
          digest, token_hash, expires_at, status
        )
        SELECT ${id}::UUID, ${turnId}::UUID, trip.id, ${JSON.stringify(operations)}::JSONB,
               ${JSON.stringify(preview)}::JSONB, ${JSON.stringify(citations)}::JSONB,
               ${baseRevision}, ${digest}, ${tokenHash}, ${expiresAt.toISOString()}, 'staged'
        FROM trips trip WHERE trip.slug = ${tripSlug}
        RETURNING *
      `;
      if (!rows.length) throw new AssistantFault("TRIP_NOT_FOUND", "Không tìm thấy chuyến đi", { status: 404 });
      return this.getChangeSet(id, null);
    },

    async getChangeSet(changeSetId, ownerEmail) {
      const rows = await sql`
        SELECT change_set.*, trip.slug AS trip_slug, trip.title AS trip_title, conversation.owner_email, turn.status AS turn_status
        FROM assistant_change_sets change_set
        JOIN trips trip ON trip.id = change_set.trip_id
        JOIN assistant_turns turn ON turn.id = change_set.turn_id
        JOIN assistant_conversations conversation ON conversation.id = turn.conversation_id
        WHERE change_set.id = ${changeSetId}::UUID
          AND (${ownerEmail}::TEXT IS NULL OR conversation.owner_email = ${ownerEmail})
        LIMIT 1
      `;
      if (!rows.length) throw new AssistantFault("PROPOSAL_NOT_FOUND", "Không tìm thấy đề xuất", { status: 404 });
      return { ...changeSetRecord(rows[0]), ownerEmail: rows[0].owner_email, turnStatus: rows[0].turn_status, tokenHash: rows[0].token_hash, tripId: String(rows[0].trip_id) };
    },

    sql,
  };
}
