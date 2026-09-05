import { createAssistantStore } from "./store.mjs";

export function createBackgroundStore(store = createAssistantStore()) {
  const sql = store.sql;
  return {
    async job(turnId) {
      const [row] = await sql`SELECT j.*,t.status,t.input_text,t.client_turn_id,t.conversation_id,c.owner_email,p.slug AS trip_slug
        FROM assistant_jobs j JOIN assistant_turns t ON t.id=j.turn_id
        JOIN assistant_conversations c ON c.id=t.conversation_id JOIN trips p ON p.id=c.trip_id WHERE j.turn_id=${turnId}::UUID`;
      return row;
    },
    async claim(turnId, leaseMs, workflowId = null) {
      const [row] = await sql`WITH claimed AS (
        UPDATE assistant_jobs j SET claimed_at=NOW(),workflow_id=COALESCE(${workflowId},j.workflow_id) FROM assistant_turns t
        WHERE j.turn_id=${turnId}::UUID AND t.id=j.turn_id AND t.status='running' AND t.lease_expires_at>NOW()
          AND j.claimed_at IS NULL RETURNING j.turn_id
      ) UPDATE assistant_turns t SET lease_expires_at=NOW()+${leaseMs}*INTERVAL '1 millisecond'
        FROM claimed WHERE t.id=claimed.turn_id RETURNING t.id`;
      return Boolean(row);
    },
    async dispatchable(turnId = null) {
      return sql`UPDATE assistant_jobs j SET dispatch_after=NOW()+INTERVAL '1 minute',attempts=attempts+1
        WHERE j.turn_id IN (SELECT q.turn_id FROM assistant_jobs q JOIN assistant_turns t ON t.id=q.turn_id
          WHERE q.claimed_at IS NULL AND t.status='running' AND t.lease_expires_at>NOW() AND q.dispatch_after<=NOW()
          AND (${turnId}::UUID IS NULL OR q.turn_id=${turnId}::UUID)
          ORDER BY q.dispatch_after LIMIT 20 FOR UPDATE OF q SKIP LOCKED)
        RETURNING j.turn_id`;
    },
    async dispatched(turnId, workflowId) {
      await sql`UPDATE assistant_jobs SET workflow_id=${workflowId} WHERE turn_id=${turnId}::UUID AND claimed_at IS NULL`;
    },
    async append(turnId, event) {
      // The database serializes replay publication with Stop and worker completion.
      const { seq: _seq, ...payload } = event;
      void _seq;
      if (payload.turn?.changeSet) payload.turn = { ...payload.turn, changeSet: { ...payload.turn.changeSet, confirmationToken: undefined } };
      const [row] = await sql`SELECT append_assistant_event(${turnId}::UUID,${JSON.stringify(payload)}::JSONB) AS seq`;
      return row.seq === null ? null : Number(row.seq);
    },
    async events(turnId, after = 0) {
      const rows = await sql`SELECT seq,payload FROM assistant_events WHERE turn_id=${turnId}::UUID AND seq>${after} ORDER BY seq LIMIT 100`;
      return rows.map((row) => ({ ...row.payload, seq: row.seq }));
    },
    async summaries(ownerEmail) {
      await store.reconcile(ownerEmail);
      return sql`SELECT t.id,t.conversation_id AS "conversationId",p.slug AS "tripSlug",t.status,t.completed_at AS "completedAt"
        FROM assistant_jobs j JOIN assistant_turns t ON t.id=j.turn_id JOIN assistant_conversations c ON c.id=t.conversation_id
        JOIN trips p ON p.id=c.trip_id WHERE c.owner_email=${ownerEmail} AND t.created_at>NOW()-INTERVAL '24 hours'
        ORDER BY t.created_at DESC LIMIT 100`;
    },
  };
}
