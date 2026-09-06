import pg from "pg";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { createAssistantStore } from "../../lib/v1/store.mjs";
import { createBackgroundStore } from "../../lib/v1/background-store.mjs";
import { expect, test } from "./fixtures.mjs";

test("migration preserves legacy history and supports an entirely empty trip library", async () => {
  const client = new pg.Client({ connectionString: DEFAULT_LOCAL_POSTGRES_URI }); await client.connect();
  const schema = `assistant_test_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    const files = (await readdir("migrations")).filter((f) => /^\d.*\.mjs$/.test(f)).sort();
    const contextIndex=files.indexOf("1788912000000_assistant-context.mjs");
    for (const file of files.slice(0,contextIndex)) await (await import(`../../migrations/${file}`)).up({ db: client });
    const trip = (await client.query("INSERT INTO trips(slug,title,trip_date,end_date,timezone,location) VALUES('legacy','Legacy','2030-01-01','2030-01-01','Asia/Tokyo','Tokyo') RETURNING id")).rows[0];
    const conversation = randomUUID(), turn = randomUUID();
    await client.query("INSERT INTO assistant_conversations(id,owner_email,trip_id,title) VALUES($1,'migration@example.com',$2,'Legacy conversation')",[conversation,trip.id]);
    await client.query("INSERT INTO assistant_turns(id,conversation_id,client_turn_id,input_text,output_text,status) VALUES($1,$2,$3,'Old question','Old answer','completed')",[turn,conversation,randomUUID()]);
    await (await import(`../../migrations/${files[contextIndex]}`)).up({ db: client });
    expect((await client.query("SELECT pins FROM assistant_conversations WHERE id=$1",[conversation])).rows[0].pins).toEqual([{ kind: "trip", id: String(trip.id) }]);
    const legacyRequest = randomUUID();
    const legacy = (await client.query("SELECT accept_assistant_background_request('migration@example.com','legacy',NULL,$1,'Legacy worker','Legacy', $2,$3,60000,100,NULL) AS result", [legacyRequest,randomUUID(),randomUUID()])).rows[0].result;
    expect(legacy.error).toBeUndefined();
    expect((await client.query("SELECT pinned_context FROM assistant_turns WHERE id=$1",[legacy.turnId])).rows[0].pinned_context).toEqual([{ kind: "trip", id: String(trip.id) }]);
    const compatibilityStore = createAssistantStore({ sql: createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI, { pool: { query: (...args) => client.query(...args), end: async () => {} } }) });
    const legacyReplay = await compatibilityStore.acceptRequest({ ownerEmail: "migration@example.com", tripSlug: "legacy", conversationId: null, clientTurnId: legacyRequest, input: "Legacy worker", title: "Legacy", leaseMs: 60000, maxTurnsPerHour: 100 });
    expect(legacyReplay.replayed).toBe(true); expect(legacyReplay.turn.id).toBe(legacy.turnId);
    // Re-adoption must preserve deliberate unpins and historical captures.
    await client.query("UPDATE assistant_conversations SET pins='[]',pins_version=1 WHERE id=$1",[conversation]);
    await (await import(`../../migrations/${files[contextIndex]}`)).up({ db: client });
    expect((await client.query("SELECT pins FROM assistant_conversations WHERE id=$1",[conversation])).rows[0].pins).toEqual([]);
    const accept = async (retryOf = null) => (await client.query("SELECT accept_assistant_context_request('migration@example.com',$1,$2,'Retry question','Legacy',$3,$4,60000,100,'[]','[]',$5,false) AS result",[conversation,randomUUID(),randomUUID(),randomUUID(),retryOf])).rows[0].result;
    const original = await accept();
    expect(original.error).toBeUndefined();
    await client.query("UPDATE assistant_turns SET status='failed',error_code='TURN_INTERRUPTED' WHERE id=$1",[original.turnId]);
    await client.query("UPDATE assistant_conversations SET pins=$2 WHERE id=$1",[conversation,JSON.stringify([{kind:'trip',id:String(trip.id)}])]);
    const retry = await accept(original.turnId);
    expect(retry.error).toBeUndefined();
    expect((await client.query("SELECT pinned_context FROM assistant_turns WHERE id=$1",[retry.turnId])).rows[0].pinned_context).toEqual([]);
    await client.query("DELETE FROM trips");
    expect((await client.query("SELECT output_text FROM assistant_turns WHERE id=$1",[turn])).rows[0].output_text).toBe("Old answer");
    const pool = { query: (...args) => client.query(...args), end: async () => {} };
    const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI, { pool });
    const store = createAssistantStore({ sql });
    const replay = await store.acceptRequest({ ownerEmail: "migration@example.com", conversationId: null, clientTurnId: legacyRequest, input: "Legacy worker", title: "Legacy", leaseMs: 60000, maxTurnsPerHour: 100 });
    expect(replay.replayed).toBe(true); expect(replay.turn.id).toBe(legacy.turnId);
    const accepted = await store.acceptRequest({ ownerEmail: "empty@example.com", conversationId: null, clientTurnId: randomUUID(), input: "Find a destination", title: "Empty", leaseMs: 60000, maxTurnsPerHour: 100, background: true });
    expect(accepted.conversation.tripSlug).toBeNull();
    expect((await createBackgroundStore(store).job(accepted.turn.id)).conversation_id).toBe(accepted.conversation.id);
    await store.publishTurn({ turnId: accepted.turn.id, output: "No trip needed", citations: [] });
    expect((await store.listTurns(accepted.conversation.id,"empty@example.com"))[0].output).toBe("No trip needed");
  } finally { await client.query("SET search_path TO public"); await client.query(`DROP SCHEMA ${schema} CASCADE`); await client.end(); }
});
