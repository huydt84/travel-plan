import { migrationSql } from "./support.mjs";
export const down = false;
export async function up(pgm) {
  const sql = migrationSql(pgm);
  await sql`CREATE TABLE IF NOT EXISTS assistant_jobs (
    turn_id UUID PRIMARY KEY REFERENCES assistant_turns(id) ON DELETE CASCADE,
    workflow_id TEXT, claimed_at TIMESTAMPTZ, dispatch_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS assistant_events (
    turn_id UUID NOT NULL REFERENCES assistant_turns(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL, payload JSONB NOT NULL, PRIMARY KEY(turn_id,seq)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS assistant_jobs_dispatch_idx ON assistant_jobs(dispatch_after) WHERE claimed_at IS NULL`;
  // Wrap the existing actor-locked acceptance in the SAME transaction as its outbox.
  await sql`CREATE OR REPLACE FUNCTION accept_assistant_background_request(
    actor TEXT, slug TEXT, requested_conversation UUID, request_id UUID,
    message TEXT, conversation_title TEXT, new_conversation UUID, new_turn UUID,
    lease_ms INTEGER, hourly_limit INTEGER
  ) RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE result JSONB;
  BEGIN
    result := accept_assistant_request(actor,slug,requested_conversation,request_id,message,
      conversation_title,new_conversation,new_turn,lease_ms,hourly_limit);
    IF NOT (result ? 'error') AND NOT (result->>'replayed')::BOOLEAN THEN
      INSERT INTO assistant_jobs(turn_id) VALUES((result->>'turnId')::UUID);
      INSERT INTO assistant_events(turn_id,seq,payload) VALUES((result->>'turnId')::UUID,1,
        jsonb_build_object('type','accepted','runId',result->>'turnId','conversationId',result->>'conversationId','status','queued'));
    END IF;
    RETURN result;
  END; $$`;
}
