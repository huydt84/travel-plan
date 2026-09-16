import test from "node:test";
import assert from "node:assert/strict";
import { createContextService, canonicalRefs } from "../lib/v1/context.mjs";
import { createGeminiModelAdapter, createLocalModelAdapter } from "../lib/v1/gemini-adapter.mjs";
import { executeTool } from "../lib/v1/tool-runtime.mjs";
import { safeEvidence } from "../lib/v1/evidence.mjs";
import { snapshot, call, scriptedClient } from "./assistant-fixtures.mjs";
const actor = { email: "owner@example.com", isAdmin: true };
const trip = { kind: "trip", id: "1" };
test("references use stable typed identities and bounded input", () => {
  assert.deepEqual(canonicalRefs([trip, trip, { kind: "activity", id: "1" }]), [{ kind: "activity", id: "1" }, trip]);
  for (const ref of [{ kind: "trip", id: "museum" }, { kind: "place", id: "unqualified" }, { kind: "user", id: "1" }]) assert.throws(() => canonicalRefs([ref]));
});
test("context service rejects unauthorized search and reads before querying", async () => {
  let calls = 0; const service = createContextService({ sql: async () => { calls++; return []; } });
  await assert.rejects(service.search({ email: "member@example.com" }), { code: "PILOT_FORBIDDEN" });
  await assert.rejects(service.read(null, trip), { code: "PILOT_FORBIDDEN" }); assert.equal(calls, 0);
  assert.equal((await service.read(actor, trip)).available, false);
});
test("assembly reports omitted data rather than silently overflowing its budget", async () => {
  const service = createContextService({
    maxChars: 500,
    sql: async () => [{ kind: "trip", id: "1", label: "Trip", trip_id: "1", trip_title: "Trip", slug: "trip", revision: 1, content: {} }],
    readSnapshot: async () => ({
      ...snapshot,
      trip: { ...snapshot.trip, detail: "x".repeat(1000) },
    }),
  });
  const [item] = await service.assemble(actor, [trip]); assert.equal(item.omitted, true); assert.equal(item.content, undefined);
});
test("oversized trip context keeps exact expense totals structured", async () => {
  const expenses = { currency: "JPY", totalAmount: "300", averageAmount: "150", participantCount: 2,
    members: [{ displayName: "Leader", role: "leader", totalAmount: "300", differenceAmount: "150", comparison: "more" }],
    activities: [{ activityId: "1", title: "Museum", totalAmount: "300", expenseCount: 1 }],
    recentEntries: [{ activityId: "1", activityTitle: "Museum", payer: "Leader", amount: "300", recordedBy: "Leader", createdAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-01T00:00:00.000Z" }],
    recentEntriesTruncated: false };
  const service = createContextService({
    maxChars: 4000,
    sql: async () => [{ kind: "trip", id: "1", label: "Trip", trip_id: "1", trip_title: "Trip", slug: "trip", revision: 1, content: {} }],
    readSnapshot: async () => ({ ...snapshot, expenses, backbone: [{ ...snapshot.backbone[0], detail: "x".repeat(10000) }] }),
  });
  const item = await service.read(actor, trip);
  assert.equal(item.truncated, true);
  assert.equal(item.content.expenses.totalAmount, "300");
  assert.equal(item.content.schedule.truncated, true);
});
test("a no-context model turn can discover and read two trips with internal citations", async () => {
  const refs = [trip, { kind: "trip", id: "2" }];
  const contextService = { search: async () => ({ items: refs.map((ref) => ({ ref })) }), read: async (_actor, ref) => ({ ref, available: true, label: `Trip ${ref.id}`, href: `/?trip=trip-${ref.id}`, content: { title: `Trip ${ref.id}` } }) };
  const client = scriptedClient([
    (request) => { assert.doesNotMatch(request.input, /CURRENT TRIP SNAPSHOT/); return { steps: [call("search_context", {})] }; },
    { steps: refs.map((ref) => call("read_context", { ref }, ref.id)) },
    { output_text: "Comparison [E1] [E2]" },
  ]);
  const result = await createGeminiModelAdapter({ client }).run({ message: "Compare trips", actor, contextService });
  assert.equal(result.usedContext.length, 2); assert.equal(result.citations.length, 2); assert.ok(result.citations.every(safeEvidence));
  assert.equal(result.operations, null);
});
test("local assistant answers expense questions from the trip snapshot", async () => {
  const expenses = { currency: "JPY", totalAmount: "300", averageAmount: "150", participantCount: 2,
    members: [
      { displayName: "Leader", role: "leader", totalAmount: "300", differenceAmount: "150", comparison: "more" },
      { displayName: "Member", role: "member", totalAmount: "0", differenceAmount: "-150", comparison: "less" },
    ], activities: [], recentEntries: [], recentEntriesTruncated: false };
  const result = await createLocalModelAdapter().run({
    message: "Tổng chi tiêu của chuyến là bao nhiêu?",
    resolvedContext: [{ ref: trip, available: true }],
    contextService: { targetSnapshot: async () => ({ ...snapshot, expenses }) },
    actor,
  });
  assert.match(result.text, /tổng 300 JPY; trung bình 150 JPY/);
  assert.match(result.text, /Member: 0 JPY \(-150 so với trung bình\)/);
});
test("write tools cannot execute through the read tool runtime", async () => {
  await assert.rejects(executeTool("apply_changes", { operations: [] }, { evidence: [] }, {}), { code: "APPROVAL_REQUIRED" });
  await assert.rejects(executeTool("stage_plan_changes", {}, { evidence: [] }, {}), { code: "TOOL_NOT_ALLOWED" });
});
test("route departure has no implicit trip timezone and internal evidence rejects unsafe links", async () => {
  const result = await executeTool("compute_route", { origin: { address: "Tokyo" }, destination: { address: "Kyoto" }, departureTime: "2030-01-01T12:00:00" }, { evidence: [] }, { now: Date.now });
  assert.equal(result.error.code, "INVALID_INPUT");
  assert.equal(safeEvidence({ kind: "context", ref: trip, url: "//evil.example/" }), false);
  assert.equal(safeEvidence({ kind: "web", url: "/?trip=one" }), false);
});

test("a place reference read retains a valid external citation and pin identity", async () => {
  const ref = { kind: "place", id: "google:ChIJTokyo" }, state = { evidence: [] };
  const result = await executeTool("read_context", { ref }, state, { now: Date.now, actor, remainingChars: 24000,
    contextService: { read: async () => ({ ref, available: true, label: "Tokyo", href: "https://maps.google.com/?q=Tokyo", content: { name: "Tokyo" } }) } });
  assert.equal(result.evidenceId, "E1"); assert.deepEqual(state.evidence[0].ref, ref); assert.ok(safeEvidence(state.evidence[0]));
});
