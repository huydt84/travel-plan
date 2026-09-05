import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);
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
  await sql`ALTER TABLE trips ADD COLUMN IF NOT EXISTS end_date DATE`;
  await sql`UPDATE trips SET end_date = trip_date WHERE end_date IS NULL`;
  await sql`ALTER TABLE trips ALTER COLUMN end_date SET NOT NULL`;
  await sql`ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_date_range_check`;
  await sql`ALTER TABLE trips ADD CONSTRAINT trips_date_range_check CHECK (end_date >= trip_date)`;

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
  await sql`ALTER TABLE activities ADD COLUMN IF NOT EXISTS start_date DATE`;
  await sql`ALTER TABLE activities ADD COLUMN IF NOT EXISTS end_date DATE`;
  await sql`
    UPDATE activities activity
    SET start_date = trip.trip_date,
        end_date = trip.trip_date
    FROM trips trip
    WHERE activity.trip_id = trip.id
      AND (activity.start_date IS NULL OR activity.end_date IS NULL)
  `;
  await sql`ALTER TABLE activities ALTER COLUMN start_date SET NOT NULL`;
  await sql`ALTER TABLE activities ALTER COLUMN end_date SET NOT NULL`;
  await sql`ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_date_interval_check`;
  await sql`ALTER TABLE activities ADD CONSTRAINT activities_date_interval_check CHECK (
    end_date >= start_date
    AND end_date <= start_date + 1
    AND (end_date > start_date OR end_time > start_time)
  )`;

  await sql`CREATE OR REPLACE FUNCTION validate_trip_activity_date_range()
  RETURNS TRIGGER AS $$
  DECLARE
    invalid_count INTEGER;
  BEGIN
    IF TG_TABLE_NAME = 'trips' THEN
      SELECT COUNT(*)::INTEGER INTO invalid_count
      FROM activities
      WHERE trip_id = NEW.id
        AND (start_date < NEW.trip_date OR end_date > NEW.end_date);
      IF invalid_count > 0 THEN
        RAISE EXCEPTION '% activities fall outside the trip date range', invalid_count
          USING ERRCODE = '23514';
      END IF;
    ELSE
      SELECT COUNT(*)::INTEGER INTO invalid_count
      FROM trips
      WHERE id = NEW.trip_id
        AND NEW.start_date >= trip_date
        AND NEW.end_date <= end_date;
      IF invalid_count = 0 THEN
        RAISE EXCEPTION 'activity falls outside the trip date range'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql`;
  await sql`DROP TRIGGER IF EXISTS trips_activity_date_range_trigger ON trips`;
  await sql`CREATE CONSTRAINT TRIGGER trips_activity_date_range_trigger
    AFTER INSERT OR UPDATE OF trip_date, end_date ON trips
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION validate_trip_activity_date_range()`;
  await sql`DROP TRIGGER IF EXISTS activities_trip_date_range_trigger ON activities`;
  await sql`CREATE CONSTRAINT TRIGGER activities_trip_date_range_trigger
    AFTER INSERT OR UPDATE OF trip_id, start_date, end_date ON activities
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION validate_trip_activity_date_range()`;

  await sql`CREATE TABLE IF NOT EXISTS activity_sources (
    activity_id BIGINT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    source_id BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    PRIMARY KEY (activity_id, source_id)
  )`;

  await sql`ALTER TABLE activities ADD COLUMN IF NOT EXISTS item_key TEXT`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS activities_trip_item_key_idx
    ON activities (trip_id, item_key)`;

  await sql`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'activities'::regclass AND conname = 'activities_id_trip_unique') THEN
      ALTER TABLE activities ADD CONSTRAINT activities_id_trip_unique UNIQUE (id, trip_id);
    END IF;
  END $$`;

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
  await sql`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'activities'::regclass AND conname = 'activities_branch_trip_fkey') THEN
      ALTER TABLE activities ADD CONSTRAINT activities_branch_trip_fkey
        FOREIGN KEY (branch_id, trip_id) REFERENCES schedule_branches(id, trip_id) ON DELETE CASCADE;
    END IF;
  END $$`;

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

}
