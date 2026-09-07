import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT DEFAULT ''`;
  await sql`
    UPDATE users
    SET display_name = name
    WHERE NULLIF(BTRIM(display_name), '') IS NULL
  `;
  await sql`ALTER TABLE users ALTER COLUMN display_name SET DEFAULT ''`;
  await sql`ALTER TABLE users ALTER COLUMN display_name SET NOT NULL`;
}
