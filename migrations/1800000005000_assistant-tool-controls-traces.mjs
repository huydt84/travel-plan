import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);

  await sql`ALTER TABLE assistant_turns ADD COLUMN IF NOT EXISTS allowed_tools JSONB NOT NULL DEFAULT '["ask_question","search_context","read_context","search_web","search_places","get_place_details","compute_route","apply_changes"]'::JSONB`;
  await sql`ALTER TABLE assistant_handoff_requests ADD COLUMN IF NOT EXISTS allowed_tools JSONB NOT NULL DEFAULT '["ask_question","search_context","read_context","search_web","search_places","get_place_details","compute_route","apply_changes"]'::JSONB`;
  await sql`ALTER TABLE assistant_tool_runs ADD COLUMN IF NOT EXISTS ordinal BIGSERIAL`;
  await sql`CREATE INDEX IF NOT EXISTS assistant_tool_runs_turn_ordinal_idx ON assistant_tool_runs(turn_id,ordinal)`;

  await sql`CREATE OR REPLACE FUNCTION accept_assistant_context_request_with_tools(
    actor TEXT, requested_conversation UUID, request_id UUID, message TEXT, conversation_title TEXT,
    new_conversation UUID, new_turn UUID, lease_ms INTEGER, hourly_limit INTEGER,
    attached JSONB, initial_pins JSONB, retry_of UUID, background BOOLEAN, allowed JSONB
  ) RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE prior RECORD; original assistant_turns%ROWTYPE; conversation_key UUID; captured JSONB; used INTEGER;
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('assistant:' || actor,0));
    UPDATE assistant_turns t SET status='failed',error_code='TURN_INTERRUPTED',completed_at=NOW(),lease_expires_at=NULL
      FROM assistant_conversations c WHERE c.id=t.conversation_id AND c.owner_email=actor AND t.status='running' AND t.lease_expires_at<=NOW();
    UPDATE assistant_tool_runs r SET status='failed',error_code='TURN_INTERRUPTED' FROM assistant_turns t
      JOIN assistant_conversations c ON c.id=t.conversation_id WHERE r.turn_id=t.id AND c.owner_email=actor AND t.status='failed' AND r.status='running';
    SELECT t.*,r.requested_conversation_id INTO prior FROM assistant_requests r
      JOIN assistant_turns t ON t.id=r.turn_id WHERE r.owner_email=actor AND r.client_turn_id=request_id;
    IF FOUND THEN
      IF prior.input_text <> message OR prior.mentions <> attached OR prior.allowed_tools <> allowed
        OR (prior.context_version>0 AND prior.requested_conversation_id IS NULL AND retry_of IS NULL AND prior.pinned_context <> initial_pins) OR prior.retry_of_turn_id IS DISTINCT FROM retry_of
        OR (requested_conversation IS DISTINCT FROM prior.requested_conversation_id AND requested_conversation IS DISTINCT FROM prior.conversation_id) THEN
        RETURN jsonb_build_object('error','IDEMPOTENCY_MISMATCH');
      END IF;
      RETURN jsonb_build_object('turnId',prior.id,'conversationId',prior.conversation_id,'replayed',true);
    END IF;
    IF requested_conversation IS NOT NULL THEN
      SELECT id,pins INTO conversation_key,captured FROM assistant_conversations
        WHERE id=requested_conversation AND owner_email=actor FOR UPDATE;
      IF NOT FOUND THEN RETURN jsonb_build_object('error','CONVERSATION_NOT_FOUND'); END IF;
    ELSE
      conversation_key := new_conversation; captured := initial_pins;
    END IF;
    IF retry_of IS NOT NULL THEN
      SELECT t.* INTO original FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id
        WHERE t.id=retry_of AND c.owner_email=actor;
      IF NOT FOUND THEN RETURN jsonb_build_object('error','TURN_NOT_FOUND'); END IF;
      IF original.conversation_id IS DISTINCT FROM requested_conversation OR original.input_text <> message OR original.mentions <> attached OR original.allowed_tools <> allowed THEN
        RETURN jsonb_build_object('error','IDEMPOTENCY_MISMATCH'); END IF;
      IF original.status <> 'failed' OR EXISTS(SELECT 1 FROM assistant_turns WHERE retry_of_turn_id=retry_of)
        OR EXISTS(SELECT 1 FROM assistant_turns WHERE conversation_id=original.conversation_id AND (created_at,id)>(original.created_at,original.id)) THEN
        RETURN jsonb_build_object('error','RETRY_UNAVAILABLE'); END IF;
      captured := original.pinned_context;
    END IF;
    SELECT COUNT(*) INTO used FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id
      WHERE c.owner_email=actor AND t.created_at>=NOW()-INTERVAL '1 hour';
    IF used>=hourly_limit THEN RETURN jsonb_build_object('error','TURN_RATE_LIMIT'); END IF;
    IF EXISTS(SELECT 1 FROM assistant_turns WHERE conversation_id=conversation_key AND status='running') THEN
      RETURN jsonb_build_object('error','TURN_IN_PROGRESS'); END IF;
    IF requested_conversation IS NULL THEN
      INSERT INTO assistant_conversations(id,owner_email,title,pins) VALUES(conversation_key,actor,conversation_title,captured);
    END IF;
    INSERT INTO assistant_turns(id,conversation_id,client_turn_id,input_text,status,lease_expires_at,mentions,pinned_context,retry_of_turn_id,exchange_id,context_version,allowed_tools)
      VALUES(new_turn,conversation_key,request_id,message,'running',NOW()+lease_ms*INTERVAL '1 millisecond',attached,captured,retry_of,
        CASE WHEN retry_of IS NULL THEN NULL ELSE COALESCE(original.exchange_id,original.id) END,1,allowed);
    INSERT INTO assistant_requests(owner_email,client_turn_id,turn_id,requested_conversation_id) VALUES(actor,request_id,new_turn,requested_conversation);
    IF background THEN
      INSERT INTO assistant_jobs(turn_id) VALUES(new_turn);
      INSERT INTO assistant_events(turn_id,seq,payload) VALUES(new_turn,1,jsonb_build_object('type','accepted','runId',new_turn,'conversationId',conversation_key,'status','queued'));
    END IF;
    RETURN jsonb_build_object('turnId',new_turn,'conversationId',conversation_key,'replayed',false);
  END; $$`;

  await sql`CREATE OR REPLACE FUNCTION accept_assistant_handoff_or_request_with_tools(
    actor TEXT, actor_name TEXT, actor_is_owner BOOLEAN, requested_conversation UUID,
    request_id UUID, message TEXT, conversation_title TEXT, new_conversation UUID,
    new_handoff UUID, new_message UUID, new_turn UUID, lease_ms INTEGER,
    hourly_limit INTEGER, attached JSONB, initial_pins JSONB, retry_of UUID,
    background BOOLEAN, trigger_match BOOLEAN, notification_recipient TEXT, allowed JSONB
  ) RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE prior RECORD; conversation_key UUID; active_handoff UUID; result JSONB; created_handoff BOOLEAN:=FALSE;
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('assistant:' || actor,0));
    SELECT r.*,m.handoff_id,m.conversation_id INTO prior
      FROM assistant_handoff_requests r JOIN assistant_handoff_messages m ON m.id=r.message_id
      WHERE r.owner_email=actor AND r.client_turn_id=request_id;
    IF FOUND THEN
      IF prior.input_text<>message OR prior.context_refs<>attached OR prior.initial_pins<>initial_pins OR prior.allowed_tools<>allowed
        OR requested_conversation IS DISTINCT FROM prior.requested_conversation_id THEN RETURN jsonb_build_object('error','IDEMPOTENCY_MISMATCH'); END IF;
      RETURN jsonb_build_object('mode','handoff','messageId',prior.message_id,'handoffId',prior.handoff_id,'conversationId',prior.conversation_id,'replayed',true);
    END IF;
    IF requested_conversation IS NOT NULL THEN
      SELECT c.id INTO conversation_key FROM assistant_conversations c WHERE c.id=requested_conversation AND c.owner_email=actor FOR UPDATE;
      IF NOT FOUND THEN RETURN jsonb_build_object('error','CONVERSATION_NOT_FOUND'); END IF;
      SELECT h.id INTO active_handoff FROM assistant_handoffs h WHERE h.conversation_id=conversation_key AND h.status='active' FOR UPDATE;
    END IF;
    IF NOT actor_is_owner AND (active_handoff IS NOT NULL OR (retry_of IS NULL AND trigger_match)) THEN
      IF EXISTS(SELECT 1 FROM assistant_turns WHERE conversation_id=conversation_key AND status IN ('running','awaiting_approval','awaiting_input')) THEN RETURN jsonb_build_object('error','TURN_IN_PROGRESS'); END IF;
      IF conversation_key IS NULL THEN conversation_key:=new_conversation; INSERT INTO assistant_conversations(id,owner_email,title,pins) VALUES(conversation_key,actor,conversation_title,initial_pins); END IF;
      IF active_handoff IS NULL THEN active_handoff:=new_handoff; created_handoff:=TRUE; INSERT INTO assistant_handoffs(id,conversation_id,initiated_by_email,initiated_by_name) VALUES(active_handoff,conversation_key,actor,actor_name); END IF;
      INSERT INTO assistant_handoff_messages(id,handoff_id,conversation_id,client_message_id,author_email,author_name,author_role,body,context_refs)
        VALUES(new_message,active_handoff,conversation_key,request_id,actor,actor_name,'participant',message,attached);
      INSERT INTO assistant_handoff_requests(owner_email,client_turn_id,requested_conversation_id,message_id,input_text,context_refs,initial_pins,allowed_tools)
        VALUES(actor,request_id,requested_conversation,new_message,message,attached,initial_pins,allowed);
      UPDATE assistant_conversations SET updated_at=NOW() WHERE id=conversation_key;
      IF created_handoff THEN
        UPDATE assistant_handoffs SET trigger_message_id=new_message WHERE id=active_handoff;
        INSERT INTO assistant_handoff_email_outbox(handoff_id,recipient_email,sender_email,sender_name,conversation_id,conversation_title,message_body)
          VALUES(active_handoff,notification_recipient,actor,actor_name,conversation_key,conversation_title,message);
      END IF;
      RETURN jsonb_build_object('mode','handoff','messageId',new_message,'handoffId',active_handoff,'conversationId',conversation_key,'replayed',FALSE);
    END IF;
    result:=accept_assistant_context_request_with_tools(actor,requested_conversation,request_id,message,conversation_title,new_conversation,new_turn,lease_ms,hourly_limit,attached,initial_pins,retry_of,background,allowed);
    RETURN result || jsonb_build_object('mode','assistant');
  END; $$`;
}
