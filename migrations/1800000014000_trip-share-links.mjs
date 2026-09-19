import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);
  await sql`CREATE TABLE IF NOT EXISTS trip_share_links (
    token_hash TEXT PRIMARY KEY,
    trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    created_by_email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT trip_share_links_expiry_check CHECK (expires_at > created_at)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS trip_share_links_trip_expiry_idx ON trip_share_links(trip_id, expires_at DESC)`;
}
