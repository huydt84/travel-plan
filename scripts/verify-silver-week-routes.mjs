import { getSql } from "../lib/db.js";

const expectedRoutes = new Set([
  "https://maps.app.goo.gl/jDgSSMdgBYgSEu8p8",
  "https://maps.app.goo.gl/9GHBpHncppuAF3m19",
  "https://maps.app.goo.gl/CD4UZW1EVhySeyCR7",
  "https://maps.app.goo.gl/BktnQFMvgVSCXgXx7",
  "https://maps.app.goo.gl/H3hXgcMjNUhR2SzQA",
]);

const sql = getSql();
try {
  const sources = await sql`
    SELECT source.source_number, source.kind, source.url
    FROM sources AS source
    JOIN trips AS trip ON trip.id = source.trip_id
    WHERE trip.slug = 'silver-week-2026'
    ORDER BY source.source_number
  `;
  const routes = sources.filter((source) => source.kind === "route");
  const references = sources.filter((source) => source.kind === "reference");
  const correct = sources.length === 6
    && routes.length === 5
    && references.length === 1
    && routes.every((source) => expectedRoutes.has(source.url))
    && references[0].url === "https://www.baykuro.co.jp/hotspring/";
  if (!correct) throw new Error("Silver Week source categories do not match the expected six links");
  console.log("Silver Week 2026: 5 route links, 1 reference; all URLs matched.");
} finally {
  await sql.end();
}
