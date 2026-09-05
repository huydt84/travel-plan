import { migrationSql, backfillExistingContributorLogins } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);
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

  const [{ owner_email: invitationOwnerEmail }] = await sql`
    SELECT current_setting('app.migration_owner', true) AS owner_email
  `;
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

  await backfillExistingContributorLogins(sql);

}
