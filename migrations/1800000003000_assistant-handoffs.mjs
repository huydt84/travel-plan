import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);

  await sql`CREATE TABLE IF NOT EXISTS assistant_handoffs (
    id UUID PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
    initiated_by_email TEXT NOT NULL,
    initiated_by_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
    trigger_message_id UUID,
    owner_seen_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    closed_by_email TEXT
  )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS assistant_handoffs_one_active_idx
    ON assistant_handoffs(conversation_id) WHERE status='active'`;
  await sql`CREATE INDEX IF NOT EXISTS assistant_handoffs_active_activity_idx
    ON assistant_handoffs(started_at DESC,id DESC) WHERE status='active'`;

  await sql`CREATE TABLE IF NOT EXISTS assistant_handoff_messages (
    id UUID PRIMARY KEY,
    handoff_id UUID NOT NULL REFERENCES assistant_handoffs(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
    client_message_id UUID NOT NULL,
    author_email TEXT NOT NULL,
    author_name TEXT NOT NULL,
    author_role TEXT NOT NULL CHECK(author_role IN ('participant','owner')),
    body TEXT NOT NULL,
    context_refs JSONB NOT NULL DEFAULT '[]'::JSONB,
    ordinal BIGSERIAL NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(author_email,client_message_id)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS assistant_handoff_messages_conversation_idx
    ON assistant_handoff_messages(conversation_id,ordinal)`;
  await sql`CREATE INDEX IF NOT EXISTS assistant_handoff_messages_handoff_idx
    ON assistant_handoff_messages(handoff_id,ordinal)`;
  await sql`ALTER TABLE assistant_handoffs DROP CONSTRAINT IF EXISTS assistant_handoffs_trigger_message_id_fkey`;
  await sql`ALTER TABLE assistant_handoffs ADD CONSTRAINT assistant_handoffs_trigger_message_id_fkey
    FOREIGN KEY(trigger_message_id) REFERENCES assistant_handoff_messages(id) ON DELETE SET NULL`;

  await sql`CREATE TABLE IF NOT EXISTS assistant_handoff_requests (
    owner_email TEXT NOT NULL,
    client_turn_id UUID NOT NULL,
    requested_conversation_id UUID,
    message_id UUID NOT NULL UNIQUE REFERENCES assistant_handoff_messages(id) ON DELETE CASCADE,
    input_text TEXT NOT NULL,
    context_refs JSONB NOT NULL DEFAULT '[]'::JSONB,
    initial_pins JSONB NOT NULL DEFAULT '[]'::JSONB,
    PRIMARY KEY(owner_email,client_turn_id)
  )`;

  await sql`CREATE TABLE IF NOT EXISTS assistant_handoff_email_outbox (
    id BIGSERIAL PRIMARY KEY,
    handoff_id UUID NOT NULL UNIQUE REFERENCES assistant_handoffs(id) ON DELETE CASCADE,
    recipient_email TEXT NOT NULL,
    sender_email TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    conversation_id UUID NOT NULL,
    conversation_title TEXT NOT NULL,
    message_body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_expires_at TIMESTAMPTZ,
    resend_message_id TEXT,
    last_error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ
  )`;
  await sql`CREATE INDEX IF NOT EXISTS assistant_handoff_email_outbox_pending_idx
    ON assistant_handoff_email_outbox(next_attempt_at,id) WHERE status IN ('pending','sending')`;

  await sql`CREATE OR REPLACE FUNCTION accept_assistant_handoff_or_request(
    actor TEXT, actor_name TEXT, actor_is_owner BOOLEAN, requested_conversation UUID,
    request_id UUID, message TEXT, conversation_title TEXT, new_conversation UUID,
    new_handoff UUID, new_message UUID, new_turn UUID, lease_ms INTEGER,
    hourly_limit INTEGER, attached JSONB, initial_pins JSONB, retry_of UUID,
    background BOOLEAN, trigger_match BOOLEAN, notification_recipient TEXT
  ) RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE prior RECORD; conversation_key UUID; active_handoff UUID; result JSONB; created_handoff BOOLEAN:=FALSE;
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('assistant:' || actor,0));

    SELECT r.*,m.handoff_id,m.conversation_id INTO prior
      FROM assistant_handoff_requests r
      JOIN assistant_handoff_messages m ON m.id=r.message_id
      WHERE r.owner_email=actor AND r.client_turn_id=request_id;
    IF FOUND THEN
      IF prior.input_text<>message OR prior.context_refs<>attached OR prior.initial_pins<>initial_pins
        OR requested_conversation IS DISTINCT FROM prior.requested_conversation_id THEN
        RETURN jsonb_build_object('error','IDEMPOTENCY_MISMATCH');
      END IF;
      RETURN jsonb_build_object('mode','handoff','messageId',prior.message_id,
        'handoffId',prior.handoff_id,'conversationId',prior.conversation_id,'replayed',true);
    END IF;

    IF requested_conversation IS NOT NULL THEN
      SELECT c.id INTO conversation_key FROM assistant_conversations c
        WHERE c.id=requested_conversation AND c.owner_email=actor FOR UPDATE;
      IF NOT FOUND THEN RETURN jsonb_build_object('error','CONVERSATION_NOT_FOUND'); END IF;
      SELECT h.id INTO active_handoff FROM assistant_handoffs h
        WHERE h.conversation_id=conversation_key AND h.status='active' FOR UPDATE;
    END IF;

    IF NOT actor_is_owner AND (active_handoff IS NOT NULL OR (retry_of IS NULL AND trigger_match)) THEN
      IF EXISTS(SELECT 1 FROM assistant_turns WHERE conversation_id=conversation_key
        AND status IN ('running','awaiting_approval','awaiting_input')) THEN
        RETURN jsonb_build_object('error','TURN_IN_PROGRESS');
      END IF;
      IF conversation_key IS NULL THEN
        conversation_key:=new_conversation;
        INSERT INTO assistant_conversations(id,owner_email,title,pins)
          VALUES(conversation_key,actor,conversation_title,initial_pins);
      END IF;
      IF active_handoff IS NULL THEN
        active_handoff:=new_handoff;
        created_handoff:=TRUE;
        INSERT INTO assistant_handoffs(id,conversation_id,initiated_by_email,initiated_by_name)
          VALUES(active_handoff,conversation_key,actor,actor_name);
      END IF;
      INSERT INTO assistant_handoff_messages(id,handoff_id,conversation_id,client_message_id,
        author_email,author_name,author_role,body,context_refs)
        VALUES(new_message,active_handoff,conversation_key,request_id,actor,actor_name,
          'participant',message,attached);
      INSERT INTO assistant_handoff_requests(owner_email,client_turn_id,requested_conversation_id,
        message_id,input_text,context_refs,initial_pins)
        VALUES(actor,request_id,requested_conversation,new_message,message,attached,initial_pins);
      UPDATE assistant_conversations SET updated_at=NOW() WHERE id=conversation_key;
      IF created_handoff THEN
        UPDATE assistant_handoffs SET trigger_message_id=new_message WHERE id=active_handoff;
        INSERT INTO assistant_handoff_email_outbox(handoff_id,recipient_email,sender_email,
          sender_name,conversation_id,conversation_title,message_body)
          VALUES(active_handoff,notification_recipient,actor,actor_name,conversation_key,
            conversation_title,message);
      END IF;
      RETURN jsonb_build_object('mode','handoff','messageId',new_message,
        'handoffId',active_handoff,'conversationId',conversation_key,'replayed',FALSE);
    END IF;

    result:=accept_assistant_context_request(actor,requested_conversation,request_id,message,
      conversation_title,new_conversation,new_turn,lease_ms,hourly_limit,attached,
      initial_pins,retry_of,background);
    RETURN result || jsonb_build_object('mode','assistant');
  END; $$`;

  await sql`CREATE OR REPLACE FUNCTION reply_assistant_handoff(
    actor TEXT, actor_name TEXT, target_handoff UUID, request_id UUID,
    new_message UUID, message TEXT
  ) RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE h RECORD; prior RECORD; participant_email TEXT;
  BEGIN
    SELECT source.*,c.owner_email AS participant_email INTO h FROM assistant_handoffs source
      JOIN assistant_conversations c ON c.id=source.conversation_id WHERE source.id=target_handoff;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','HANDOFF_NOT_FOUND'); END IF;
    IF actor IS DISTINCT FROM (SELECT owner_email FROM assistant_policy_defaults WHERE id=TRUE) THEN
      RETURN jsonb_build_object('error','OWNER_REQUIRED'); END IF;
    participant_email:=h.participant_email;
    PERFORM pg_advisory_xact_lock(hashtextextended('assistant:' || participant_email,0));
    SELECT * INTO prior FROM assistant_handoff_messages WHERE author_email=actor AND client_message_id=request_id;
    IF FOUND THEN
      IF prior.handoff_id<>target_handoff OR prior.body<>message THEN RETURN jsonb_build_object('error','IDEMPOTENCY_MISMATCH'); END IF;
      RETURN jsonb_build_object('messageId',prior.id,'replayed',TRUE);
    END IF;
    SELECT source.*,c.owner_email AS participant_email INTO h FROM assistant_handoffs source
      JOIN assistant_conversations c ON c.id=source.conversation_id WHERE source.id=target_handoff FOR UPDATE OF source;
    IF h.status<>'active' THEN RETURN jsonb_build_object('error','HANDOFF_CLOSED'); END IF;
    INSERT INTO assistant_handoff_messages(id,handoff_id,conversation_id,client_message_id,
      author_email,author_name,author_role,body)
      VALUES(new_message,target_handoff,h.conversation_id,request_id,actor,actor_name,'owner',message);
    UPDATE assistant_conversations SET updated_at=NOW() WHERE id=h.conversation_id;
    INSERT INTO assistant_management_audit(actor_email,target_email,action,after_value)
      VALUES(actor,participant_email,'handoff_reply',jsonb_build_object('handoffId',target_handoff,'messageId',new_message));
    RETURN jsonb_build_object('messageId',new_message,'replayed',FALSE);
  END; $$`;

  await sql`CREATE OR REPLACE FUNCTION close_assistant_handoff(actor TEXT,target_handoff UUID)
    RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE h RECORD; participant_email TEXT;
  BEGIN
    SELECT source.*,c.owner_email AS participant_email INTO h FROM assistant_handoffs source
      JOIN assistant_conversations c ON c.id=source.conversation_id WHERE source.id=target_handoff;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','HANDOFF_NOT_FOUND'); END IF;
    IF actor IS DISTINCT FROM (SELECT owner_email FROM assistant_policy_defaults WHERE id=TRUE) THEN
      RETURN jsonb_build_object('error','OWNER_REQUIRED'); END IF;
    participant_email:=h.participant_email;
    PERFORM pg_advisory_xact_lock(hashtextextended('assistant:' || participant_email,0));
    UPDATE assistant_handoffs SET status='closed',closed_at=NOW(),closed_by_email=actor
      WHERE id=target_handoff AND status='active' RETURNING * INTO h;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','HANDOFF_CLOSED'); END IF;
    UPDATE assistant_conversations SET updated_at=NOW() WHERE id=h.conversation_id;
    INSERT INTO assistant_management_audit(actor_email,target_email,action,after_value)
      VALUES(actor,h.initiated_by_email,'handoff_close',jsonb_build_object('handoffId',target_handoff));
    RETURN jsonb_build_object('closed',TRUE,'closedAt',h.closed_at);
  END; $$`;
}
