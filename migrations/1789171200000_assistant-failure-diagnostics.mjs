import { migrationSql } from "./support.mjs";
export const down = false;
export async function up(pgm) {
  const sql = migrationSql(pgm);
  await sql`ALTER TABLE assistant_turns ADD COLUMN IF NOT EXISTS error_diagnostics JSONB`;
  await sql`CREATE INDEX IF NOT EXISTS assistant_failed_turns ON assistant_turns(completed_at DESC,id DESC)
    WHERE status='failed' AND error_code IS DISTINCT FROM 'TURN_CANCELLED'`;
}
