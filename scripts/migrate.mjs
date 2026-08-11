import { resolveDatabaseConfig, resolveLocalAdminMode } from "../lib/runtime-config.mjs";
import { createSqlAdapter } from "../lib/sql-adapter.mjs";
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

await sql`CREATE INDEX IF NOT EXISTS suggestions_trip_created_idx
  ON suggestions (trip_id, created_at DESC)`;

await sql`CREATE INDEX IF NOT EXISTS suggestions_activity_idx
  ON suggestions (activity_id)`;

await sql`ALTER TABLE suggestions DROP CONSTRAINT IF EXISTS suggestions_activity_id_fkey`;
await sql`ALTER TABLE suggestions ADD CONSTRAINT suggestions_activity_id_fkey
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE SET NULL`;

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
