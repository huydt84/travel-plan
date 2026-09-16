import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);
  const [{ owner_email: ownerEmail }] = await sql`
    SELECT LOWER(NULLIF(TRIM(current_setting('app.migration_owner', true)), '')) AS owner_email
  `;
  if (!ownerEmail) throw new Error("AUTH_OWNER_EMAIL is required to establish trip leadership.");

  // A ledger-adoption rerun can inherit deferred participant events from earlier
  // migrations in the same transaction. Flush them before altering the table.
  await sql`SET CONSTRAINTS ALL IMMEDIATE`;

  await sql`
    INSERT INTO users (name, display_name, email, first_login, last_login, last_active_at)
    VALUES (${ownerEmail.split("@")[0]}, ${ownerEmail.split("@")[0]}, ${ownerEmail}, NOW(), NOW(), NOW())
    ON CONFLICT (email) DO NOTHING
  `;

  await sql`ALTER TABLE trip_participants ADD COLUMN IF NOT EXISTS role TEXT`;
  await sql`ALTER TABLE trip_participants ADD COLUMN IF NOT EXISTS added_by_email TEXT`;
  await sql`UPDATE trip_participants SET role='member' WHERE role IS NULL`;
  await sql`ALTER TABLE trip_participants ALTER COLUMN role SET DEFAULT 'member'`;
  await sql`ALTER TABLE trip_participants ALTER COLUMN role SET NOT NULL`;
  await sql`ALTER TABLE trip_participants DROP CONSTRAINT IF EXISTS trip_participants_role_check`;
  await sql`ALTER TABLE trip_participants ADD CONSTRAINT trip_participants_role_check CHECK(role IN ('leader','member'))`;

  await sql`
    INSERT INTO trip_participants (trip_id,user_email,role,added_by_email,joined_at,last_participated_at)
    SELECT id,${ownerEmail},'leader',${ownerEmail},created_at,updated_at FROM trips
    ON CONFLICT (trip_id,user_email) DO UPDATE SET role='leader',added_by_email=COALESCE(trip_participants.added_by_email,EXCLUDED.added_by_email)
  `;
  await sql`
    INSERT INTO trip_participants (trip_id,user_email,role,added_by_email,joined_at,last_participated_at)
    SELECT fulfillment.trip_id,request.requester_email,'member',fulfillment.attached_by,fulfillment.attached_at,fulfillment.attached_at
    FROM trip_request_fulfillments fulfillment
    JOIN trip_requests request ON request.id=fulfillment.request_id
    ON CONFLICT (trip_id,user_email) DO NOTHING
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS trip_participants_one_leader_idx ON trip_participants(trip_id) WHERE role='leader'`;
  await sql`CREATE INDEX IF NOT EXISTS trip_participants_trip_role_idx ON trip_participants(trip_id,role,joined_at)`;

  await sql`CREATE TABLE IF NOT EXISTS trip_audit_events (
    id BIGSERIAL PRIMARY KEY,
    trip_id BIGINT,
    trip_slug TEXT NOT NULL,
    trip_title TEXT NOT NULL,
    actor_email TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'web',
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    before_value JSONB,
    after_value JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS trip_audit_events_trip_created_idx ON trip_audit_events(trip_id,created_at DESC,id DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS trip_audit_events_slug_created_idx ON trip_audit_events(trip_slug,created_at DESC,id DESC)`;
  await sql`CREATE OR REPLACE FUNCTION protect_trip_audit_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Trip audit events are immutable'; END $$`;
  await sql`DROP TRIGGER IF EXISTS trip_audit_events_immutable_trigger ON trip_audit_events`;
  await sql`CREATE TRIGGER trip_audit_events_immutable_trigger BEFORE UPDATE OR DELETE ON trip_audit_events
    FOR EACH ROW EXECUTE FUNCTION protect_trip_audit_event()`;

  await sql`CREATE OR REPLACE FUNCTION execute_assistant_action_with_membership(p_action_id UUID, actor TEXT, approved_digest TEXT)
    RETURNS JSONB LANGUAGE plpgsql AS $$
    DECLARE v_receipt JSONB;
    BEGIN
      v_receipt := execute_assistant_action(p_action_id,actor,approved_digest);
      IF v_receipt ? 'error' THEN RETURN v_receipt; END IF;
      INSERT INTO trip_participants(trip_id,user_email,role,added_by_email,joined_at,last_participated_at)
        SELECT DISTINCT trip.id,LOWER(actor),'leader',LOWER(actor),NOW(),NOW()
        FROM jsonb_array_elements(v_receipt->'resources') resource JOIN trips trip ON trip.id=(resource->>'tripId')::BIGINT
        WHERE NOT EXISTS(SELECT 1 FROM trip_participants participant WHERE participant.trip_id=trip.id AND participant.role='leader')
        ON CONFLICT(trip_id,user_email) DO NOTHING;
      INSERT INTO trip_audit_events(trip_id,trip_slug,trip_title,actor_email,actor_name,actor_role,source,action,entity_type,after_value)
        SELECT DISTINCT trip.id,trip.slug,trip.title,LOWER(actor),COALESCE(user_row.display_name,user_row.name,actor),'admin',
          'assistant','assistant.batch_applied','assistant_batch',action.operations
        FROM assistant_actions action
        CROSS JOIN jsonb_array_elements(v_receipt->'resources') resource
        JOIN trips trip ON trip.id=(resource->>'tripId')::BIGINT
        LEFT JOIN users user_row ON user_row.email=LOWER(actor)
        WHERE action.id=p_action_id;
      RETURN v_receipt;
    END $$`;

  await sql`CREATE OR REPLACE FUNCTION assert_trip_has_one_leader() RETURNS TRIGGER LANGUAGE plpgsql AS $$
    DECLARE target_trip BIGINT;
    BEGIN
      IF TG_TABLE_NAME='trips' THEN target_trip := COALESCE(NEW.id,OLD.id);
      ELSE target_trip := COALESCE(NEW.trip_id,OLD.trip_id); END IF;
      IF EXISTS(SELECT 1 FROM trips WHERE id=target_trip) AND
        (SELECT COUNT(*) FROM trip_participants WHERE trip_id=target_trip AND role='leader')<>1
      THEN RAISE EXCEPTION 'Every trip must have exactly one leader' USING ERRCODE='23514'; END IF;
      RETURN NULL;
    END $$`;
  await sql`DROP TRIGGER IF EXISTS trip_participants_require_leader_trigger ON trip_participants`;
  await sql`CREATE CONSTRAINT TRIGGER trip_participants_require_leader_trigger AFTER INSERT OR UPDATE OR DELETE ON trip_participants
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_trip_has_one_leader()`;

  await sql`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_event_type_check`;
  await sql`ALTER TABLE notifications ADD CONSTRAINT notifications_event_type_check CHECK(event_type IN (
    'contribution_created','contribution_status_changed','contribution_visibility_changed','trip_request_fulfilled',
    'assistant_handoff_created','trip_member_added','trip_member_removed','trip_leader_received'
  ))`;
  await sql`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_context_check`;
  await sql`ALTER TABLE notifications ADD CONSTRAINT notifications_context_check CHECK (
    (event_type='assistant_handoff_created' AND handoff_id IS NOT NULL AND trip_id IS NULL AND trip_request_id IS NULL AND suggestion_id IS NULL)
    OR (event_type='trip_request_fulfilled' AND handoff_id IS NULL AND trip_id IS NOT NULL AND trip_request_id IS NOT NULL AND suggestion_id IS NULL)
    OR (event_type IN ('trip_member_added','trip_member_removed','trip_leader_received') AND handoff_id IS NULL AND trip_id IS NOT NULL AND trip_request_id IS NULL AND suggestion_id IS NULL)
    OR (event_type IN ('contribution_created','contribution_status_changed','contribution_visibility_changed') AND handoff_id IS NULL AND trip_id IS NOT NULL AND trip_request_id IS NULL AND suggestion_id IS NOT NULL)
  )`;

  const [invalid] = await sql`
    SELECT COUNT(*)::INTEGER AS count FROM trips trip
    WHERE (SELECT COUNT(*) FROM trip_participants participant WHERE participant.trip_id=trip.id AND participant.role='leader')<>1
  `;
  if (Number(invalid.count) !== 0) throw new Error("Every trip must have exactly one leader after migration.");
}
