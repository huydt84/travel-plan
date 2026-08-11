import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { signRevalidation } from "../lib/revalidation-signature.mjs";
import { resolveDatabaseConfig, resolveLocalAdminMode } from "../lib/runtime-config.mjs";
import { createSqlAdapter } from "../lib/sql-adapter.mjs";
import { normalizeTripImport } from "./trip-import-utils.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const fileArg = args.find((arg) => !arg.startsWith("--"));
if (!fileArg) {
  console.error("Usage: npm run trip:import -- <trip.json> [--apply]");
  process.exit(1);
}
const localAdmin = resolveLocalAdminMode();

const filePath = resolve(fileArg);
const payload = normalizeTripImport(JSON.parse(await readFile(filePath, "utf8")));
const sql = createSqlAdapter(resolveDatabaseConfig());
const existing = await sql`
  SELECT
    t.slug,
    a.id,
    a.item_key,
    TO_CHAR(a.start_time, 'HH24:MI') AS start,
    TO_CHAR(a.end_time, 'HH24:MI') AS end,
    a.type,
    a.title,
    a.detail,
    a.icon,
    a.display_end
  FROM trips t
  LEFT JOIN activities a ON a.trip_id = t.id
  WHERE t.slug = ${payload.trip.slug}
  ORDER BY a.sort_order
`;

const existingItems = existing.filter((row) => row.id).map((row) => ({
  key: row.item_key || `unkeyed-${row.id}`,
  start: row.start,
  end: row.end,
  type: row.type,
  title: row.title,
  detail: row.detail,
  icon: row.icon,
  displayEnd: row.display_end,
}));
const before = new Map(existingItems.map((item) => [item.key, item]));
const after = new Map(payload.schedule.map((item) => [item.key, item]));
const added = payload.schedule.filter((item) => !before.has(item.key));
const removed = existingItems.filter((item) => !after.has(item.key));
const updated = payload.schedule.filter((item) => {
  const old = before.get(item.key);
  if (!old) return false;
  return ["start", "end", "type", "title", "detail", "icon", "displayEnd"].some((field) => (old[field] ?? null) !== (item[field] ?? null));
});

const affectedSuggestions = removed.length ? await sql`
  SELECT COUNT(*)::INTEGER AS count
  FROM suggestions s
  JOIN activities a ON a.id = s.activity_id
  JOIN trips t ON t.id = a.trip_id
  WHERE t.slug = ${payload.trip.slug} AND a.item_key = ANY(${removed.map((item) => item.key)}::text[])
` : [{ count: 0 }];

console.log(`${apply ? "APPLY" : "PREVIEW"}: ${payload.trip.title} (${payload.trip.slug})`);
console.log(`Trip: ${existing.length ? "update" : "create"}`);
console.log(`Schedule: ${payload.schedule.length} total · ${added.length} add · ${updated.length} update · ${removed.length} remove`);
console.log(`Sources: ${payload.sources.length} total`);
if (affectedSuggestions[0].count) console.log(`Notes preserved: ${affectedSuggestions[0].count} suggestion(s) will become trip-level notes because their schedule item is removed.`);
for (const item of added) console.log(`  + ${item.start} ${item.title}`);
for (const item of updated) console.log(`  ~ ${item.start} ${item.title}`);
for (const item of removed) console.log(`  - ${item.start} ${item.title}`);

if (!apply) {
  console.log(`No database changes made. Apply with: npm run trip:import -- ${fileArg} --apply`);
  await sql.end();
  process.exit(0);
}

const { trip, sources, schedule } = payload;
const itemKeys = schedule.map((item) => item.key);
const sourceNumbers = sources.map((source) => source.number);

