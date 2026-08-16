import assert from "node:assert/strict";
import test from "node:test";
import { getTripTrackerState } from "../lib/trip-tracker-state.mjs";

const itinerary = [
  {
    id: "first",
    startAt: new Date("2030-01-01T09:00:00+09:00"),
    endAt: new Date("2030-01-01T10:00:00+09:00"),
  },
  {
    id: "last",
    startAt: new Date("2030-01-01T10:30:00+09:00"),
    endAt: new Date("2030-01-01T11:00:00+09:00"),
  },
];

test("anchors the board to the first activity before the trip", () => {
  const state = getTripTrackerState(new Date("2030-01-01T08:59:59+09:00"), itinerary);

  assert.equal(state.mode, "before");
  assert.equal(state.current, itinerary[0]);
  assert.equal(state.anchor, itinerary[0]);
});

test("keeps the active activity as both current and anchor", () => {
  const state = getTripTrackerState(new Date("2030-01-01T09:30:00+09:00"), itinerary);

  assert.equal(state.mode, "active");
  assert.equal(state.current, itinerary[0]);
  assert.equal(state.anchor, itinerary[0]);
});

test("uses the upcoming activity as the board anchor during a gap", () => {
  const state = getTripTrackerState(new Date("2030-01-01T10:15:00+09:00"), itinerary);

  assert.equal(state.mode, "gap");
  assert.equal(state.current, itinerary[1]);
  assert.equal(state.anchor, itinerary[1]);
});

test("ends the trip at the exact final boundary without treating the last activity as current", () => {
  const state = getTripTrackerState(new Date("2030-01-01T11:00:00+09:00"), itinerary);

  assert.equal(state.mode, "after");
  assert.equal(state.current, null);
  assert.equal(state.anchor, itinerary[1]);
  assert.equal(state.index, itinerary.length);
  assert.equal(state.next, null);
});

test("keeps the final activity only as the terminus after the trip", () => {
  const state = getTripTrackerState(new Date("2030-01-01T11:00:01+09:00"), itinerary);

  assert.equal(state.mode, "after");
  assert.equal(state.current, null);
  assert.equal(state.anchor, itinerary[1]);
});
