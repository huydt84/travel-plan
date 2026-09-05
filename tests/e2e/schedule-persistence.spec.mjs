import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { saveScheduleRecord } from "../../lib/schedule-store.mjs";
import { expect, test } from "./fixtures.mjs";

test("schedule persistence rolls back activity and citations together", async ({ request }) => {
  const slug = `atomic-schedule-${Date.now()}`;
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  const input = {
    startDate: "2032-04-10", start: "09:00", endDate: "2032-04-10", end: "10:00",
    type: "Visit", icon: "📍", title: "Original", detail: "", displayEnd: "+",
  };
  try {
    expect((await request.post("/api/trips", { data: {
      slug, title: "Atomic schedule", startDate: input.startDate, endDate: input.endDate,
      timezone: "Asia/Tokyo", location: "Tokyo",
    } })).status()).toBe(201);
    expect((await request.post(`/api/trips/${slug}/sources`, { data: {
      title: "Original source", url: "https://example.com/original",
    } })).status()).toBe(201);
    const [trip] = await sql`SELECT id FROM trips WHERE slug = ${slug}`;
    const [source] = await sql`SELECT id FROM sources WHERE trip_id = ${trip.id}`;
    const activityId = await saveScheduleRecord(sql, {
      tripId: trip.id, itemKey: "original", input, sourceIds: [source.id],
    });

    // Simulate a citation disappearing after the caller validated its references.
    // A real FK failure after the activity UPDATE must restore both old values and links.
    await expect(saveScheduleRecord(sql, {
      tripId: trip.id, activityId, input: { title: "Must roll back" }, sourceIds: [-1],
    })).rejects.toThrow();
    const [activity] = await sql`SELECT title FROM activities WHERE id = ${activityId}`;
    expect(activity.title).toBe("Original");
    expect(await sql`SELECT source_id FROM activity_sources WHERE activity_id = ${activityId}`)
      .toEqual([{ source_id: source.id }]);

    await expect(saveScheduleRecord(sql, {
      tripId: trip.id, itemKey: "must-not-exist", input, sourceIds: [-1],
    })).rejects.toThrow();
    expect(await sql`SELECT id FROM activities WHERE trip_id = ${trip.id}`).toHaveLength(1);

    // Public PATCH semantics: omitted references preserve links, [] clears them,
    // and an explicit null clears the optional end label.
    expect((await request.patch(`/api/trips/${slug}/schedule/${activityId}`, {
      data: { title: "Saved", displayEnd: null },
    })).status()).toBe(200);
    const preserved = await (await request.get(`/api/trips/${slug}/schedule/${activityId}`)).json();
    expect(preserved).toMatchObject({ title: "Saved", refs: [1], displayEnd: null });
    expect((await request.patch(`/api/trips/${slug}/schedule/${activityId}`, {
      data: { refs: [] },
    })).status()).toBe(200);
    expect(await sql`SELECT source_id FROM activity_sources WHERE activity_id = ${activityId}`).toEqual([]);
  } finally {
    await request.delete(`/api/trips/${slug}`);
    await sql.end();
  }
});
