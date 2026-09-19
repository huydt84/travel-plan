import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);
  await sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS route_start TEXT`;
  await sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS route_end TEXT`;
  await sql`
    UPDATE sources AS source
    SET route_start = route.start_name, route_end = route.end_name
    FROM trips AS trip,
      (VALUES
        ('https://maps.app.goo.gl/jDgSSMdgBYgSEu8p8', 'Funabashi', 'Shimoda'),
        ('https://maps.app.goo.gl/9GHBpHncppuAF3m19', 'Khách sạn', 'Shirahama Beach'),
        ('https://maps.app.goo.gl/CD4UZW1EVhySeyCR7', 'Shirahama Beach', 'Izu Seafood Taki'),
        ('https://maps.app.goo.gl/BktnQFMvgVSCXgXx7', 'Khách sạn', 'Shimoda Ropeway'),
        ('https://maps.app.goo.gl/H3hXgcMjNUhR2SzQA', 'Khách sạn', 'Núi Omuro')
      ) AS route(url, start_name, end_name)
    WHERE source.trip_id = trip.id
      AND trip.slug = 'silver-week-2026'
      AND source.kind = 'route'
      AND source.url = route.url
  `;
}
