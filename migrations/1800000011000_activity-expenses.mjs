import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);

  await sql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS currency TEXT`;
  await sql`UPDATE trips SET currency='JPY' WHERE currency IS NULL`;
  await sql`ALTER TABLE trips ALTER COLUMN currency SET DEFAULT 'JPY'`;
  await sql`ALTER TABLE trips ALTER COLUMN currency SET NOT NULL`;
  await sql`ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_currency_check`;
  await sql`ALTER TABLE trips ADD CONSTRAINT trips_currency_check CHECK(currency IN ('VND','JPY','USD'))`;

  // A fresh migration run can still have deferred membership-trigger events from
  // the leadership migration in this transaction. Flush them before altering
  // trip_participants.
  await sql`SET CONSTRAINTS ALL IMMEDIATE`;
  await sql`ALTER TABLE trip_participants ADD COLUMN IF NOT EXISTS can_manage_expenses BOOLEAN`;
  await sql`UPDATE trip_participants SET can_manage_expenses=FALSE WHERE can_manage_expenses IS NULL`;
  await sql`ALTER TABLE trip_participants ALTER COLUMN can_manage_expenses SET DEFAULT FALSE`;
  await sql`ALTER TABLE trip_participants ALTER COLUMN can_manage_expenses SET NOT NULL`;

  await sql`CREATE TABLE IF NOT EXISTS activity_expenses (
    id BIGSERIAL PRIMARY KEY,
    trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    activity_id BIGINT NOT NULL,
    payer_email TEXT NOT NULL,
    amount_minor BIGINT NOT NULL CHECK(amount_minor > 0),
    created_by_email TEXT NOT NULL REFERENCES users(email) ON UPDATE CASCADE ON DELETE RESTRICT,
    updated_by_email TEXT NOT NULL REFERENCES users(email) ON UPDATE CASCADE ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY(activity_id,trip_id) REFERENCES activities(id,trip_id) ON DELETE RESTRICT,
    FOREIGN KEY(trip_id,payer_email) REFERENCES trip_participants(trip_id,user_email) ON UPDATE CASCADE ON DELETE RESTRICT
  )`;
  await sql`CREATE INDEX IF NOT EXISTS activity_expenses_trip_created_idx
    ON activity_expenses(trip_id,created_at,id)`;
  await sql`CREATE INDEX IF NOT EXISTS activity_expenses_activity_idx
    ON activity_expenses(activity_id,id)`;
  await sql`CREATE INDEX IF NOT EXISTS activity_expenses_payer_idx
    ON activity_expenses(trip_id,payer_email,id)`;
}
