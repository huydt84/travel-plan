import { migrationSql, slugify } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);
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

}