await sql.transaction((tx) => {
  const queries = [
    tx`
      INSERT INTO trips (slug, title, trip_date, timezone, location)
      VALUES (${trip.slug}, ${trip.title}, ${trip.date}, ${trip.timezone}, ${trip.location})
      ON CONFLICT (slug) DO UPDATE SET
        title = EXCLUDED.title,
        trip_date = EXCLUDED.trip_date,
        timezone = EXCLUDED.timezone,
        location = EXCLUDED.location,
        updated_at = NOW()
    `,
  ];

  for (const source of sources) {
    queries.push(tx`
      INSERT INTO sources (trip_id, source_number, title, host, url)
      SELECT id, ${source.number}, ${source.title}, ${source.host}, ${source.url}
      FROM trips WHERE slug = ${trip.slug}
      ON CONFLICT (trip_id, source_number) DO UPDATE SET
        title = EXCLUDED.title,
        host = EXCLUDED.host,
        url = EXCLUDED.url
    `);
  }

  queries.push(tx`
    UPDATE activities
    SET sort_order = sort_order + 1000000
    WHERE trip_id = (SELECT id FROM trips WHERE slug = ${trip.slug})
  `);

  for (const [index, item] of schedule.entries()) {
    queries.push(tx`
      INSERT INTO activities (trip_id, item_key, sort_order, start_time, end_time, display_end, type, icon, title, detail)
      SELECT id, ${item.key}, ${index}, ${item.start}, ${item.end}, ${item.displayEnd}, ${item.type}, ${item.icon}, ${item.title}, ${item.detail}
      FROM trips WHERE slug = ${trip.slug}
      ON CONFLICT (trip_id, item_key) DO UPDATE SET
        sort_order = EXCLUDED.sort_order,
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time,
        display_end = EXCLUDED.display_end,
        type = EXCLUDED.type,
        icon = EXCLUDED.icon,
        title = EXCLUDED.title,
        detail = EXCLUDED.detail
    `);
  }

  queries.push(tx`
    DELETE FROM activities
    WHERE trip_id = (SELECT id FROM trips WHERE slug = ${trip.slug})
      AND (item_key IS NULL OR item_key <> ALL(${itemKeys}::text[]))
  `);
  queries.push(tx`
    DELETE FROM activity_sources activity_source
    USING activities activity, trips trip_row
    WHERE activity_source.activity_id = activity.id
      AND activity.trip_id = trip_row.id
      AND trip_row.slug = ${trip.slug}
  `);

  for (const item of schedule) {
    for (const reference of item.refs) {
      queries.push(tx`
        INSERT INTO activity_sources (activity_id, source_id)
        SELECT activity.id, source.id
        FROM activities activity
        JOIN trips trip_row ON trip_row.id = activity.trip_id
        JOIN sources source ON source.trip_id = trip_row.id AND source.source_number = ${reference}
        WHERE trip_row.slug = ${trip.slug} AND activity.item_key = ${item.key}
      `);
    }
  }

  queries.push(tx`
    DELETE FROM sources
    WHERE trip_id = (SELECT id FROM trips WHERE slug = ${trip.slug})
      AND source_number <> ALL(${sourceNumbers}::integer[])
  `);
  return queries;
}, { isolationLevel: "Serializable" });

console.log("Import committed successfully.");

if (localAdmin.enabled) {
  console.log("Local admin import: production cache revalidation skipped.");
} else {
  const timestamp = Date.now();
  const signature = signRevalidation({ slug: trip.slug, timestamp }, process.env.AUTH_SECRET || "");
  const appUrl = process.env.APP_URL?.replace(/\/$/, "");
  if (!appUrl) {
    console.warn("Warning: APP_URL is not configured. Cached reads expire within 5 minutes.");
  } else {
    try {
      const response = await fetch(`${appUrl}/api/internal/revalidate-trip`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-trip-signature": signature,
        },
        body: JSON.stringify({ slug: trip.slug, timestamp }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      console.log("Production read cache invalidated.");
    } catch (error) {
      console.warn(`Warning: cache invalidation failed (${error.message}). Cached reads expire within 5 minutes.`);
    }
  }
}

await sql.end();
