import assert from "node:assert/strict";
import test from "node:test";
import { compilePlanProposal } from "../lib/v1/proposal.mjs";
import { resolveAgenticV1Config } from "../lib/v1/config.mjs";
import { validateSchema, turnBodySchema } from "../lib/v1/schemas.mjs";

const activity = (overrides = {}) => ({
  id: 1,
  key: "station-a",
  branchId: null,
  startDate: "2030-01-01",
  start: "09:00",
  endDate: "2030-01-01",
  end: "10:00",
  displayEnd: null,
  type: "Visit",
  icon: "pin",
  title: "Station A",
  detail: "Original detail",
  refs: [1],
  ...overrides,
});

const snapshot = (overrides = {}) => ({
  revision: 7,
  trip: { slug: "sample", title: "Sample", startDate: "2030-01-01", endDate: "2030-01-02", timezone: "Asia/Tokyo", location: "Tokyo" },
  sources: [{ number: 1, title: "Official", host: "example.com", url: "https://example.com/official" }],
  backbone: [activity(), activity({ id: 2, key: "station-b", start: "11:00", end: "12:00", title: "Station B" })],
  branchGroups: [],
  itinerary: [],
  ...overrides,
});

test("v1 remains disabled by default and uses a pinned model name", () => {
  const config = resolveAgenticV1Config({});
  assert.equal(config.enabled, false);
  assert.equal(config.geminiModel, "gemini-3.6-flash");
});

test("proposal compiler preserves stable keys and emits a complete before/after diff", () => {
  const compiled = compilePlanProposal(snapshot(), [{
    kind: "activity.update",
    itemKey: "station-a",
    set: { start: "09:15", end: "10:15", detail: "Updated detail" },
  }]);
  assert.deepEqual(compiled.operations, [{
    kind: "activity.update",
    itemKey: "station-a",
    set: { start: "09:15", end: "10:15", detail: "Updated detail" },
  }]);
  assert.equal(compiled.preview.changes[0].before.key, "station-a");
  assert.equal(compiled.preview.changes[0].after.key, "station-a");
  assert.equal(compiled.preview.changes[0].before.detail, "Original detail");
  assert.equal(compiled.preview.changes[0].after.detail, "Updated detail");
});

test("proposal compiler reserves deterministic keys and resolves draft sources", () => {
  const compiled = compilePlanProposal(snapshot(), [
    { kind: "source.add", draftId: "museum", title: "Museum official", url: "https://museum.example/visit" },
    {
      kind: "activity.add",
      draftId: "new-stop",
      lane: { kind: "backbone" },
      value: { startDate: "2030-01-01", start: "10:20", endDate: "2030-01-01", end: "10:50", type: "Visit", icon: "pin", title: "Station A", detail: "A new stop", refs: [{ draftId: "museum" }] },
    },
  ]);
  assert.equal(compiled.operations[0].kind, "source.add");
  assert.equal(compiled.operations[1].itemKey, "station-a-2");
  assert.deepEqual(compiled.operations[1].value.refs, [2]);
});

test("proposal compiler rejects overlaps, missing stable keys, and anchor deletion", () => {
  assert.throws(() => compilePlanProposal(snapshot(), [{
    kind: "activity.add", draftId: "overlap", lane: { kind: "backbone" },
    value: { startDate: "2030-01-01", start: "09:30", endDate: "2030-01-01", end: "09:45", type: "Visit", icon: "pin", title: "Overlap", detail: "Unsafe" },
  }]), /overlap|overlaps|chồng|starts before/i);
  assert.throws(() => compilePlanProposal(snapshot(), [{ kind: "activity.remove", itemKey: "missing" }]), /Không tìm thấy/);

  const anchored = snapshot({ branchGroups: [{ id: "g1", key: "fork", anchorActivityId: 1, selectedBranchId: null, branches: [] }] });
  assert.throws(() => compilePlanProposal(anchored, [{ kind: "activity.remove", itemKey: "station-a" }]), /neo/);
});

test("turn transport schema refuses browser-supplied identity and malformed idempotency keys", () => {
  assert.throws(() => validateSchema(turnBodySchema, {
    clientTurnId: "not-a-uuid", message: "Hello", actor: { email: "attacker@example.com", isAdmin: true },
  }), /không hợp lệ/);
  assert.doesNotThrow(() => validateSchema(turnBodySchema, {
    clientTurnId: "d8f32e14-9229-4f08-bf35-153880228757", message: "Hello",
  }));
  assert.doesNotThrow(() => validateSchema(turnBodySchema, {
    clientTurnId: "d8f32e14-9229-4f08-bf35-153880228757", message: "Hello", allowedTools: [],
  }));
  assert.throws(() => validateSchema(turnBodySchema, {
    clientTurnId: "d8f32e14-9229-4f08-bf35-153880228757", message: "Hello", allowedTools: ["search_web", "search_web"],
  }), /không hợp lệ/);
  assert.throws(() => validateSchema(turnBodySchema, {
    clientTurnId: "d8f32e14-9229-4f08-bf35-153880228757", message: "Hello", allowedTools: ["unknown"],
  }), /không hợp lệ/);
});
