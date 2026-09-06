import { randomUUID } from "node:crypto";
import { canonicalRefs } from "./context.mjs";
import { AssistantFault } from "./errors.mjs";

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
  expiresAt: new Date(row.expires_at).toISOString(),
  status: row.status,
  receipt: row.receipt,
  appliedAt: row.applied_at ? new Date(row.applied_at).toISOString() : null,
}) : null;

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
        tx`SELECT t.id FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id WHERE c.owner_email=${ownerEmail} AND t.status IN ('running','awaiting_approval') ORDER BY t.id FOR UPDATE OF t`,
        tx`UPDATE assistant_turns t SET status='failed', error_code='TURN_INTERRUPTED', completed_at=NOW(), lease_expires_at=NULL
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
          AND t.status='awaiting_approval' AND NOT EXISTS(SELECT 1 FROM assistant_actions a WHERE a.turn_id=t.id AND a.status='pending')`
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

    async findRequest(ownerEmail, clientTurnId) {
      const [row] = await sql`SELECT t.*, c.trip_id, c.id AS conversation_id
        FROM assistant_requests r JOIN assistant_turns t ON t.id=r.turn_id
        JOIN assistant_conversations c ON c.id=t.conversation_id
        WHERE r.owner_email=${ownerEmail} AND r.client_turn_id=${clientTurnId}::UUID`;
      return row ? this.getTurn(String(row.id), ownerEmail) : null;
    },

    async acceptRequest({ ownerEmail, tripSlug, conversationId, clientTurnId, input, title, leaseMs, maxTurnsPerHour, background = false, retryOfTurnId = null, mentions = [], initialPins = [] }) {
      mentions = canonicalRefs(mentions); initialPins = canonicalRefs(initialPins);
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
      const rows = await sql`SELECT accept_assistant_context_request(${ownerEmail},${conversationId}::UUID,
        ${clientTurnId}::UUID,${input},${title},${randomUUID()}::UUID,${randomUUID()}::UUID,${leaseMs},${maxTurnsPerHour},
        ${JSON.stringify(mentions)}::JSONB,${JSON.stringify(initialPins)}::JSONB,${retryOfTurnId}::UUID,${background}) AS result`;
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
          (SELECT t.status FROM assistant_turns t WHERE t.conversation_id=conversation.id ORDER BY t.created_at DESC,t.id DESC LIMIT 1) AS status
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

    async failTurn(turnId, code, segment = null) {
      await sql`
        UPDATE assistant_turns
        SET status = 'failed', error_code = ${code}, completed_at = NOW(), lease_expires_at = NULL
        WHERE id = ${turnId}::UUID AND status IN ('running','awaiting_approval') AND (${segment}::INTEGER IS NULL OR segment=${segment})
      `;
    },

    async createToolRun({ turnId, toolName, requestMetadata = {} }) {
      const id = randomUUID();
      const rows = await sql`
        INSERT INTO assistant_tool_runs (id, turn_id, tool_name, status, request_metadata)
        SELECT ${id}::UUID, t.id, ${toolName}, 'running', ${JSON.stringify(requestMetadata)}::JSONB
        FROM assistant_turns t WHERE t.id=${turnId}::UUID AND t.status='running' AND t.lease_expires_at > NOW() RETURNING id
      `;
      return rows[0]?.id || null;
    },

    async finishToolRun(id, { status = "completed", resultMetadata = {}, errorCode = null, durationMs = null } = {}) {
      await sql`
        UPDATE assistant_tool_runs
        SET status = ${status}, result_metadata = ${JSON.stringify(resultMetadata)}::JSONB,
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
