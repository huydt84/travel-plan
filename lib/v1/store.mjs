import { randomUUID } from "node:crypto";
import { getSql } from "../db.js";
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
  errorCode: row.error_code,
  createdAt: new Date(row.created_at).toISOString(),
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

export function createAssistantStore({ sql = getSql(), now = () => new Date() } = {}) {
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

    async listTurns(conversationId, ownerEmail, { limit = 60 } = {}) {
      await getConversationRow(conversationId, ownerEmail);
      const rows = await sql`
        SELECT turn.*
        FROM assistant_turns turn
        WHERE turn.conversation_id = ${conversationId}
        ORDER BY turn.created_at, turn.id
        LIMIT ${limit}
      `;
      const changeRows = await sql`
        SELECT change_set.*, trip.slug AS trip_slug
        FROM assistant_change_sets change_set
        JOIN trips trip ON trip.id = change_set.trip_id
        JOIN assistant_turns turn ON turn.id = change_set.turn_id
        JOIN assistant_conversations conversation ON conversation.id = turn.conversation_id
        WHERE conversation.id = ${conversationId} AND conversation.owner_email = ${ownerEmail}
      `;
      const changeByTurn = new Map(changeRows.map((row) => [String(row.turn_id), changeSetRecord(row)]));
      return rows.map((row) => ({ ...turnRecord(row), changeSet: changeByTurn.get(String(row.id)) || null }));
    },

    async beginTurn({ conversationId, ownerEmail, clientTurnId, input, leaseMs, maxTurnsPerHour = 30 }) {
      await getConversationRow(conversationId, ownerEmail);
      const existingRows = await sql`
        SELECT * FROM assistant_turns
        WHERE conversation_id = ${conversationId} AND client_turn_id = ${clientTurnId}::UUID
        LIMIT 1
      `;
      if (existingRows.length) {
        const existing = turnRecord(existingRows[0]);
        if (existing.input !== input) throw new AssistantFault("IDEMPOTENCY_MISMATCH", "Mã yêu cầu đã được dùng cho nội dung khác", { status: 409 });
        return { turn: existing, replayed: true };
      }
      const [usage] = await sql`
        SELECT COUNT(*)::INTEGER AS count
        FROM assistant_turns turn
        JOIN assistant_conversations conversation ON conversation.id = turn.conversation_id
        WHERE conversation.owner_email = ${ownerEmail}
          AND turn.created_at >= NOW() - INTERVAL '1 hour'
      `;
      if (Number(usage?.count || 0) >= maxTurnsPerHour) {
        throw new AssistantFault("TURN_RATE_LIMIT", "Bạn đã dùng hết lượt trợ lý trong giờ này; hãy thử lại sau", { status: 429, retryable: true });
      }
      await sql`
        UPDATE assistant_turns
        SET status = 'failed', error_code = 'TURN_INTERRUPTED', completed_at = NOW()
        WHERE conversation_id = ${conversationId} AND status = 'running' AND lease_expires_at < NOW()
      `;
      const id = randomUUID();
      const leaseExpiresAt = new Date(now().getTime() + leaseMs);
      try {
        const [row] = await sql`
          INSERT INTO assistant_turns (id, conversation_id, client_turn_id, input_text, status, lease_expires_at)
          VALUES (${id}::UUID, ${conversationId}::UUID, ${clientTurnId}::UUID, ${input}, 'running', ${leaseExpiresAt.toISOString()})
          RETURNING *
        `;
        return { turn: turnRecord(row), replayed: false };
      } catch (error) {
        if (error.code === "23505") throw new AssistantFault("TURN_IN_PROGRESS", "Cuộc trò chuyện đang xử lý một yêu cầu khác", { status: 409, retryable: true });
        throw error;
      }
    },

    async completeTurn({ turnId, output, citations, providerInteractionId = null }) {
      const [row] = await sql`
        UPDATE assistant_turns turn
        SET output_text = ${output}, citations = ${JSON.stringify(citations)}::JSONB,
            status = 'completed', provider_interaction_id = ${providerInteractionId}, completed_at = NOW(), lease_expires_at = NULL
        WHERE turn.id = ${turnId}::UUID
        RETURNING turn.*
      `;
      await sql`
        UPDATE assistant_conversations conversation
        SET updated_at = NOW()
        FROM assistant_turns turn
        WHERE turn.id = ${turnId}::UUID AND conversation.id = turn.conversation_id
      `;
      return turnRecord(row);
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
      await sql`
        INSERT INTO assistant_tool_runs (id, turn_id, tool_name, status, request_metadata)
        VALUES (${id}::UUID, ${turnId}::UUID, ${toolName}, 'running', ${JSON.stringify(requestMetadata)}::JSONB)
      `;
      return id;
    },

    async finishToolRun(id, { status = "completed", resultMetadata = {}, errorCode = null, durationMs = null } = {}) {
      await sql`
        UPDATE assistant_tool_runs
        SET status = ${status}, result_metadata = ${JSON.stringify(resultMetadata)}::JSONB,
            error_code = ${errorCode}, duration_ms = ${durationMs}
        WHERE id = ${id}::UUID
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
        SELECT change_set.*, trip.slug AS trip_slug, conversation.owner_email
        FROM assistant_change_sets change_set
        JOIN trips trip ON trip.id = change_set.trip_id
        JOIN assistant_turns turn ON turn.id = change_set.turn_id
        JOIN assistant_conversations conversation ON conversation.id = turn.conversation_id
        WHERE change_set.id = ${changeSetId}::UUID
          AND (${ownerEmail}::TEXT IS NULL OR conversation.owner_email = ${ownerEmail})
        LIMIT 1
      `;
      if (!rows.length) throw new AssistantFault("PROPOSAL_NOT_FOUND", "Không tìm thấy đề xuất", { status: 404 });
      return { ...changeSetRecord(rows[0]), ownerEmail: rows[0].owner_email, tokenHash: rows[0].token_hash, tripId: String(rows[0].trip_id) };
    },

    sql,
  };
}
