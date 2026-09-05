import { readFile } from "node:fs/promises";
import { applyTripImport } from "../../scripts/trip-import-store.mjs";
import { normalizeTripImport } from "../../scripts/trip-import-utils.mjs";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { expect, test } from "./fixtures.mjs";

test("imports preserve keys, selected branches and notes; failed replacements and repeat seeds change nothing", async () => {
  const input = JSON.parse(await readFile(new URL("../../examples/trip-import.example.json", import.meta.url), "utf8"));
  input.trip.slug = `import-test-${Date.now()}`;
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  try {
    await applyTripImport(sql, normalizeTripImport(input), { createOnly: true });
    const [trip] = await sql`SELECT id FROM trips WHERE slug = ${input.trip.slug}`;
    const before = await sql`SELECT id,item_key FROM activities WHERE trip_id = ${trip.id} ORDER BY item_key`;
    const [branch] = await sql`SELECT * FROM schedule_branches WHERE trip_id = ${trip.id} AND item_key = 'rain'`;
    await sql`UPDATE schedule_branch_selections SET branch_id = ${branch.id} WHERE group_id = ${branch.group_id}`;
    await sql`INSERT INTO suggestions (trip_id,activity_id,author_email,author_name,body)
      VALUES (${trip.id},${before.find((item) => item.item_key === "day-two-breakfast").id},'import@example.com','Importer','Keep note')`;
    input.schedule[0].title = "Edited lunch";
    await applyTripImport(sql, normalizeTripImport(input));
    expect(await sql`SELECT id,item_key FROM activities WHERE trip_id = ${trip.id} ORDER BY item_key`).toEqual(before);
    expect((await sql`SELECT branch_id FROM schedule_branch_selections WHERE group_id = ${branch.group_id}`)[0].branch_id).toBe(branch.id);
    const snapshot = await sql`SELECT * FROM trips WHERE id = ${trip.id}`;
    await expect(applyTripImport(sql, normalizeTripImport(input), { createOnly: true })).rejects.toMatchObject({ code: "23505", constraint: "trips_slug_key" });
    expect(await sql`SELECT * FROM trips WHERE id = ${trip.id}`).toEqual(snapshot);
    const broken = normalizeTripImport(input);
    broken.schedule[0].end = "00:00";
    broken.trip.title = "Must roll back";
    await expect(applyTripImport(sql, broken)).rejects.toMatchObject({ code: "23514" });
    expect(await sql`SELECT * FROM trips WHERE id = ${trip.id}`).toEqual(snapshot);
    input.schedule.pop();
    await applyTripImport(sql, normalizeTripImport(input));
    expect(await sql`SELECT activity_id,body FROM suggestions WHERE trip_id = ${trip.id}`).toEqual([{ activity_id: null, body: "Keep note" }]);
    expect(await sql`SELECT * FROM activity_sources link JOIN activities a ON a.id = link.activity_id WHERE a.trip_id = ${trip.id}`).toHaveLength(2);
  } finally {
    await sql`DELETE FROM trips WHERE slug = ${input.trip.slug}`;
    await sql.end();
  }
});
