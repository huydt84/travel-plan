import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);

  // Approval is an explicit user-input pause. A pending action stays
  // actionable until it is approved, rejected, or cancelled by Stop. Existing
  // non-null values remain historical expiries and are still enforced.
  await sql`ALTER TABLE assistant_actions ALTER COLUMN expires_at DROP NOT NULL`;
}
