import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);
  await sql`ALTER TABLE saved_places ADD COLUMN IF NOT EXISTS google_maps_url TEXT`;
}
