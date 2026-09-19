import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);
  await sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'reference'`;
  await sql`ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_kind_check`;
  await sql`ALTER TABLE sources ADD CONSTRAINT sources_kind_check CHECK (kind IN ('reference', 'route'))`;
  await sql`
    UPDATE sources AS source
    SET kind = 'route'
    FROM trips AS trip
    WHERE source.trip_id = trip.id
      AND trip.slug = 'silver-week-2026'
      AND source.url IN (
        'https://maps.app.goo.gl/jDgSSMdgBYgSEu8p8',
        'https://maps.app.goo.gl/9GHBpHncppuAF3m19',
        'https://maps.app.goo.gl/CD4UZW1EVhySeyCR7',
        'https://maps.app.goo.gl/BktnQFMvgVSCXgXx7',
        'https://maps.app.goo.gl/H3hXgcMjNUhR2SzQA'
      )
  `;
}
