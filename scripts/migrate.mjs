import { resolveDatabaseConfig, resolveLocalAdminMode } from "../lib/runtime-config.mjs";
import { createSqlAdapter } from "../lib/sql-adapter.mjs";
import { backfillExistingContributorLogins } from "../lib/user-login-store.mjs";
import { assignItemKeys, slugify } from "./trip-import-utils.mjs";

let seedData;
try {
  seedData = await import("./seed-data.mjs");
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
  seedData = await import("./seed-data.example.mjs");
}
const { activities, sources, trip } = seedData;

const localAdmin = resolveLocalAdminMode();
const sql = createSqlAdapter(resolveDatabaseConfig());

if (localAdmin.enabled) console.log("Migrating the isolated local admin database.");

await sql`CREATE TABLE IF NOT EXISTS trips (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  trip_date DATE NOT NULL,
  timezone TEXT NOT NULL,
  location TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

await sql`CREATE TABLE IF NOT EXISTS sources (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  source_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  host TEXT NOT NULL,
  url TEXT NOT NULL,
  UNIQUE (trip_id, source_number)
)`;

await sql`CREATE TABLE IF NOT EXISTS activities (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  display_end TEXT,
  type TEXT NOT NULL,
  icon TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  UNIQUE (trip_id, sort_order)
)`;

await sql`CREATE TABLE IF NOT EXISTS activity_sources (
  activity_id BIGINT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  source_id BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  PRIMARY KEY (activity_id, source_id)
)`;

await sql`ALTER TABLE activities ADD COLUMN IF NOT EXISTS item_key TEXT`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS activities_trip_item_key_idx
  ON activities (trip_id, item_key)`;

await sql`ALTER TABLE activities ADD CONSTRAINT activities_id_trip_unique UNIQUE (id, trip_id)`
  .catch((error) => { if (error.code !== "42710" && error.code !== "42P07") throw error; });

await sql`CREATE TABLE IF NOT EXISTS schedule_branch_groups (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  anchor_activity_id BIGINT NOT NULL,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trip_id, item_key),
  UNIQUE (trip_id, anchor_activity_id),
  UNIQUE (id, trip_id),
  FOREIGN KEY (anchor_activity_id, trip_id) REFERENCES activities(id, trip_id) ON DELETE RESTRICT
)`;

await sql`ALTER TABLE schedule_branch_groups ALTER COLUMN anchor_activity_id DROP NOT NULL`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS schedule_branch_groups_trip_start_idx
  ON schedule_branch_groups (trip_id) WHERE anchor_activity_id IS NULL`;

await sql`CREATE TABLE IF NOT EXISTS schedule_branches (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL,
  group_id BIGINT NOT NULL,
  item_key TEXT NOT NULL,
  label TEXT NOT NULL,
  condition_text TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, item_key),
  UNIQUE (group_id, sort_order),
  UNIQUE (id, trip_id),
  UNIQUE (id, group_id, trip_id),
  FOREIGN KEY (group_id, trip_id) REFERENCES schedule_branch_groups(id, trip_id) ON DELETE CASCADE
)`;

await sql`CREATE UNIQUE INDEX IF NOT EXISTS schedule_branches_one_default_idx
  ON schedule_branches (group_id) WHERE is_default`;

await sql`ALTER TABLE activities ADD COLUMN IF NOT EXISTS branch_id BIGINT`;
await sql`ALTER TABLE activities ADD CONSTRAINT activities_branch_trip_fkey
  FOREIGN KEY (branch_id, trip_id) REFERENCES schedule_branches(id, trip_id) ON DELETE CASCADE`
  .catch((error) => { if (error.code !== "42710") throw error; });

await sql`CREATE TABLE IF NOT EXISTS schedule_branch_selections (
  group_id BIGINT PRIMARY KEY,
  trip_id BIGINT NOT NULL,
  branch_id BIGINT NOT NULL,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  selected_by_email TEXT NOT NULL,
  FOREIGN KEY (group_id, trip_id) REFERENCES schedule_branch_groups(id, trip_id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id, group_id, trip_id) REFERENCES schedule_branches(id, group_id, trip_id) ON DELETE RESTRICT
)`;

await sql`ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_trip_id_sort_order_key`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS activities_backbone_sort_order_idx
  ON activities (trip_id, sort_order) WHERE branch_id IS NULL`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS activities_branch_sort_order_idx
  ON activities (branch_id, sort_order) WHERE branch_id IS NOT NULL`;

await sql`CREATE TABLE IF NOT EXISTS suggestions (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  activity_id BIGINT REFERENCES activities(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'suggestion' CHECK (kind IN ('comment', 'suggestion')),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'resolved', 'rejected')),
  author_email TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_image TEXT,
  hidden_at TIMESTAMPTZ,
  hidden_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

