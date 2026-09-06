import { migrationSql } from "./support.mjs";
// Freeze the launch catalog so future model changes do not alter historical migrations.
const models = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
const initialModel = (value) => models.includes(value) ? value : "gemini-3.6-flash";
export const down = false;
export async function up(pgm) {
  const sql = migrationSql(pgm);
  await sql`CREATE TABLE IF NOT EXISTS assistant_policy_defaults (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(id), owner_email TEXT NOT NULL,
    policy JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 0
  )`;
  await sql`INSERT INTO assistant_policy_defaults(id,owner_email,policy)
    VALUES(TRUE,current_setting('app.migration_owner'),${JSON.stringify({ enabled: true, daily: 50, weekly: 250, model: initialModel(process.env.GEMINI_MODEL?.trim()), effort: "default" })}::JSONB) ON CONFLICT(id) DO NOTHING`;
  await sql`CREATE TABLE IF NOT EXISTS assistant_policy_overrides (
    email TEXT PRIMARY KEY, policy JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 0
  )`;
  await sql`CREATE TABLE IF NOT EXISTS assistant_management_audit (
    id BIGSERIAL PRIMARY KEY, actor_email TEXT NOT NULL, target_email TEXT,
    action TEXT NOT NULL, before_value JSONB, after_value JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`ALTER TABLE assistant_turns ADD COLUMN IF NOT EXISTS execution_settings JSONB`;
  await sql`CREATE OR REPLACE FUNCTION assistant_effective_policy(actor TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE d RECORD; o JSONB; result JSONB; actor_role TEXT;
  BEGIN
    SELECT * INTO d FROM assistant_policy_defaults WHERE id=TRUE FOR SHARE;
    SELECT policy INTO o FROM assistant_policy_overrides WHERE email=actor;
    SELECT role INTO actor_role FROM users WHERE email=actor FOR SHARE;
    result := d.policy || jsonb_build_object('isOwner',actor=d.owner_email);
    IF actor=d.owner_email THEN
      RETURN result || jsonb_build_object('enabled',true,'daily',null,'weekly',null);
    END IF;
    result := result || jsonb_build_object('enabled',COALESCE(actor_role='admin',false) AND (d.policy->>'enabled')::BOOLEAN AND COALESCE((o->>'enabled')::BOOLEAN,true));
    IF o IS NOT NULL THEN
      IF o->>'daily' IS DISTINCT FROM 'inherit' THEN result := jsonb_set(result,'{daily}',o->'daily'); END IF;
      IF o->>'weekly' IS DISTINCT FROM 'inherit' THEN result := jsonb_set(result,'{weekly}',o->'weekly'); END IF;
      IF o->>'model' <> 'inherit' THEN result := result || jsonb_build_object('model',o->'model','effort',o->'effort'); END IF;
    END IF;
    RETURN result;
  END; $$`;
  // Every acceptance path (including old SQL signatures) inserts a turn.
  // The existing actor lock plus the shared defaults lock serialize usage and policy edits.
  await sql`CREATE OR REPLACE FUNCTION assistant_admit_turn() RETURNS TRIGGER LANGUAGE plpgsql AS $$
  DECLARE actor TEXT; p JSONB; daily_used INTEGER; weekly_used INTEGER; hourly_used INTEGER;
    day_start TIMESTAMPTZ := date_trunc('day',NOW() AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo';
    week_start TIMESTAMPTZ := date_trunc('week',NOW() AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo';
  BEGIN
    SELECT owner_email INTO actor FROM assistant_conversations WHERE id=NEW.conversation_id;
    PERFORM pg_advisory_xact_lock(hashtextextended('assistant:' || actor,0));
    p := assistant_effective_policy(actor);
    IF NOT (p->>'enabled')::BOOLEAN THEN RAISE EXCEPTION USING ERRCODE='PA001',MESSAGE='ASSISTANT_DISABLED'; END IF;
    SELECT COUNT(*) FILTER(WHERE t.created_at>=day_start), COUNT(*) FILTER(WHERE t.created_at>=week_start),
      COUNT(*) FILTER(WHERE t.created_at>=NOW()-INTERVAL '1 hour') INTO daily_used,weekly_used,hourly_used
      FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id
      WHERE c.owner_email=actor AND t.created_at>=LEAST(week_start,NOW()-INTERVAL '1 hour');
    IF daily_used >= (p->>'daily')::INTEGER OR weekly_used >= (p->>'weekly')::INTEGER OR hourly_used>=30 THEN
      RAISE EXCEPTION USING ERRCODE='PA002',MESSAGE='ASSISTANT_QUOTA';
    END IF;
    NEW.execution_settings := jsonb_build_object('model',p->'model','effort',p->'effort');
    RETURN NEW;
  END; $$`;
  await sql`DROP TRIGGER IF EXISTS assistant_admission ON assistant_turns`;
  await sql`CREATE TRIGGER assistant_admission BEFORE INSERT ON assistant_turns FOR EACH ROW EXECUTE FUNCTION assistant_admit_turn()`;
  // Guard writes at their commit point, not only at the HTTP permission check.
  await sql`CREATE OR REPLACE FUNCTION assistant_guard_mutation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
  DECLARE actor TEXT; p JSONB;
  BEGIN
    IF TG_TABLE_NAME='assistant_conversations' THEN
      IF NEW.pins IS NOT DISTINCT FROM OLD.pins AND NEW.pins_version=OLD.pins_version THEN RETURN NEW; END IF;
      actor := NEW.owner_email;
    ELSE
      IF NEW.status <> 'applying' OR OLD.status='applying' THEN RETURN NEW; END IF;
      SELECT c.owner_email INTO actor FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id WHERE t.id=NEW.turn_id;
    END IF;
    p := assistant_effective_policy(actor);
    IF NOT (p->>'enabled')::BOOLEAN THEN RAISE EXCEPTION USING ERRCODE='PA001',MESSAGE='ASSISTANT_DISABLED'; END IF;
    RETURN NEW;
  END; $$`;
  await sql`DROP TRIGGER IF EXISTS assistant_pin_policy ON assistant_conversations`;
  await sql`CREATE TRIGGER assistant_pin_policy BEFORE UPDATE OF pins,pins_version ON assistant_conversations FOR EACH ROW EXECUTE FUNCTION assistant_guard_mutation()`;
  await sql`DROP TRIGGER IF EXISTS assistant_proposal_policy ON assistant_change_sets`;
  await sql`CREATE TRIGGER assistant_proposal_policy BEFORE UPDATE OF status ON assistant_change_sets FOR EACH ROW EXECUTE FUNCTION assistant_guard_mutation()`;
}
