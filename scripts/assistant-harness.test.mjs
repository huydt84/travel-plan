import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createGeminiModelAdapter } from "../lib/v1/gemini-adapter.mjs";
import { createGoogleResearchAdapters, extractSearchCitations } from "../lib/v1/research.mjs";
import { readTripSnapshot } from "../lib/v1/snapshot.mjs";
import { AssistantFault } from "../lib/v1/errors.mjs";
import { resolveAgenticV1Config } from "../lib/v1/config.mjs";
import { readEvents } from "../components/v1/stream.mjs";
import { snapshot, call, scriptedClient } from "./assistant-fixtures.mjs";

const run = (client, options = {}) => createGeminiModelAdapter({ client, model: "test", ...options }).run({ message: "Help", actor: { email: "test@example.com", isAdmin: true }, contextService: { targetSnapshot: async () => snapshot } });

test("proposal validation reaches the model for repair before publication", async () => {
  const client = scriptedClient([
    { steps: [call("stage_plan_changes", { trip: { kind: "trip", id: "1" }, operations: [{ kind: "activity.update", itemKey: "missing", set: { title: "New" } }] })] },
    (request) => {
      assert.ok(request.input[0].result.error);
      assert.match(request.system_instruction, /Never claim to have committed a plan/);
      assert.match(request.system_instruction, /activity.update/);
      return { steps: [call("stage_plan_changes", { trip: { kind: "trip", id: "1" }, operations: [{ kind: "activity.update", itemKey: "museum", set: { title: "New" } }] })] };
    },
    { output_text: "Ready to review" },
  ]);
  const result = await run(client);
  assert.equal(result.compiledProposal.preview.changes[0].after.title, "New");
  assert.equal(client.deleted.length, 3);
});

test("invalid arguments and unavailable research become tool results with one retry", async () => {
  let attempts = 0;
  const client = scriptedClient([
    { steps: [call("search_web", { query: "x" }, "invalid"), call("search_web", { query: "museum" }, "valid")] },
    (request) => {
      assert.equal(request.input[0].result.error.code, "INVALID_INPUT");
      assert.equal(request.input[1].result.error.code, "RESEARCH_UNAVAILABLE");
      return { output_text: "Hours unavailable." };
    },
  ]);
  await run(client, { research: { searchWeb() { attempts++; throw new AssistantFault("RESEARCH_UNAVAILABLE", "Unavailable", { retryable: true }); } } });
  assert.equal(attempts, 2);
});

test("parallel evidence is merged in call order with a maximum of two research calls", async () => {
  let active = 0, maximum = 0;
  const client = scriptedClient([
    { steps: [call("search_web", { query: "slow" }, "a"), call("search_web", { query: "fast" }, "b"), call("search_web", { query: "third" }, "c")] },
    (request) => {
      assert.deepEqual(request.input.map((item) => item.result.evidence[0].id), ["E1", "E2", "E3"]);
      return { output_text: "Sources [E1] [E2] [E3]" };
    },
  ]);
  const result = await run(client, { research: { async searchWeb({ query }) {
    active++; maximum = Math.max(maximum, active);
    await delay(query === "slow" ? 20 : 1); active--;
    return { summary: query, citations: [{ title: query, url: `https://example.com/${query}` }], checkedAt: "2030-01-01T00:00:00Z" };
  } } });
  assert.equal(maximum, 2);
  assert.deepEqual(result.citations.map((item) => item.title), ["slow", "fast", "third"]);
});

test("unknown tools, tool budget and fabricated citations fail closed", async () => {
  await assert.rejects(run(scriptedClient([{ steps: [call("send_email", {})] }])), { code: "TOOL_NOT_ALLOWED" });
  await assert.rejects(run(scriptedClient([{ steps: Array.from({ length: 9 }, (_, i) => call("read_context", { ref: { kind: "trip", id: "1" } }, String(i))) }])), { code: "TOOL_BUDGET_EXCEEDED" });
  await assert.rejects(run(scriptedClient([{ output_text: "Invented [E9]" }])), { code: "INVALID_EVIDENCE" });
});

test("abort settles even when the provider ignores the signal", async () => {
  const controller = new AbortController();
  const client = scriptedClient([() => new Promise(() => {})]);
  const pending = createGeminiModelAdapter({ client }).run({ message: "Help", snapshot, signal: controller.signal });
  controller.abort(new Error("stop"));
  await assert.rejects(pending, /stop/);
});

test("cleanup failure is recorded without losing the answer or logging provider data", async () => {
  const warnings = [];
  const result = await run(scriptedClient([{ output_text: "Hello" }], { deleteError: true }), { logger: { warn: (message) => warnings.push(message) } });
  assert.equal(result.text, "Hello");
  assert.deepEqual(warnings, ["Assistant provider cleanup incomplete"]);
});

