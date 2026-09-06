import { createAssistantStore } from "./store.mjs";

export function createBackgroundStore(store = createAssistantStore()) {
  const sql = store.sql;
  return {
    async job(turnId) {
      const [row] = await sql`SELECT j.*,t.status,t.input_text,t.client_turn_id,t.conversation_id,c.owner_email,p.slug AS trip_slug
        FROM assistant_jobs j JOIN assistant_turns t ON t.id=j.turn_id
        JOIN assistant_conversations c ON c.id=t.conversation_id LEFT JOIN trips p ON p.id=c.trip_id WHERE j.turn_id=${turnId}::UUID`;
      return row;
    },
    async claim(turnId, leaseMs, workflowId = null, segment = 0) {
      const [row] = await sql`SELECT claim_assistant_segment(${turnId}::UUID,${leaseMs},${workflowId},${segment}) AS claimed`;
      return row.claimed;
    },
    async pendingContinuations(ownerEmail) {
      return sql`SELECT j.turn_id AS id FROM assistant_jobs j JOIN assistant_turns t ON t.id=j.turn_id JOIN assistant_conversations c ON c.id=t.conversation_id
        WHERE c.owner_email=${ownerEmail} AND t.status='running' AND j.segment>0 AND j.segment=t.segment AND j.attempts=0`;
    },
    async beginDispatch(turnId, segment = 0) {
      const rows = await sql`WITH ready AS (
        UPDATE assistant_turns t SET lease_expires_at=NOW()+INTERVAL '60 seconds'
        WHERE t.id=${turnId}::UUID AND t.segment=${segment} AND t.status='running'
          AND (t.segment>0 OR t.lease_expires_at>NOW())
          AND EXISTS(SELECT 1 FROM assistant_jobs j WHERE j.turn_id=t.id AND j.segment=t.segment AND j.attempts=0) RETURNING t.id
      ) UPDATE assistant_jobs j SET attempts=1 FROM ready t WHERE j.turn_id=t.id AND j.segment=${segment} AND j.attempts=0 RETURNING j.turn_id`;
      return rows.length > 0;
    },
    async failDispatch(turnId, segment = 0) {
      await sql`UPDATE assistant_turns t SET status='failed',error_code='DISPATCH_FAILED',completed_at=NOW(),lease_expires_at=NULL
        WHERE id=${turnId}::UUID AND segment=${segment} AND status='running' AND EXISTS(SELECT 1 FROM assistant_jobs j WHERE j.turn_id=t.id AND j.segment=${segment} AND j.claimed_at IS NULL)`;
    },
    async dispatched(turnId, workflowId, segment = 0) {
      await sql`UPDATE assistant_jobs SET workflow_id=${workflowId} WHERE turn_id=${turnId}::UUID AND segment=${segment} AND claimed_at IS NULL`;
    },
    async append(turnId, event) {
      // The database serializes replay publication with Stop and worker completion.
      const { seq: _seq, ...payload } = event;
      void _seq;
      if (payload.turn?.changeSet) payload.turn = { ...payload.turn, changeSet: { ...payload.turn.changeSet, confirmationToken: undefined } };
      if (payload.turn?.actions) payload.turn = { ...payload.turn, actions: payload.turn.actions.map((a) => ({ ...a, confirmationToken: undefined })) };
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
        LEFT JOIN trips p ON p.id=c.trip_id WHERE c.owner_email=${ownerEmail} AND t.created_at>NOW()-INTERVAL '24 hours'
        ORDER BY t.created_at DESC LIMIT 100`;
    },
  };
}
