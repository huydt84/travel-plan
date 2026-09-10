import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPostgresSql } from "../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../lib/runtime-config.mjs";
import { createAssistantStore } from "../lib/v1/store.mjs";
import { createTravelAssistant } from "../lib/v1/travel-assistant.mjs";
import { createContextService } from "../lib/v1/context.mjs";
import { createGoogleResearchAdapters } from "../lib/v1/research.mjs";
import { resolveAgenticV1Config } from "../lib/v1/config.mjs";
import { assistantFault } from "../lib/v1/errors.mjs";
import { snapshot as example, activity } from "./assistant-fixtures.mjs";

// This command may consume .env internally. Never print provider exceptions:
// they can contain request headers. Every write targets the fixed local DB.
const config = resolveAgenticV1Config({ ...process.env, NODE_ENV: "development", LOCAL_ADMIN_BYPASS: "true", AGENTIC_V1_REAL_PROVIDERS: "true" });
const missing = [!config.geminiApiKey && "GEMINI_API_KEY", !config.mapsApiKey && "GOOGLE_MAPS_PLATFORM_API_KEY"].filter(Boolean);
if (missing.length) {
  console.log(`Live smoke outstanding: configure ${missing.join(" and ")} and rerun. No provider calls or database writes made.`);
  process.exitCode = 2;
} else {
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  const slug = `live-harness-${randomUUID()}`;
  let tripId, turnId, phase = "setup";
  try {
    const [trip] = await sql`INSERT INTO trips(slug,title,trip_date,end_date,timezone,location)
      VALUES(${slug},'Disposable harness smoke','2030-01-01','2030-01-01','Asia/Tokyo','Tokyo') RETURNING id`;
    tripId = trip.id;
    await sql`INSERT INTO activities(trip_id,item_key,sort_order,start_date,start_time,end_date,end_time,type,icon,title,detail)
      VALUES(${tripId},'museum',0,'2030-01-01','09:00','2030-01-01','10:00','Visit','pin','Museum','Original')`;
    const readSnapshot = async () => {
      const [row] = await sql`SELECT plan_revision FROM trips WHERE id=${tripId}`;
      const [item] = await sql`SELECT id,title,detail FROM activities WHERE trip_id=${tripId}`;
      const current = { ...activity, ...item, id: String(item.id) };
      return { ...example, tripId: String(tripId), revision: Number(row.plan_revision), trip: { ...example.trip, slug }, backbone: [current], itinerary: [current] };
    };
    const research = createGoogleResearchAdapters({ geminiApiKey: config.geminiApiKey, geminiModel: config.geminiModel, mapsApiKey: config.mapsApiKey });
    phase = "Google Search";
    const search = await research.searchWeb({ query: "Tokyo National Museum official opening hours" }, { signal: AbortSignal.timeout(45000) });
    assert.ok(search.citations.length, "Search must return citations");
    phase = "Google Places search and details";
    const places = await research.searchPlaces({ query: "Tokyo National Museum Tokyo" }, { signal: AbortSignal.timeout(15000) });
    assert.ok(places.places[0]?.placeId);
    await research.getPlaceDetails({ placeId: places.places[0].placeId }, { signal: AbortSignal.timeout(15000) });
    phase = "Google Routes";
    const routes = await research.computeRoute({ origin: { address: "Ueno Station Tokyo" }, destination: { placeId: places.places[0].placeId }, travelMode: "WALK" }, { signal: AbortSignal.timeout(15000) });
    assert.ok(routes.routes.length);
    phase = "Gemini grounded proposal";
    const store = createAssistantStore({ sql });
    const contextService = createContextService({ sql, research, readSnapshot, maxChars: config.contextMaxChars });
    const assistant = createTravelAssistant({ config, store, readSnapshot, listTrips: async () => [], researchAdapters: research, contextService, invalidateCache: () => {} });
    const before = await readSnapshot();
    const actor = { email: "local-admin@localhost.invalid", isAdmin: true, isOwner: true };
    const run = await assistant.startTurn({ actor, tripSlug: slug, clientTurnId: randomUUID(),
      message: "Find the official Tokyo National Museum website using search_web and cite it. Then stage exactly one change: update activity museum title to Tokyo National Museum. Preserve all other fields. This is a staging request, not permission to apply." });
    turnId = run.runId;
    let awaiting;
    for await (const event of run.events) {
      if (event.type === "failed") { console.log(`Harness outcome: ${event.error.code}`); throw new Error("Harness turn failed"); }
      if (event.type === "awaiting_approval") awaiting = event.turn;
    }
    assert.ok(awaiting?.actions?.[0]?.confirmationToken && awaiting.citations.length);
    assert.deepEqual(await readSnapshot(), before, "Staging must not mutate the plan");
    phase = "explicit approval";
    const action = awaiting.actions[0];
    const receipt = await assistant.approveAction({ actor, actionId: action.id, confirmationToken: action.confirmationToken });
    assert.ok(receipt.receipt);
    assert.equal((await readSnapshot()).backbone[0].title, "Tokyo National Museum");
    console.log("Live smoke passed: Gemini, Search, Places, Routes, staged-only preview, and explicit approval. Disposable local trip removed.");
  } catch (error) {
    if (turnId) {
      const diagnostics = await sql`SELECT r.tool_name, r.status, r.error_code, r.duration_ms, r.result_metadata
        FROM assistant_tool_runs r WHERE r.turn_id=${turnId}::UUID ORDER BY r.ordinal,r.created_at`;
      console.log(JSON.stringify(diagnostics));
    }
    console.error(`Live smoke failed at ${phase} (${assistantFault(error).code}). Provider payloads withheld. Check configuration, quota, and the safe assistant tool audit records.`);
    process.exitCode = 1;
  } finally {
    if (tripId) await sql`DELETE FROM trips WHERE id=${tripId}`;
    await sql.end();
  }
}
