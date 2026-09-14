import test from "node:test";
import assert from "node:assert/strict";
import { compileBatch } from "../lib/v1/batch-proposal.mjs";
import { snapshot, activity } from "./assistant-fixtures.mjs";
const trip = { ...snapshot.trip, slug: "batch" };
const create = (kind, draftId, value, tripRef = { draftId: "trip" }) => ({ kind: `${kind}.create`, draftId, ...(kind === "trip" ? {} : { trip: tripRef }), value });
const a = Object.fromEntries(Object.entries(activity).filter(([k]) => !["id", "key", "branchId", "refs"].includes(k)));

test("mixed batch resolves forward references and previews all create fields without mutating input", () => {
  const args = { operations: [create("activity", "visit", { ...a, sources: [{ draftId: "source" }], place: { draftId: "place" } }), create("place", "place", { name: "Museum", address: "Tokyo" }), create("source", "source", { title: "Official", url: "https://example.com/" }), create("trip", "trip", trip)] };
  const before = JSON.stringify(args);
  const result = compileBatch(args, [], [{ url: "https://example.com/" }]);
  assert.deepEqual(result.operations.map((o) => o.kind), ["trip.create", "place.create", "source.create", "activity.create"]);
  assert.deepEqual(result.operations.at(-1).value.sources, [{ draftId: "source" }]);
  assert.equal(result.preview.changes.at(-1).after.place, "Museum");
  assert.equal(JSON.stringify(args), before);
});
test("explicit multiple targets and coordinated final dates preserve activity keys", () => {
  const second = { ...structuredClone(snapshot), tripId: "2", backbone: [{ ...activity, id: "2" }], trip: { ...trip, slug: "second" } };
  const result = compileBatch({ operations: [
    { kind: "trip.update", target: { id: "1" }, set: { startDate: "2030-01-02", endDate: "2030-01-02" } },
    { kind: "activity.update", trip: { id: "1" }, target: { id: "1" }, set: { startDate: "2030-01-02", endDate: "2030-01-02" } },
    { kind: "trip.update", target: { id: "2" }, set: { title: "Second updated" } },
  ] }, [snapshot, second]);
  assert.equal(result.preview.groups.length, 2); assert.equal(result.operations[1].value.key, activity.key);
  assert.deepEqual(result.revisions, { 1: 1, 2: 1 });
});
test("revision recompilation keeps server-reserved activity keys when titles change", () => {
  const args = { operations: [create("trip", "trip", trip), create("activity", "visit", { ...a, title: "Original title" })] };
  const original = compileBatch(args, []);
  const key = original.operations.find((op) => op.kind === "activity.create").value.key;
  args.operations[1].value.title = "New title";
  const revised = compileBatch(args, [], [], { activityKeys: { "activity:draft:visit": key } });
  assert.equal(revised.operations[1].value.key, key);
  assert.equal(revised.operations[1].value.title, "New title");
  const collision = { operations: [create("activity", "visit", a, { id: "1" })] };
  assert.throws(() => compileBatch(collision, [snapshot], [], { activityKeys: { "activity:draft:visit": activity.key } }), { code: "BATCH_INVALID" });
});
test("missing, circular, wrong-kind, and cross-trip references fail closed", () => {
  for (const args of [
    { operations: [create("place", "place", { name: "Museum", address: "Tokyo" })] },
    { operations: [create("activity", "loop", { ...a, place: { draftId: "loop" } }), create("trip", "trip", trip)] },
    { operations: [create("trip", "trip", trip), create("activity", "visit", { ...a, place: { draftId: "trip" } })] },
    { operations: [create("trip", "trip", trip), create("place", "p", { name: "Museum", address: "Tokyo" }, { id: "1" }), create("activity", "visit", { ...a, place: { draftId: "p" } })] },
  ]) assert.throws(() => compileBatch(args, [snapshot]), { code: "BATCH_INVALID" });
});
test("unsupported operations, duplicate targets, source provenance, overlaps and oversized batches are rejected", () => {
  assert.throws(() => compileBatch({ operations: [{ kind: "trip.delete", target: { id: "1" } }] }, [snapshot]));
  const update = { kind: "trip.update", target: { id: "1" }, set: { title: "New" } };
  assert.throws(() => compileBatch({ operations: [update, update] }, [snapshot]));
  assert.throws(() => compileBatch({ operations: [create("source", "s", { title: "Unknown", url: "https://example.com/unverified" }, { id: "1" })] }, [snapshot]));
  assert.throws(() => compileBatch({ operations: [create("activity", "overlap", a, { id: "1" })] }, [snapshot]));
  assert.throws(() => compileBatch({ operations: Array.from({ length: 25 }, (_, i) => create("trip", `t${i}`, { ...trip, slug: `trip-${i}` })) }, []));
});

test("source provenance matches the exact trimmed URL and records only used evidence", () => {
  const source = (url) => ({ operations: [create("source", "source", { title: "Verified", url }, { id: "1" })] });
  const verifiedUrl = "https://example.com/guide?lang=vi";
  const compiled = compileBatch(source(`  ${verifiedUrl}  `), [snapshot], [
    { id: "E1", url: "https://example.com/unused" },
    { id: "E2", url: verifiedUrl },
  ]);
  assert.equal(compiled.operations[0].value.url, verifiedUrl);
  assert.deepEqual(compiled.evidenceRefs, ["E2"]);
  for (const url of [
    "https://example.com/guide",
    "https://example.com/guide?lang=en",
    "https://example.com/guide?lang=vi#details",
  ]) assert.throws(() => compileBatch(source(url), [snapshot], [{ id: "E2", url: verifiedUrl }]), /tra cứu URL nguồn/);
  assert.throws(() => compileBatch(source("javascript:alert(1)"), [snapshot], [{ id: "E2", url: verifiedUrl }]), /http hoặc https/);
});