await sql`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ`;
await sql`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS hidden_by_email TEXT`;

await sql`CREATE INDEX IF NOT EXISTS suggestions_trip_created_idx
  ON suggestions (trip_id, created_at DESC)`;

await sql`CREATE INDEX IF NOT EXISTS suggestions_activity_idx
  ON suggestions (activity_id)`;

await sql`CREATE INDEX IF NOT EXISTS suggestions_trip_visibility_idx
  ON suggestions (trip_id, hidden_at, created_at DESC)`;

await sql`CREATE TABLE IF NOT EXISTS users (
  name TEXT NOT NULL,
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  first_login TIMESTAMPTZ NOT NULL,
  last_login TIMESTAMPTZ NOT NULL,
  last_active_at TIMESTAMPTZ NOT NULL
)`;

await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'member'`;
await sql`UPDATE users SET role = 'member' WHERE role IS NULL`;
await sql`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'member'`;
await sql`ALTER TABLE users ALTER COLUMN role SET NOT NULL`;
await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`;
await sql`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('member', 'admin'))`;
await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ`;
await sql`UPDATE users SET last_active_at = last_login WHERE last_active_at IS NULL`;
await sql`ALTER TABLE users ALTER COLUMN last_active_at SET NOT NULL`;
await sql`DROP INDEX IF EXISTS users_last_login_idx`;
await sql`CREATE INDEX IF NOT EXISTS users_last_active_at_idx
  ON users (last_active_at DESC)`;

await sql`CREATE TABLE IF NOT EXISTS invitation_permissions (
  id BIGSERIAL PRIMARY KEY,
  user_email TEXT NOT NULL UNIQUE REFERENCES users(email) ON UPDATE CASCADE ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'revoked')),
  requested_trip_slug TEXT NOT NULL,
  requested_trip_title TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  decision_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

await sql`CREATE INDEX IF NOT EXISTS invitation_permissions_status_requested_idx
  ON invitation_permissions (status, requested_at DESC, id DESC)`;

await sql`CREATE TABLE IF NOT EXISTS invitation_deliveries (
  id BIGSERIAL PRIMARY KEY,
  request_id UUID NOT NULL,
  inviter_email TEXT,
  recipient_email TEXT NOT NULL,
  trip_id BIGINT REFERENCES trips(id) ON DELETE SET NULL,
  trip_slug TEXT NOT NULL,
  trip_title TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  gmail_message_id TEXT,
  error_code TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  UNIQUE (request_id, recipient_email)
)`;

await sql`ALTER TABLE invitation_deliveries
  DROP CONSTRAINT IF EXISTS invitation_deliveries_status_check`;
await sql`ALTER TABLE invitation_deliveries
  ADD CONSTRAINT invitation_deliveries_status_check
  CHECK (status IN ('sending', 'sent', 'failed'))`;

await sql`ALTER TABLE invitation_deliveries
  ADD COLUMN IF NOT EXISTS inviter_email TEXT`;

const invitationOwnerEmail = process.env.AUTH_OWNER_EMAIL?.trim().toLowerCase()
  || (localAdmin.enabled ? "local-admin@localhost.invalid" : "");
const [legacyInvitationCount] = await sql`
  SELECT COUNT(*)::INTEGER AS count
  FROM invitation_deliveries
  WHERE inviter_email IS NULL
`;
if (Number(legacyInvitationCount?.count || 0) > 0 && !invitationOwnerEmail) {
  throw new Error("AUTH_OWNER_EMAIL is required to backfill invitation delivery ownership.");
}
if (invitationOwnerEmail) {
  await sql`
    UPDATE invitation_deliveries
    SET inviter_email = ${invitationOwnerEmail}
    WHERE inviter_email IS NULL
  `;
}
await sql`ALTER TABLE invitation_deliveries
  ALTER COLUMN inviter_email SET NOT NULL`;

await sql`CREATE INDEX IF NOT EXISTS invitation_deliveries_attempted_idx
  ON invitation_deliveries (attempted_at DESC, id DESC)`;

await sql`CREATE INDEX IF NOT EXISTS invitation_deliveries_inviter_trip_idx
  ON invitation_deliveries (inviter_email, trip_slug, attempted_at DESC, id DESC)`;

await sql`CREATE TABLE IF NOT EXISTS invitation_batches (
  request_id UUID PRIMARY KEY,
  inviter_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

await sql`CREATE INDEX IF NOT EXISTS invitation_batches_inviter_created_idx
  ON invitation_batches (inviter_email, created_at DESC)`;

await sql`
  INSERT INTO invitation_batches (request_id, inviter_email, created_at)
  SELECT request_id, inviter_email, MIN(attempted_at)
  FROM invitation_deliveries
  GROUP BY request_id, inviter_email
  ON CONFLICT (request_id) DO NOTHING
