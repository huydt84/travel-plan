import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);
  // Membership writes are constraint-checked at commit. Trip creation paths
  // add their Leader in the same transaction; avoiding a trip-row trigger also
  // keeps the assistant's existing internal SET CONSTRAINTS boundary compatible.
  await sql`DROP TRIGGER IF EXISTS trips_require_leader_trigger ON trips`;
}
