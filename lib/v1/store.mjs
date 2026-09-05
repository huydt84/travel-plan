import { randomUUID } from "node:crypto";
import { AssistantFault } from "./errors.mjs";

const conversationRecord = (row) => ({
  id: String(row.id),
  tripSlug: row.trip_slug,
  tripTitle: row.trip_title,
  title: row.title,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const turnRecord = (row) => ({
  id: String(row.id),
  clientTurnId: String(row.client_turn_id),
  input: row.input_text,
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
      JOIN trips trip ON trip.id = conversation.trip_id
      WHERE conversation.id = ${conversationId} AND conversation.owner_email = ${ownerEmail}
      LIMIT 1
    `;
    if (!rows.length) throw new AssistantFault("CONVERSATION_NOT_FOUND", "Không tìm thấy cuộc trò chuyện", { status: 404 });
    return rows[0];
  };

  return {
    async reconcile(ownerEmail) {
      await sql.transaction((tx) => [
        tx`UPDATE assistant_turns t SET status='failed', error_code='TURN_INTERRUPTED', completed_at=NOW(), lease_expires_at=NULL
          FROM assistant_conversations c WHERE t.conversation_id=c.id AND c.owner_email=${ownerEmail}
          AND t.status='running' AND t.lease_expires_at <= NOW()`,
        tx`UPDATE assistant_tool_runs r SET status='failed', error_code='TURN_INTERRUPTED'
          FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id
          WHERE r.turn_id=t.id AND c.owner_email=${ownerEmail} AND t.status='failed' AND r.status='running'`,
        tx`UPDATE assistant_change_sets p SET status='expired'
          FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id
          WHERE p.turn_id=t.id AND c.owner_email=${ownerEmail} AND p.status='staged' AND p.expires_at <= NOW()`
      ]);
    },

    async getTurn(turnId, ownerEmail) {
      const [row] = await sql`SELECT t.* FROM assistant_turns t
        JOIN assistant_conversations c ON c.id=t.conversation_id
        WHERE t.id=${turnId}::UUID AND c.owner_email=${ownerEmail}`;
      if (!row) throw new AssistantFault("TURN_NOT_FOUND", "Không tìm thấy yêu cầu", { status: 404 });
      const [proposal] = await sql`SELECT p.*, trip.slug AS trip_slug FROM assistant_change_sets p
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

    async acceptRequest({ ownerEmail, tripSlug, conversationId, clientTurnId, input, title, leaseMs, maxTurnsPerHour }) {
      const [row] = await sql`SELECT accept_assistant_request(${ownerEmail},${tripSlug},${conversationId}::UUID,
        ${clientTurnId}::UUID,${input},${title},${randomUUID()}::UUID,${randomUUID()}::UUID,${leaseMs},${maxTurnsPerHour}) AS result`;
      const result = row.result;
      if (result.error) {
        const messages = {
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

    async publishTurn({ turnId, output, citations, providerInteractionId, proposal = null }) {
      // The proposal is visible only when the still-live turn completes in the
      // same statement. A late provider response cannot resurrect an expired run.
      const [row] = await sql`WITH finished AS (
        UPDATE assistant_turns SET output_text=${output}, citations=${JSON.stringify(citations)}::JSONB,
          provider_interaction_id=${providerInteractionId || null}, status='completed', completed_at=NOW(), lease_expires_at=NULL
        WHERE id=${turnId}::UUID AND status='running' AND lease_expires_at > NOW() RETURNING *
      ), staged AS (
        INSERT INTO assistant_change_sets(id,turn_id,trip_id,operations,preview,citations,base_revision,digest,token_hash,expires_at,status)
        SELECT ${proposal?.id || null}::UUID,f.id,c.trip_id,${JSON.stringify(proposal?.operations || [])}::JSONB,
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

    async listConversations(ownerEmail, { tripSlug = null, limit = 30 } = {}) {
      const rows = await sql`
        SELECT conversation.*, trip.slug AS trip_slug, trip.title AS trip_title
        FROM assistant_conversations conversation
        JOIN trips trip ON trip.id = conversation.trip_id
        WHERE conversation.owner_email = ${ownerEmail}
          AND (${tripSlug}::TEXT IS NULL OR trip.slug = ${tripSlug})
        ORDER BY conversation.updated_at DESC, conversation.id DESC
        LIMIT ${limit}
      `;
      return rows.map(conversationRecord);
    },

    async getConversation(conversationId, ownerEmail) {
      return conversationRecord(await getConversationRow(conversationId, ownerEmail));
    },

    async createConversation({ ownerEmail, tripSlug, title }) {
      const id = randomUUID();
      const rows = await sql`
        INSERT INTO assistant_conversations (id, owner_email, trip_id, title)
        SELECT ${id}::UUID, ${ownerEmail}, trip.id, ${title}
        FROM trips trip
        WHERE trip.slug = ${tripSlug}
        RETURNING *
      `;
      if (!rows.length) throw new AssistantFault("TRIP_NOT_FOUND", "Không tìm thấy chuyến đi", { status: 404 });
      return this.getConversation(id, ownerEmail);
    },

    async listTurns(conversationId, ownerEmail, { limit = 60, before = null, completedOnly = false } = {}) {
      await getConversationRow(conversationId, ownerEmail);
      const rows = await sql`
        SELECT turn.*, to_char(turn.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso
        FROM assistant_turns turn
        WHERE turn.conversation_id = ${conversationId}
          AND (${completedOnly} = false OR turn.status = 'completed')
          AND (${before?.createdAt || null}::TIMESTAMPTZ IS NULL OR (turn.created_at, turn.id) < (${before?.createdAt || null}::TIMESTAMPTZ, ${before?.id || null}::UUID))
        ORDER BY turn.created_at DESC, turn.id DESC
        LIMIT ${limit}
      `;
      const changeRows = await sql`
        SELECT change_set.*, trip.slug AS trip_slug
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

    async failTurn(turnId, code) {
      await sql`
        UPDATE assistant_turns
        SET status = 'failed', error_code = ${code}, completed_at = NOW(), lease_expires_at = NULL
        WHERE id = ${turnId}::UUID AND status = 'running'
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
        SELECT change_set.*, trip.slug AS trip_slug, conversation.owner_email, turn.status AS turn_status
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
