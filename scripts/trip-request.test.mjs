import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAdminTripRequestMutation,
  parseTripRequestFulfillment,
  parseTripRequestInput,
  parseTripRequestMutation,
  ValidationError,
} from "../lib/validation.js";

const validRequest = {
  startDate: "2026-10-10",
  endDate: "2026-10-12",
  places: [" Kamakura ", "Enoshima"],
  sources: [{ label: " Official guide ", url: "https://example.com/guide" }],
  notes: "Có thể đổi giờ khởi hành.",
};

test("trip request input accepts ordered places, multi-day dates, and optional sources", () => {
  assert.deepEqual(parseTripRequestInput(validRequest), {
    startDate: "2026-10-10",
    endDate: "2026-10-12",
    places: ["Kamakura", "Enoshima"],
    sources: [{ label: "Official guide", url: "https://example.com/guide" }],
    notes: "Có thể đổi giờ khởi hành.",
  });
  assert.equal(parseTripRequestInput({ ...validRequest, endDate: validRequest.startDate, sources: [], notes: "" }).endDate, "2026-10-10");
});

test("trip request validation rejects inverted dates, empty places, and unsafe URLs", () => {
  assert.throws(() => parseTripRequestInput({ ...validRequest, endDate: "2026-10-09" }), ValidationError);
  assert.throws(() => parseTripRequestInput({ ...validRequest, places: [] }), ValidationError);
  assert.throws(() => parseTripRequestInput({ ...validRequest, sources: [{ url: "javascript:alert(1)" }] }), ValidationError);
  assert.throws(() => parseTripRequestInput({ ...validRequest, places: Array.from({ length: 13 }, (_, index) => `Place ${index}`) }), ValidationError);
});

test("member and admin request mutations expose only explicit lifecycle actions", () => {
  assert.deepEqual(parseTripRequestMutation({ action: "withdraw" }), { action: "withdraw" });
  assert.deepEqual(parseTripRequestMutation({ action: "restore" }), { action: "restore" });
  assert.equal(parseTripRequestMutation({ action: "update", request: validRequest }).action, "update");
  assert.deepEqual(parseAdminTripRequestMutation({ action: "decline", reason: " Trùng lịch " }), { action: "decline", reason: "Trùng lịch" });
  assert.deepEqual(parseAdminTripRequestMutation({ action: "restore" }), { action: "restore", reason: "" });
  assert.deepEqual(parseTripRequestFulfillment({ tripSlug: "kamakura-day" }), { tripSlug: "kamakura-day" });
  assert.throws(() => parseTripRequestMutation({ action: "delete" }), ValidationError);
  assert.throws(() => parseAdminTripRequestMutation({ action: "fulfill" }), ValidationError);
});
