import { migrationSql } from "./support.mjs";
export const down = false;
export async function up(pgm) {
  const sql = migrationSql(pgm);
  await sql`CREATE TABLE IF NOT EXISTS google_research_cache (
    provider TEXT NOT NULL,
    request_hash TEXT PRIMARY KEY,
    request JSONB NOT NULL,
    response JSONB NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
  )`;
  await sql`CREATE INDEX IF NOT EXISTS google_research_cache_expires_idx ON google_research_cache (expires_at)`;
}
