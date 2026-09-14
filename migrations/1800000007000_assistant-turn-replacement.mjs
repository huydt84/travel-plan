import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);
  await sql`CREATE OR REPLACE FUNCTION replace_latest_assistant_turn(
    actor TEXT, target_turn UUID, request_id UUID, message TEXT, lease_ms INTEGER, hourly_limit INTEGER
  ) RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE original assistant_turns%ROWTYPE; prior RECORD; policy JSONB; used INTEGER; daily_used INTEGER; weekly_used INTEGER;
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('assistant:' || actor,0));
    SELECT t.*,r.requested_conversation_id INTO prior FROM assistant_requests r
      JOIN assistant_turns t ON t.id=r.turn_id
      WHERE r.owner_email=actor AND r.client_turn_id=request_id;
    IF FOUND THEN
      IF prior.id<>target_turn OR prior.input_text<>message THEN
        RETURN jsonb_build_object('error','IDEMPOTENCY_MISMATCH');
      END IF;
      RETURN jsonb_build_object('turnId',prior.id,'conversationId',prior.conversation_id,'replayed',TRUE);
    END IF;

    SELECT t.* INTO original FROM assistant_turns t
      JOIN assistant_conversations c ON c.id=t.conversation_id
      WHERE t.id=target_turn AND c.owner_email=actor FOR UPDATE OF t;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','TURN_NOT_FOUND'); END IF;
    IF original.status NOT IN ('completed','failed')
      OR EXISTS(SELECT 1 FROM assistant_turns WHERE retry_of_turn_id=original.id)
      OR EXISTS(SELECT 1 FROM assistant_turns WHERE conversation_id=original.conversation_id AND (created_at,id)>(original.created_at,original.id))
      OR EXISTS(SELECT 1 FROM assistant_handoffs WHERE conversation_id=original.conversation_id AND status='active') THEN
      RETURN jsonb_build_object('error','REPLACE_UNAVAILABLE');
    END IF;
    IF EXISTS(SELECT 1 FROM assistant_actions WHERE turn_id=original.id AND status='applied')
      OR EXISTS(SELECT 1 FROM assistant_change_sets WHERE turn_id=original.id AND status='applied') THEN
      RETURN jsonb_build_object('error','REPLACE_APPLIED');
    END IF;
    policy:=assistant_effective_policy(actor);
    IF NOT (policy->>'enabled')::BOOLEAN THEN RAISE EXCEPTION USING ERRCODE='PA001',MESSAGE='ASSISTANT_DISABLED'; END IF;
    SELECT COUNT(*) FILTER(WHERE t.created_at>=NOW()-INTERVAL '1 hour'),
      COUNT(*) FILTER(WHERE t.created_at>=date_trunc('day',NOW() AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo'),
      COUNT(*) FILTER(WHERE t.created_at>=date_trunc('week',NOW() AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo')
      INTO used,daily_used,weekly_used FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id
      WHERE c.owner_email=actor;
    IF used>=hourly_limit OR daily_used>=(policy->>'daily')::INTEGER OR weekly_used>=(policy->>'weekly')::INTEGER THEN
      RAISE EXCEPTION USING ERRCODE='PA002',MESSAGE='ASSISTANT_QUOTA';
    END IF;

    DELETE FROM assistant_events WHERE turn_id=original.id;
    DELETE FROM assistant_jobs WHERE turn_id=original.id;
    DELETE FROM assistant_questions WHERE turn_id=original.id;
    DELETE FROM assistant_actions WHERE turn_id=original.id;
    DELETE FROM assistant_change_sets WHERE turn_id=original.id;
    DELETE FROM assistant_tool_runs WHERE turn_id=original.id;
    UPDATE assistant_requests SET client_turn_id=request_id,requested_conversation_id=original.conversation_id
      WHERE turn_id=original.id;
    UPDATE assistant_turns SET client_turn_id=request_id,input_text=message,output_text=NULL,citations='[]'::JSONB,
      status='running',lease_expires_at=NOW()+lease_ms*INTERVAL '1 millisecond',provider_interaction_id=NULL,
      error_code=NULL,error_diagnostics=NULL,completed_at=NULL,resolved_context='[]'::JSONB,used_context='[]'::JSONB,
      continuation='[]'::JSONB,segment=0,created_at=NOW()
      WHERE id=original.id;
    INSERT INTO assistant_jobs(turn_id,segment) VALUES(original.id,0);
    INSERT INTO assistant_events(turn_id,seq,payload) VALUES(original.id,1,
      jsonb_build_object('type','accepted','runId',original.id,'conversationId',original.conversation_id,'status','queued'));
    UPDATE assistant_conversations SET updated_at=NOW() WHERE id=original.conversation_id;
    RETURN jsonb_build_object('turnId',original.id,'conversationId',original.conversation_id,'replayed',FALSE);
  END; $$`;
}
