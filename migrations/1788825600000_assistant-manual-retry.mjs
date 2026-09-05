import { migrationSql } from "./support.mjs";
export const down = false;
export async function up(pgm) {
  const sql = migrationSql(pgm);
  await sql`ALTER TABLE assistant_turns ADD COLUMN IF NOT EXISTS exchange_id UUID REFERENCES assistant_turns(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS retry_of_turn_id UUID REFERENCES assistant_turns(id) ON DELETE CASCADE`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS assistant_retry_successor_idx ON assistant_turns(retry_of_turn_id) WHERE retry_of_turn_id IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS assistant_exchange_idx ON assistant_turns(exchange_id)`;
  await sql`CREATE OR REPLACE FUNCTION accept_assistant_background_request(
    actor TEXT, slug TEXT, requested_conversation UUID, request_id UUID,
    message TEXT, conversation_title TEXT, new_conversation UUID, new_turn UUID,
    lease_ms INTEGER, hourly_limit INTEGER, retry_of UUID
  ) RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE result JSONB; prior RECORD; original RECORD;
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('assistant:' || actor, 0));
    SELECT t.* INTO prior FROM assistant_requests r JOIN assistant_turns t ON t.id=r.turn_id
      WHERE r.owner_email=actor AND r.client_turn_id=request_id;
    IF FOUND THEN
      IF prior.retry_of_turn_id IS DISTINCT FROM retry_of THEN
        RETURN jsonb_build_object('error','IDEMPOTENCY_MISMATCH');
      END IF;
    ELSIF retry_of IS NOT NULL THEN
      SELECT t.*, c.owner_email, p.slug INTO original FROM assistant_turns t
        JOIN assistant_conversations c ON c.id=t.conversation_id JOIN trips p ON p.id=c.trip_id
        WHERE t.id=retry_of AND c.owner_email=actor;
      IF NOT FOUND THEN RETURN jsonb_build_object('error','TURN_NOT_FOUND'); END IF;
      IF original.slug <> slug OR original.conversation_id IS DISTINCT FROM requested_conversation
        OR original.input_text <> message THEN RETURN jsonb_build_object('error','IDEMPOTENCY_MISMATCH'); END IF;
      IF original.status <> 'failed' THEN RETURN jsonb_build_object('error','RETRY_UNAVAILABLE'); END IF;
      IF EXISTS(SELECT 1 FROM assistant_turns WHERE retry_of_turn_id=retry_of)
        OR EXISTS(SELECT 1 FROM assistant_turns WHERE conversation_id=original.conversation_id
          AND (created_at,id) > (original.created_at,original.id)) THEN
        RETURN jsonb_build_object('error','RETRY_UNAVAILABLE');
      END IF;
    END IF;
    result := accept_assistant_background_request(actor,slug,requested_conversation,request_id,message,
      conversation_title,new_conversation,new_turn,lease_ms,hourly_limit);
    IF NOT (result ? 'error') AND NOT (result->>'replayed')::BOOLEAN AND retry_of IS NOT NULL THEN
      UPDATE assistant_turns SET retry_of_turn_id=retry_of,exchange_id=COALESCE(original.exchange_id,original.id)
        WHERE id=(result->>'turnId')::UUID;
    END IF;
    RETURN result;
  END; $$`;
  // Claim and dispatch failure lock the turn first, so late starts cannot revive it.
  await sql`CREATE OR REPLACE FUNCTION claim_assistant_job(run UUID, lease_ms INTEGER, workflow TEXT)
    RETURNS BOOLEAN LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM 1 FROM assistant_turns WHERE id=run AND status='running' AND lease_expires_at>NOW() FOR UPDATE;
      IF NOT FOUND THEN RETURN FALSE; END IF;
      UPDATE assistant_jobs SET claimed_at=NOW(),workflow_id=COALESCE(workflow,workflow_id)
        WHERE turn_id=run AND claimed_at IS NULL;
      IF NOT FOUND THEN RETURN FALSE; END IF;
      UPDATE assistant_turns SET lease_expires_at=NOW()+lease_ms*INTERVAL '1 millisecond' WHERE id=run;
      RETURN TRUE;
    END; $$`;
  await sql`CREATE OR REPLACE FUNCTION fail_assistant_dispatch(run UUID)
    RETURNS VOID LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM 1 FROM assistant_turns WHERE id=run FOR UPDATE;
      UPDATE assistant_turns SET status='failed',error_code='DISPATCH_FAILED',completed_at=NOW(),lease_expires_at=NULL
        WHERE id=run AND status='running' AND NOT EXISTS
          (SELECT 1 FROM assistant_jobs WHERE turn_id=run AND claimed_at IS NOT NULL);
    END; $$`;
}
