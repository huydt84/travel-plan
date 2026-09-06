import { migrationSql } from "./support.mjs";
export const down = false;
export async function up(pgm) {
  const sql = migrationSql(pgm);
  const columns = await sql`SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name IN ('assistant_conversations','assistant_turns')`;
  const hadPins = columns.some((c) => c.table_name === 'assistant_conversations' && c.column_name === 'pins');
  const hadCapture = columns.some((c) => c.table_name === 'assistant_turns' && c.column_name === 'pinned_context');
  await sql`ALTER TABLE assistant_conversations ALTER COLUMN trip_id DROP NOT NULL,
    DROP CONSTRAINT IF EXISTS assistant_conversations_trip_id_fkey,
    ADD CONSTRAINT assistant_conversations_trip_id_fkey FOREIGN KEY(trip_id) REFERENCES trips(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS pins JSONB NOT NULL DEFAULT '[]', ADD COLUMN IF NOT EXISTS pins_version INTEGER NOT NULL DEFAULT 0`;
  if (!hadPins) await sql`UPDATE assistant_conversations SET pins=jsonb_build_array(jsonb_build_object('kind','trip','id',trip_id::TEXT)) WHERE trip_id IS NOT NULL`;
  await sql`ALTER TABLE assistant_turns ADD COLUMN IF NOT EXISTS mentions JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS pinned_context JSONB NOT NULL DEFAULT '[]', ADD COLUMN IF NOT EXISTS resolved_context JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS used_context JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS context_version INTEGER NOT NULL DEFAULT 0`;
  if (!hadCapture) await sql`UPDATE assistant_turns t SET pinned_context=c.pins FROM assistant_conversations c WHERE c.id=t.conversation_id`;
  // Old application instances can still create trip-owned rows during rollout.
  await sql`CREATE OR REPLACE FUNCTION assistant_legacy_conversation_context() RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.trip_id IS NOT NULL AND NEW.pins='[]'::JSONB THEN
        NEW.pins := jsonb_build_array(jsonb_build_object('kind','trip','id',NEW.trip_id::TEXT));
      END IF;
      RETURN NEW;
    END; $$`;
  await sql`DROP TRIGGER IF EXISTS assistant_legacy_conversation_context ON assistant_conversations`;
  await sql`CREATE TRIGGER assistant_legacy_conversation_context BEFORE INSERT ON assistant_conversations
    FOR EACH ROW EXECUTE FUNCTION assistant_legacy_conversation_context()`;
  await sql`CREATE OR REPLACE FUNCTION assistant_legacy_turn_context() RETURNS TRIGGER LANGUAGE plpgsql AS $$
    DECLARE legacy_trip BIGINT; captured JSONB;
    BEGIN
      SELECT trip_id,pins INTO legacy_trip,captured FROM assistant_conversations WHERE id=NEW.conversation_id;
      IF NEW.context_version=0 AND legacy_trip IS NOT NULL AND NEW.pinned_context='[]'::JSONB THEN NEW.pinned_context := captured; END IF;
      RETURN NEW;
    END; $$`;
  await sql`DROP TRIGGER IF EXISTS assistant_legacy_turn_context ON assistant_turns`;
  await sql`CREATE TRIGGER assistant_legacy_turn_context BEFORE INSERT ON assistant_turns
    FOR EACH ROW EXECUTE FUNCTION assistant_legacy_turn_context()`;
  await sql`CREATE OR REPLACE FUNCTION accept_assistant_context_request(
    actor TEXT, requested_conversation UUID, request_id UUID, message TEXT, conversation_title TEXT,
    new_conversation UUID, new_turn UUID, lease_ms INTEGER, hourly_limit INTEGER,
    attached JSONB, initial_pins JSONB, retry_of UUID, background BOOLEAN
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
      IF prior.input_text <> message OR prior.mentions <> attached
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
      IF original.conversation_id IS DISTINCT FROM requested_conversation OR original.input_text <> message OR original.mentions <> attached THEN
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
    INSERT INTO assistant_turns(id,conversation_id,client_turn_id,input_text,status,lease_expires_at,mentions,pinned_context,retry_of_turn_id,exchange_id,context_version)
      VALUES(new_turn,conversation_key,request_id,message,'running',NOW()+lease_ms*INTERVAL '1 millisecond',attached,captured,retry_of,
        CASE WHEN retry_of IS NULL THEN NULL ELSE COALESCE(original.exchange_id,original.id) END,1);
    INSERT INTO assistant_requests(owner_email,client_turn_id,turn_id,requested_conversation_id) VALUES(actor,request_id,new_turn,requested_conversation);
    IF background THEN
      INSERT INTO assistant_jobs(turn_id) VALUES(new_turn);
      INSERT INTO assistant_events(turn_id,seq,payload) VALUES(new_turn,1,jsonb_build_object('type','accepted','runId',new_turn,'conversationId',conversation_key,'status','queued'));
    END IF;
    RETURN jsonb_build_object('turnId',new_turn,'conversationId',conversation_key,'replayed',false);
  END; $$`;
}