test("source annotations follow SDK steps and reject executable URLs", () => {
  const citations = extractSearchCitations({ steps: [{ type: "model_output", content: [{ type: "text", annotations: [
    { type: "url_citation", url: "https://example.com", title: "Official" },
    { type: "url_citation", url: "javascript:alert(1)" },
  ] }] }] });
  assert.equal(citations.length, 1);
});

test("routes use explicit waypoints, trip timezone and Maps link modes", async () => {
  let body;
  const research = createGoogleResearchAdapters({ mapsApiKey: "test", now: () => Date.parse("2030-01-01T00:00:00Z"),
    fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return Response.json({ routes: [{ duration: "300s", distanceMeters: 100, unwanted: "private" }] }); },
  });
  const result = await research.computeRoute({ origin: { address: "Tokyo Station" }, destination: { placeId: "places/abcdef" }, travelMode: "TRANSIT", departureTime: "2030-01-01T12:00:00", timezone: "Asia/Tokyo" });
  assert.equal(body.departureTime, "2030-01-01T03:00:00.000Z");
  assert.deepEqual(body.destination, { placeId: "abcdef" });
  assert.ok(result.googleMapsUrl.includes("destination_place_id=abcdef"));
  assert.equal(result.routes[0].unwanted, undefined);
  const walk = await research.computeRoute({ origin: { address: "Tokyo" }, destination: { address: "Ginza" }, travelMode: "WALK" });
  assert.ok(walk.googleMapsUrl.includes("travelmode=walking"));
});

test("snapshot retry exhaustion never labels inconsistent data with a new revision", async () => {
  let revision = 0;
  const sql = async (strings) => strings.join("").includes("item_key") ? [] : [{ id: 1, plan_revision: ++revision }];
  await assert.rejects(readTripSnapshot("test", { sql, readItinerary: async () => snapshot }), { code: "PLAN_BUSY" });
});

test("stream parser rejects missing terminal events, duplicate sequence and wrong run IDs", async () => {
  const accepted = { seq: 1, type: "accepted", runId: "run", conversationId: "conversation" };
  const response = (events) => new Response(events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  for (const events of [[accepted], [accepted, { seq: 1, type: "completed", runId: "run" }], [accepted, { seq: 2, type: "completed", runId: "other" }]]) {
    await assert.rejects(readEvents(response(events), () => {}));
  }
  await readEvents(response([accepted, { seq: 2, type: "completed", runId: "run", turn: { id: "run", status: "completed" } }]), () => {});
});

test("real providers are opt-in only within isolated development mode", () => {
  assert.equal(resolveAgenticV1Config({ AGENTIC_V1_REAL_PROVIDERS: "true" }).realProviders, false);
  const config = resolveAgenticV1Config({ NODE_ENV: "development", LOCAL_ADMIN_BYPASS: "true", AGENTIC_V1_REAL_PROVIDERS: "true" });
  assert.equal(config.realProviders, true);
  assert.equal(config.turnDeadlineMs, 45_000);
});


test("model retries one transient failure and preserves proposal/evidence context", async () => {
  const failure = Object.assign(new Error("Unavailable"), { status: 503 });
  const client = scriptedClient([failure, (request) => {
    assert.match(request.input, /applied/);
    assert.match(request.input, /https:\/\/example.com\/source/);
    return { output_text: "Previously verified [E1]" };
  }]);
  const result = await createGeminiModelAdapter({ client }).run({ message: "What did we apply?", snapshot, history: [{
    input: "Research", output: "Source [E9]", citations: [{ id: "E9", url: "https://example.com/source", title: "Official" }],
    changeSet: { status: "applied", preview: { summary: "Updated museum" } },
  }] });
  assert.equal(result.citations[0].id, "E1");
  assert.equal(client.requests.length, 2);
});

test("proposal source additions require previously researched evidence", async () => {
  const client = scriptedClient([{ steps: [call("stage_plan_changes", { trip: { kind: "trip", id: "1" }, operations: [
    { kind: "source.add", draftId: "unknown", title: "Unknown", url: "https://example.com/unverified" },
  ] })] }, (request) => {
    assert.equal(request.input[0].result.error.code, "INVALID_EVIDENCE");
    return { output_text: "I could not verify that source." };
  }]);
  assert.equal((await run(client)).operations, null);
});


test("incomplete provider output never becomes a completed answer", async () => {
  await assert.rejects(run(scriptedClient([{ status: "incomplete", output_text: "Partial answer" }])), { code: "MODEL_INCOMPLETE" });
});
