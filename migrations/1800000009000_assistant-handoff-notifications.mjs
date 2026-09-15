import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);

  await sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS handoff_id UUID`;
  await sql`ALTER TABLE notifications ALTER COLUMN trip_id DROP NOT NULL`;
  await sql`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_handoff_fkey`;
  await sql`ALTER TABLE notifications ADD CONSTRAINT notifications_handoff_fkey
    FOREIGN KEY (handoff_id) REFERENCES assistant_handoffs(id) ON DELETE CASCADE`;
  await sql`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_event_type_check`;
  await sql`ALTER TABLE notifications ADD CONSTRAINT notifications_event_type_check
    CHECK (event_type IN ('contribution_created', 'contribution_status_changed',
      'contribution_visibility_changed', 'trip_request_fulfilled', 'assistant_handoff_created'))`;
  await sql`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_context_check`;
  await sql`ALTER TABLE notifications ADD CONSTRAINT notifications_context_check CHECK (
    (event_type = 'assistant_handoff_created' AND handoff_id IS NOT NULL
      AND trip_id IS NULL AND trip_request_id IS NULL AND suggestion_id IS NULL)
    OR
    (event_type = 'trip_request_fulfilled' AND handoff_id IS NULL
      AND trip_id IS NOT NULL AND trip_request_id IS NOT NULL AND suggestion_id IS NULL)
    OR
    (event_type NOT IN ('assistant_handoff_created', 'trip_request_fulfilled') AND handoff_id IS NULL
      AND trip_id IS NOT NULL AND trip_request_id IS NULL AND suggestion_id IS NOT NULL)
  )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS notifications_assistant_handoff_idx
    ON notifications (handoff_id) WHERE event_type = 'assistant_handoff_created'`;

  await sql`CREATE OR REPLACE FUNCTION notify_owner_of_assistant_handoff()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
  DECLARE recipient TEXT;
  BEGIN
    SELECT owner_email INTO recipient FROM assistant_policy_defaults WHERE id=TRUE;
    INSERT INTO notifications (recipient_email,trip_id,suggestion_id,trip_request_id,handoff_id,
      event_type,actor_name,created_at)
      SELECT recipient,NULL,NULL,NULL,NEW.id,'assistant_handoff_created',NEW.initiated_by_name,NEW.started_at
      FROM users WHERE email=recipient
      ON CONFLICT (handoff_id) WHERE event_type='assistant_handoff_created' DO NOTHING;
    RETURN NEW;
  END; $$`;
  await sql`DROP TRIGGER IF EXISTS assistant_handoff_owner_notification ON assistant_handoffs`;
  await sql`CREATE TRIGGER assistant_handoff_owner_notification
    AFTER INSERT ON assistant_handoffs FOR EACH ROW EXECUTE FUNCTION notify_owner_of_assistant_handoff()`;

  await sql`INSERT INTO notifications (recipient_email,trip_id,suggestion_id,trip_request_id,handoff_id,
    event_type,actor_name,created_at)
    SELECT defaults.owner_email,NULL,NULL,NULL,handoff.id,'assistant_handoff_created',
      handoff.initiated_by_name,handoff.started_at
    FROM assistant_handoffs handoff
    CROSS JOIN assistant_policy_defaults defaults
    JOIN users owner_user ON owner_user.email=defaults.owner_email
    WHERE defaults.id=TRUE AND handoff.status='active'
    ON CONFLICT (handoff_id) WHERE event_type='assistant_handoff_created' DO NOTHING`;
}
