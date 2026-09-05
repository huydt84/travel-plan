import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);
  // Agentic v1 is additive: existing plan writers keep their interfaces while
  // database triggers make every canonical plan change visible to proposals.
  await sql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS plan_revision BIGINT NOT NULL DEFAULT 0`;

  await sql`CREATE OR REPLACE FUNCTION bump_trip_plan_revision()
  RETURNS TRIGGER AS $$
  DECLARE
    affected_trip_id BIGINT;
  BEGIN
    IF TG_TABLE_NAME = 'trips' THEN
      affected_trip_id := COALESCE(NEW.id, OLD.id);
    ELSE
      affected_trip_id := COALESCE(NEW.trip_id, OLD.trip_id);
    END IF;

    IF affected_trip_id IS NOT NULL THEN
      UPDATE trips
      SET plan_revision = plan_revision + 1
      WHERE id = affected_trip_id;
    END IF;
    RETURN COALESCE(NEW, OLD);
  END;
  $$ LANGUAGE plpgsql`;

  await sql`CREATE OR REPLACE FUNCTION bump_activity_source_plan_revision()
  RETURNS TRIGGER AS $$
  DECLARE
    affected_activity_id BIGINT;
  BEGIN
    affected_activity_id := COALESCE(NEW.activity_id, OLD.activity_id);
    UPDATE trips trip
    SET plan_revision = trip.plan_revision + 1
    FROM activities activity
    WHERE activity.id = affected_activity_id AND trip.id = activity.trip_id;
    RETURN COALESCE(NEW, OLD);
  END;
  $$ LANGUAGE plpgsql`;

  // The SQL adapters intentionally expose tagged templates only. Keep trigger
  // creation explicit so production Neon and local PostgreSQL behave identically.
  await sql`DROP TRIGGER IF EXISTS trips_plan_revision_trigger ON trips`;
  await sql`CREATE TRIGGER trips_plan_revision_trigger
    AFTER INSERT OR DELETE OR UPDATE OF slug, title, trip_date, end_date, timezone, location ON trips
    FOR EACH ROW EXECUTE FUNCTION bump_trip_plan_revision()`;
  await sql`DROP TRIGGER IF EXISTS sources_plan_revision_trigger ON sources`;
  await sql`CREATE TRIGGER sources_plan_revision_trigger
    AFTER INSERT OR DELETE OR UPDATE OF source_number, title, host, url, trip_id ON sources
    FOR EACH ROW EXECUTE FUNCTION bump_trip_plan_revision()`;
  await sql`DROP TRIGGER IF EXISTS activities_plan_revision_trigger ON activities`;
  await sql`CREATE TRIGGER activities_plan_revision_trigger
    AFTER INSERT OR DELETE OR UPDATE OF item_key, branch_id, sort_order, start_date, start_time, end_date, end_time, display_end, type, icon, title, detail, trip_id ON activities
    FOR EACH ROW EXECUTE FUNCTION bump_trip_plan_revision()`;
  await sql`DROP TRIGGER IF EXISTS schedule_branch_groups_plan_revision_trigger ON schedule_branch_groups`;
  await sql`CREATE TRIGGER schedule_branch_groups_plan_revision_trigger
    AFTER INSERT OR DELETE OR UPDATE OF item_key, anchor_activity_id, title, trip_id ON schedule_branch_groups
    FOR EACH ROW EXECUTE FUNCTION bump_trip_plan_revision()`;
  await sql`DROP TRIGGER IF EXISTS schedule_branches_plan_revision_trigger ON schedule_branches`;
  await sql`CREATE TRIGGER schedule_branches_plan_revision_trigger
    AFTER INSERT OR DELETE OR UPDATE OF group_id, item_key, label, condition_text, sort_order, is_default, trip_id ON schedule_branches
    FOR EACH ROW EXECUTE FUNCTION bump_trip_plan_revision()`;
  await sql`DROP TRIGGER IF EXISTS schedule_branch_selections_plan_revision_trigger ON schedule_branch_selections`;
  await sql`CREATE TRIGGER schedule_branch_selections_plan_revision_trigger
    AFTER INSERT OR DELETE OR UPDATE OF branch_id, selected_at, selected_by_email, trip_id ON schedule_branch_selections
    FOR EACH ROW EXECUTE FUNCTION bump_trip_plan_revision()`;
  await sql`DROP TRIGGER IF EXISTS activity_sources_plan_revision_trigger ON activity_sources`;
  await sql`CREATE TRIGGER activity_sources_plan_revision_trigger
    AFTER INSERT OR UPDATE OR DELETE ON activity_sources
    FOR EACH ROW EXECUTE FUNCTION bump_activity_source_plan_revision()`;

  await sql`CREATE TABLE IF NOT EXISTS assistant_conversations (
    id UUID PRIMARY KEY,
    owner_email TEXT NOT NULL,
    trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS assistant_conversations_owner_updated_idx
    ON assistant_conversations (owner_email, updated_at DESC, id DESC)`;

  await sql`CREATE TABLE IF NOT EXISTS assistant_turns (
    id UUID PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
    client_turn_id UUID NOT NULL,
    input_text TEXT NOT NULL,
    output_text TEXT,
    citations JSONB NOT NULL DEFAULT '[]'::JSONB,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    lease_expires_at TIMESTAMPTZ,
    provider_interaction_id TEXT,
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE (conversation_id, client_turn_id)
  )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS assistant_turns_one_running_idx
    ON assistant_turns (conversation_id) WHERE status = 'running'`;
  await sql`CREATE INDEX IF NOT EXISTS assistant_turns_conversation_created_idx
    ON assistant_turns (conversation_id, created_at, id)`;

  await sql`CREATE TABLE IF NOT EXISTS assistant_tool_runs (
    id UUID PRIMARY KEY,
    turn_id UUID NOT NULL REFERENCES assistant_turns(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    tool_version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    request_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    result_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    error_code TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS assistant_tool_runs_turn_idx
    ON assistant_tool_runs (turn_id, created_at, id)`;

  await sql`CREATE TABLE IF NOT EXISTS assistant_change_sets (
    id UUID PRIMARY KEY,
    turn_id UUID NOT NULL UNIQUE REFERENCES assistant_turns(id) ON DELETE CASCADE,
    trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    operations JSONB NOT NULL,
    preview JSONB NOT NULL,
    citations JSONB NOT NULL DEFAULT '[]'::JSONB,
    base_revision BIGINT NOT NULL,
    digest TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('staged', 'applying', 'applied', 'conflicted', 'expired', 'superseded')),
    commit_id UUID,
    receipt JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_at TIMESTAMPTZ
  )`;
  await sql`CREATE INDEX IF NOT EXISTS assistant_change_sets_trip_status_idx
    ON assistant_change_sets (trip_id, status, created_at DESC)`;

}
