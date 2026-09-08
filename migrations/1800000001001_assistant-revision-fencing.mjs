import { migrationSql } from "./support.mjs";
export const down = false;
export async function up(pgm) {
  const sql = migrationSql(pgm);
  // Match the executor's lock order: turn, action, then trips in numeric order.
  // Compilation is read-only; this is the authoritative revision fence.
  await sql`CREATE OR REPLACE FUNCTION revise_assistant_action(
    original_id UUID, actor TEXT, expected_digest TEXT, replacement JSONB
  ) RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE a assistant_actions%ROWTYPE; t assistant_turns%ROWTYPE;
    target BIGINT; expected BIGINT; actual BIGINT; p JSONB; result assistant_actions%ROWTYPE;
  BEGIN
    SELECT at.* INTO t FROM assistant_turns at
      JOIN assistant_actions aa ON aa.turn_id=at.id
      JOIN assistant_conversations c ON c.id=at.conversation_id
      WHERE aa.id=original_id AND c.owner_email=actor FOR UPDATE OF at;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','ACTION_NOT_FOUND'); END IF;
    SELECT * INTO a FROM assistant_actions WHERE id=original_id FOR UPDATE;
    p := assistant_effective_policy(actor);
    IF NOT (p->>'enabled')::BOOLEAN THEN
      RAISE EXCEPTION USING ERRCODE='PA001',MESSAGE='ASSISTANT_DISABLED';
    END IF;
    IF a.status<>'pending' OR t.status<>'awaiting_approval' OR a.segment<>t.segment THEN
      RETURN jsonb_build_object('error','ACTION_RESOLVED');
    END IF;
    IF a.digest<>expected_digest THEN RETURN jsonb_build_object('error','EDIT_STALE'); END IF;
    IF a.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('error','ACTION_EXPIRED'); END IF;
    IF a.revisions IS DISTINCT FROM replacement->'revisions' THEN
      RETURN jsonb_build_object('error','PLAN_CONFLICT');
    END IF;
    FOR target,expected IN SELECT key::BIGINT,value::TEXT::BIGINT FROM jsonb_each(a.revisions) ORDER BY key::BIGINT LOOP
      SELECT plan_revision INTO actual FROM trips WHERE id=target FOR UPDATE;
      IF NOT FOUND OR actual<>expected THEN RETURN jsonb_build_object('error','PLAN_CONFLICT'); END IF;
    END LOOP;
    UPDATE assistant_actions SET status='superseded',decided_at=NOW() WHERE id=a.id;
    INSERT INTO assistant_actions(id,turn_id,segment,revision_number,supersedes_action_id,
      call_id,tool_name,arguments,operations,revisions,preview,citations,digest,expires_at)
    VALUES((replacement->>'id')::UUID,a.turn_id,a.segment,a.revision_number+1,a.id,
      a.call_id,a.tool_name,replacement->'arguments',replacement->'operations',a.revisions,
      replacement->'preview',a.citations,replacement->>'digest',(replacement->>'expiresAt')::TIMESTAMPTZ)
    RETURNING * INTO result;
    RETURN to_jsonb(result);
  END $$`;
}
