import { randomUUID } from "node:crypto";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { commitStoredChangeSet } from "../../lib/v1/committer.mjs";
import { expect, test } from "./fixtures.mjs";

test("assistant claims guard every shared write, roll back together, and replay one receipt", async () => {
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  const slug = `assistant-atomic-${Date.now()}`;
  const owner = "assistant-test@example.com";
  const [trip] = await sql`INSERT INTO trips (slug,title,trip_date,end_date,timezone,location)
    VALUES (${slug},'Atomic assistant','2032-01-01','2032-01-01','Asia/Tokyo','Tokyo') RETURNING id`;
  const conversationId = randomUUID();
  await sql`INSERT INTO assistant_conversations (id,owner_email,trip_id,title) VALUES (${conversationId},${owner},${trip.id},'Test')`;
  const store = { sql, async getChangeSet(id) {
    const [row] = await sql`SELECT * FROM assistant_change_sets WHERE id = ${id}`;
    return { ...row, tripId: row.trip_id, expiresAt: row.expires_at };
  } };
  const stage = async (operations) => {
    const turnId = randomUUID(), id = randomUUID();
    await sql`INSERT INTO assistant_turns (id,conversation_id,client_turn_id,input_text,status) VALUES (${turnId},${conversationId},${randomUUID()},'Test','completed')`;
    await sql`INSERT INTO assistant_change_sets (id,turn_id,trip_id,operations,preview,base_revision,digest,token_hash,expires_at,status)
      SELECT ${id},${turnId},id,${JSON.stringify(operations)}::JSONB,'{"summary":"Test"}'::JSONB,plan_revision,'digest','hash',NOW()+INTERVAL '1 hour','staged' FROM trips WHERE id = ${trip.id}`;
    return store.getChangeSet(id);
  };
  const value = { startDate: "2032-01-01", endDate: "2032-01-01", start: "09:00", end: "10:00", displayEnd: "+", type: "Visit", icon: "x", title: "Added", detail: "", refs: [1] };
  const operations = [
    { kind: "source.add", sourceNumber: 1, title: "Source", host: "example.com", url: "https://example.com" },
    { kind: "activity.add", itemKey: "added", branchId: null, value },
  ];
  try {
    const failed = await stage([...operations, { kind: "activity.update", itemKey: "added", set: { end: "08:00" } }]);
    await expect(commitStoredChangeSet({ store, changeSet: failed, actorEmail: owner })).rejects.toMatchObject({ code: "23514" });
    expect(await sql`SELECT * FROM activities WHERE trip_id = ${trip.id}`).toEqual([]);
    expect(await sql`SELECT * FROM sources WHERE trip_id = ${trip.id}`).toEqual([]);
    expect((await store.getChangeSet(failed.id)).status).toBe("staged");
    const staged = await stage(operations);
    const receipt = await commitStoredChangeSet({ store, changeSet: staged, actorEmail: owner });
    expect(receipt.tripSlug).toBe(slug);
    expect(await commitStoredChangeSet({ store, changeSet: staged, actorEmail: owner })).toEqual(receipt);
    expect(await sql`SELECT * FROM activities WHERE trip_id = ${trip.id}`).toHaveLength(1);
    expect(await sql`SELECT * FROM activity_sources link JOIN activities activity ON activity.id = link.activity_id WHERE activity.trip_id = ${trip.id}`).toHaveLength(1);
    const patch = await stage([{ kind: "activity.update", itemKey: "added", set: { title: "Changed", displayEnd: null, refs: [] } }]);
    await commitStoredChangeSet({ store, changeSet: patch, actorEmail: owner });
    expect((await sql`SELECT title,display_end FROM activities WHERE trip_id = ${trip.id}`)[0]).toEqual({ title: "Changed", display_end: null });
    expect(await sql`SELECT * FROM activity_sources link JOIN activities activity ON activity.id = link.activity_id WHERE activity.trip_id = ${trip.id}`).toHaveLength(0);
    const stale = await stage([{ kind: "activity.remove", itemKey: "added" }, { kind: "source.add", sourceNumber: 2, title: "Forbidden", host: "example.com", url: "https://example.com" }]);
    await sql`UPDATE trips SET title = 'Concurrent edit' WHERE id = ${trip.id}`;
    await expect(commitStoredChangeSet({ store, changeSet: stale, actorEmail: owner })).rejects.toMatchObject({ code: "PLAN_CONFLICT" });
    expect(await sql`SELECT * FROM activities WHERE trip_id = ${trip.id}`).toHaveLength(1);
    expect(await sql`SELECT * FROM sources WHERE trip_id = ${trip.id}`).toHaveLength(1);
  } finally {
    await sql`DELETE FROM trips WHERE id = ${trip.id}`;
    await sql.end();
  }
});
