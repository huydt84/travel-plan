import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);
  await sql`CREATE TABLE IF NOT EXISTS assistant_requests (
    owner_email TEXT NOT NULL,
    client_turn_id UUID NOT NULL,
    turn_id UUID NOT NULL UNIQUE REFERENCES assistant_turns(id) ON DELETE CASCADE,
    requested_conversation_id UUID,
    PRIMARY KEY (owner_email, client_turn_id)
  )`;
  // A volatile database function keeps acceptance atomic on both Neon HTTP and
  // local PostgreSQL. The actor lock serializes quota and idempotency checks.
  await sql`CREATE OR REPLACE FUNCTION accept_assistant_request(
    actor TEXT, slug TEXT, requested_conversation UUID, request_id UUID,
    message TEXT, conversation_title TEXT, new_conversation UUID, new_turn UUID,
    lease_ms INTEGER, hourly_limit INTEGER
  ) RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE
    trip_key BIGINT;
    conversation_key UUID;
    prior RECORD;
    used INTEGER;
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('assistant:' || actor, 0));
    UPDATE assistant_turns t SET status='failed', error_code='TURN_INTERRUPTED',
      completed_at=NOW(), lease_expires_at=NULL
      FROM assistant_conversations c WHERE t.conversation_id=c.id
      AND c.owner_email=actor AND t.status='running' AND t.lease_expires_at <= NOW();
    UPDATE assistant_tool_runs r SET status='failed', error_code='TURN_INTERRUPTED'
      FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id
      WHERE r.turn_id=t.id AND c.owner_email=actor AND t.status='failed' AND r.status='running';
    SELECT t.*, c.trip_id, c.owner_email, p.slug AS trip_slug,
      r.requested_conversation_id INTO prior
      FROM assistant_requests r JOIN assistant_turns t ON t.id=r.turn_id
      JOIN assistant_conversations c ON c.id=t.conversation_id JOIN trips p ON p.id=c.trip_id
      WHERE r.owner_email=actor AND r.client_turn_id=request_id;
    IF FOUND THEN
      IF prior.input_text <> message OR prior.trip_slug <> slug
        OR (requested_conversation IS DISTINCT FROM prior.requested_conversation_id
          AND requested_conversation IS DISTINCT FROM prior.conversation_id) THEN
        RETURN jsonb_build_object('error','IDEMPOTENCY_MISMATCH');
      END IF;
      RETURN jsonb_build_object('turnId',prior.id,'conversationId',prior.conversation_id,'replayed',true);
    END IF;
    SELECT id INTO trip_key FROM trips WHERE trips.slug=accept_assistant_request.slug;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','TRIP_NOT_FOUND'); END IF;
    IF requested_conversation IS NOT NULL THEN
      SELECT id INTO conversation_key FROM assistant_conversations
        WHERE id=requested_conversation AND owner_email=actor;
      IF NOT FOUND THEN RETURN jsonb_build_object('error','CONVERSATION_NOT_FOUND'); END IF;
      IF NOT EXISTS(SELECT 1 FROM assistant_conversations WHERE id=conversation_key AND trip_id=trip_key) THEN
        RETURN jsonb_build_object('error','CONVERSATION_TRIP_MISMATCH');
      END IF;
      -- Compatibility for turns created before the ledger existed.
      SELECT * INTO prior FROM assistant_turns
        WHERE conversation_id=conversation_key AND client_turn_id=request_id;
      IF FOUND THEN
        IF prior.input_text <> message THEN RETURN jsonb_build_object('error','IDEMPOTENCY_MISMATCH'); END IF;
        RETURN jsonb_build_object('turnId',prior.id,'conversationId',conversation_key,'replayed',true);
      END IF;
    ELSE
      conversation_key := new_conversation;
    END IF;
    SELECT COUNT(*) INTO used FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id
      WHERE c.owner_email=actor AND t.created_at >= NOW()-INTERVAL '1 hour';
    IF used >= hourly_limit THEN RETURN jsonb_build_object('error','TURN_RATE_LIMIT'); END IF;
    IF EXISTS(SELECT 1 FROM assistant_turns WHERE conversation_id=conversation_key AND status='running') THEN
      RETURN jsonb_build_object('error','TURN_IN_PROGRESS');
    END IF;
    IF requested_conversation IS NULL THEN
      INSERT INTO assistant_conversations(id,owner_email,trip_id,title)
        VALUES(conversation_key,actor,trip_key,conversation_title);
    END IF;
    INSERT INTO assistant_turns(id,conversation_id,client_turn_id,input_text,status,lease_expires_at)
      VALUES(new_turn,conversation_key,request_id,message,'running',NOW()+lease_ms*INTERVAL '1 millisecond');
    INSERT INTO assistant_requests(owner_email,client_turn_id,turn_id,requested_conversation_id)
      VALUES(actor,request_id,new_turn,requested_conversation);
    RETURN jsonb_build_object('turnId',new_turn,'conversationId',conversation_key,'replayed',false);
  END;
  $$`;
}