`;

const backfilledUserCount = await backfillExistingContributorLogins(sql);
if (backfilledUserCount > 0) {
  console.log(`Synced ${backfilledUserCount} historical contributor identities into users.`);
}

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
await sql`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_event_type_check`;
await sql`ALTER TABLE notifications ADD CONSTRAINT notifications_event_type_check
  CHECK (event_type IN ('contribution_created', 'contribution_status_changed', 'contribution_visibility_changed'))`;
await sql`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_visibility_value_check`;
await sql`ALTER TABLE notifications ADD CONSTRAINT notifications_visibility_value_check
  CHECK (visibility_value IS NULL OR visibility_value IN ('hidden', 'visible'))`;

await sql`CREATE INDEX IF NOT EXISTS notifications_recipient_created_idx
  ON notifications (recipient_email, created_at DESC, id DESC)`;

await sql`CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
  ON notifications (recipient_email, created_at DESC, id DESC)
  WHERE read_at IS NULL`;

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
  AFTER INSERT OR DELETE OR UPDATE OF slug, title, trip_date, timezone, location ON trips
  FOR EACH ROW EXECUTE FUNCTION bump_trip_plan_revision()`;
await sql`DROP TRIGGER IF EXISTS sources_plan_revision_trigger ON sources`;
await sql`CREATE TRIGGER sources_plan_revision_trigger
  AFTER INSERT OR DELETE OR UPDATE OF source_number, title, host, url, trip_id ON sources
  FOR EACH ROW EXECUTE FUNCTION bump_trip_plan_revision()`;
await sql`DROP TRIGGER IF EXISTS activities_plan_revision_trigger ON activities`;
await sql`CREATE TRIGGER activities_plan_revision_trigger
  AFTER INSERT OR DELETE OR UPDATE OF item_key, branch_id, sort_order, start_time, end_time, display_end, type, icon, title, detail, trip_id ON activities
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

const activitiesWithoutKeys = await sql`
  SELECT id, trip_id, title
  FROM activities
  WHERE item_key IS NULL
  ORDER BY trip_id, sort_order
`;
for (const tripId of [...new Set(activitiesWithoutKeys.map((row) => String(row.trip_id)))]) {
  const rows = activitiesWithoutKeys.filter((row) => String(row.trip_id) === tripId);
  const existingKeys = await sql`SELECT item_key FROM activities WHERE trip_id = ${tripId} AND item_key IS NOT NULL`;
  const used = new Set(existingKeys.map((row) => row.item_key));
  for (const row of rows) {
    const base = slugify(row.title);
    let key = base;
    let suffix = 2;
    while (used.has(key)) { key = `${base}-${suffix}`; suffix += 1; }
    used.add(key);
    await sql`UPDATE activities SET item_key = ${key} WHERE id = ${row.id}`;
  }
}

const [tripRow] = await sql`
  INSERT INTO trips (slug, title, trip_date, timezone, location)
  VALUES (${trip.slug}, ${trip.title}, ${trip.date}, ${trip.timezone}, ${trip.location})
  ON CONFLICT (slug) DO UPDATE SET
    title = EXCLUDED.title,
    trip_date = EXCLUDED.trip_date,
    timezone = EXCLUDED.timezone,
    location = EXCLUDED.location,
    updated_at = NOW()
  RETURNING id
`;

const [existingSchedule] = await sql`
  SELECT COUNT(*)::INTEGER AS count FROM activities WHERE trip_id = ${tripRow.id}
`;

if (existingSchedule.count > 0) {
  console.log("Schema migrated. Existing schedule and suggestions were preserved.");
  await sql.end();
  process.exit(0);
}

const sourceIds = new Map();
for (const source of sources) {
  const [row] = await sql`
    INSERT INTO sources (trip_id, source_number, title, host, url)
    VALUES (${tripRow.id}, ${source.number}, ${source.title}, ${source.host}, ${source.url})
    RETURNING id
  `;
  sourceIds.set(source.number, row.id);
}

for (const [index, activity] of assignItemKeys(activities).entries()) {
  const [row] = await sql`
    INSERT INTO activities (trip_id, item_key, sort_order, start_time, end_time, display_end, type, icon, title, detail)
    VALUES (${tripRow.id}, ${activity.key}, ${index}, ${activity.start}, ${activity.end}, ${activity.displayEnd || null}, ${activity.type}, ${activity.icon}, ${activity.title}, ${activity.detail})
    RETURNING id
  `;

  for (const reference of activity.refs) {
    await sql`INSERT INTO activity_sources (activity_id, source_id) VALUES (${row.id}, ${sourceIds.get(reference)})`;
  }
}

console.log(`Migrated ${activities.length} activities and ${sources.length} sources.`);
await sql.end();
