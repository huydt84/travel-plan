import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);
  const [{ owner_email: invitationOwnerEmail }] = await sql`SELECT current_setting('app.migration_owner', true) AS owner_email`;

  await sql`CREATE TABLE IF NOT EXISTS trip_participants (
    trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL REFERENCES users(email) ON UPDATE CASCADE ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_participated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (trip_id, user_email)
  )`;

  await sql`CREATE INDEX IF NOT EXISTS trip_participants_user_idx
    ON trip_participants (user_email, last_participated_at DESC)`;

  await sql`
    INSERT INTO trip_participants (trip_id, user_email, joined_at, last_participated_at)
    SELECT
      trip_id,
      LOWER(TRIM(author_email)),
      MIN(created_at),
      MAX(created_at)
    FROM suggestions
    WHERE NULLIF(TRIM(author_email), '') IS NOT NULL
    GROUP BY trip_id, LOWER(TRIM(author_email))
    ON CONFLICT (trip_id, user_email) DO UPDATE SET
      joined_at = LEAST(trip_participants.joined_at, EXCLUDED.joined_at),
      last_participated_at = GREATEST(trip_participants.last_participated_at, EXCLUDED.last_participated_at)
  `;

  await sql`CREATE TABLE IF NOT EXISTS trip_requests (
    id BIGSERIAL PRIMARY KEY,
    requester_email TEXT NOT NULL REFERENCES users(email) ON UPDATE CASCADE ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'declined', 'withdrawn')),
    decision_reason TEXT NOT NULL DEFAULT '',
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_date >= start_date)
  )`;

  await sql`CREATE INDEX IF NOT EXISTS trip_requests_requester_created_idx
    ON trip_requests (requester_email, created_at DESC, id DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS trip_requests_state_created_idx
    ON trip_requests (state, created_at DESC, id DESC)`;

  await sql`CREATE TABLE IF NOT EXISTS trip_request_places (
    request_id BIGINT NOT NULL REFERENCES trip_requests(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    name TEXT NOT NULL,
    PRIMARY KEY (request_id, position)
  )`;

  await sql`CREATE TABLE IF NOT EXISTS trip_request_sources (
    request_id BIGINT NOT NULL REFERENCES trip_requests(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    label TEXT,
    url TEXT NOT NULL,
    PRIMARY KEY (request_id, position)
  )`;

  await sql`CREATE TABLE IF NOT EXISTS trip_request_fulfillments (
    request_id BIGINT PRIMARY KEY REFERENCES trip_requests(id) ON DELETE CASCADE,
    trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    attached_by TEXT NOT NULL,
    attached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;

  await sql`CREATE INDEX IF NOT EXISTS trip_request_fulfillments_trip_idx
    ON trip_request_fulfillments (trip_id, attached_at DESC)`;

  await sql`CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    recipient_email TEXT NOT NULL REFERENCES users(email) ON UPDATE CASCADE ON DELETE CASCADE,
    trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    suggestion_id BIGINT NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('contribution_created', 'contribution_status_changed', 'contribution_visibility_changed')),
    actor_name TEXT NOT NULL,
    actor_image TEXT,
    status_value TEXT CHECK (status_value IS NULL OR status_value IN ('open', 'accepted', 'resolved', 'rejected')),
    visibility_value TEXT CHECK (visibility_value IS NULL OR visibility_value IN ('hidden', 'visible')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TIMESTAMPTZ
  )`;

  await sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS visibility_value TEXT`;
  await sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS trip_request_id BIGINT`;
  await sql`ALTER TABLE notifications ALTER COLUMN suggestion_id DROP NOT NULL`;
  await sql`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_trip_request_fkey`;
  await sql`ALTER TABLE notifications ADD CONSTRAINT notifications_trip_request_fkey
    FOREIGN KEY (trip_request_id) REFERENCES trip_requests(id) ON DELETE CASCADE`;
  await sql`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_event_type_check`;
  await sql`ALTER TABLE notifications ADD CONSTRAINT notifications_event_type_check
    CHECK (event_type IN ('contribution_created', 'contribution_status_changed', 'contribution_visibility_changed', 'trip_request_fulfilled'))`;
  await sql`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_visibility_value_check`;
  await sql`ALTER TABLE notifications ADD CONSTRAINT notifications_visibility_value_check
    CHECK (visibility_value IS NULL OR visibility_value IN ('hidden', 'visible'))`;
  await sql`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_context_check`;
  await sql`ALTER TABLE notifications ADD CONSTRAINT notifications_context_check CHECK (
    (event_type = 'trip_request_fulfilled' AND trip_request_id IS NOT NULL AND suggestion_id IS NULL)
    OR
    (event_type <> 'trip_request_fulfilled' AND trip_request_id IS NULL AND suggestion_id IS NOT NULL)
  )`;

  await sql`CREATE INDEX IF NOT EXISTS notifications_recipient_created_idx
    ON notifications (recipient_email, created_at DESC, id DESC)`;

  await sql`CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
    ON notifications (recipient_email, created_at DESC, id DESC)
    WHERE read_at IS NULL`;

  await sql`CREATE UNIQUE INDEX IF NOT EXISTS notifications_trip_request_fulfilled_idx
    ON notifications (trip_request_id, trip_id, event_type)
    WHERE event_type = 'trip_request_fulfilled'`;

  await sql`CREATE TABLE IF NOT EXISTS admin_notification_outbox (
    id BIGSERIAL PRIMARY KEY,
    suggestion_id BIGINT NOT NULL UNIQUE REFERENCES suggestions(id) ON DELETE CASCADE,
    recipient_email TEXT NOT NULL,
    author_name TEXT NOT NULL,
    contribution_kind TEXT NOT NULL CHECK (contribution_kind IN ('comment', 'suggestion')),
    contribution_body TEXT NOT NULL,
    trip_slug TEXT NOT NULL,
    trip_title TEXT NOT NULL,
    activity_title TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_expires_at TIMESTAMPTZ,
    resend_message_id TEXT,
    last_error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ
  )`;

  await sql`ALTER TABLE admin_notification_outbox ADD COLUMN IF NOT EXISTS recipient_email TEXT`;
  await sql`ALTER TABLE admin_notification_outbox ADD COLUMN IF NOT EXISTS author_name TEXT`;
  await sql`ALTER TABLE admin_notification_outbox ADD COLUMN IF NOT EXISTS contribution_kind TEXT`;
  await sql`ALTER TABLE admin_notification_outbox ADD COLUMN IF NOT EXISTS contribution_body TEXT`;
  await sql`ALTER TABLE admin_notification_outbox ADD COLUMN IF NOT EXISTS trip_slug TEXT`;
  await sql`ALTER TABLE admin_notification_outbox ADD COLUMN IF NOT EXISTS trip_title TEXT`;
  await sql`ALTER TABLE admin_notification_outbox ADD COLUMN IF NOT EXISTS activity_title TEXT`;

  const [legacyOutboxPayloadCount] = await sql`
    SELECT COUNT(*)::INTEGER AS count
    FROM admin_notification_outbox
    WHERE recipient_email IS NULL
  `;
  if (Number(legacyOutboxPayloadCount?.count || 0) > 0 && !invitationOwnerEmail) {
    throw new Error("AUTH_OWNER_EMAIL is required to backfill notification email payloads.");
  }
  await sql`
    UPDATE admin_notification_outbox outbox
    SET
      recipient_email = COALESCE(outbox.recipient_email, ${invitationOwnerEmail || null}),
      author_name = COALESCE(outbox.author_name, suggestion.author_name),
      contribution_kind = COALESCE(outbox.contribution_kind, suggestion.kind),
      contribution_body = COALESCE(outbox.contribution_body, suggestion.body),
      trip_slug = COALESCE(outbox.trip_slug, trip.slug),
      trip_title = COALESCE(outbox.trip_title, trip.title),
      activity_title = COALESCE(outbox.activity_title, activity.title)
    FROM suggestions suggestion
    JOIN trips trip ON trip.id = suggestion.trip_id
    LEFT JOIN activities activity ON activity.id = suggestion.activity_id
    WHERE outbox.suggestion_id = suggestion.id
      AND (
        outbox.recipient_email IS NULL
        OR outbox.author_name IS NULL
        OR outbox.contribution_kind IS NULL
        OR outbox.contribution_body IS NULL
        OR outbox.trip_slug IS NULL
        OR outbox.trip_title IS NULL
      )
  `;

  await sql`ALTER TABLE admin_notification_outbox ALTER COLUMN recipient_email SET NOT NULL`;
  await sql`ALTER TABLE admin_notification_outbox ALTER COLUMN author_name SET NOT NULL`;
  await sql`ALTER TABLE admin_notification_outbox ALTER COLUMN contribution_kind SET NOT NULL`;
  await sql`ALTER TABLE admin_notification_outbox ALTER COLUMN contribution_body SET NOT NULL`;
  await sql`ALTER TABLE admin_notification_outbox ALTER COLUMN trip_slug SET NOT NULL`;
  await sql`ALTER TABLE admin_notification_outbox ALTER COLUMN trip_title SET NOT NULL`;

  await sql`ALTER TABLE admin_notification_outbox DROP CONSTRAINT IF EXISTS admin_notification_outbox_contribution_kind_check`;
  await sql`ALTER TABLE admin_notification_outbox ADD CONSTRAINT admin_notification_outbox_contribution_kind_check
    CHECK (contribution_kind IN ('comment', 'suggestion'))`;

  await sql`CREATE INDEX IF NOT EXISTS admin_notification_outbox_pending_idx
    ON admin_notification_outbox (next_attempt_at, id)
    WHERE status IN ('pending', 'sending')`;

  await sql`ALTER TABLE suggestions DROP CONSTRAINT IF EXISTS suggestions_activity_id_fkey`;
  await sql`ALTER TABLE suggestions ADD CONSTRAINT suggestions_activity_id_fkey
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE SET NULL`;

}
