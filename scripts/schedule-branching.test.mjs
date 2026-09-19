import assert from "node:assert/strict";
import test from "node:test";
import { resolveActiveItinerary, validateBranchTimeline } from "../lib/schedule-branching.mjs";
import { normalizeTripImport } from "./trip-import-utils.mjs";

const activity = (id, start, end) => ({ id, title: id, start, end, refs: [] });

test("resolves only the selected branch into the active itinerary", () => {
  const backbone = [activity("anchor", "09:00", "10:00"), activity("rejoin", "12:00", "13:00")];
  const groups = [{
    id: "g1",
    anchorActivityId: "anchor",
    selectedBranchId: "rain",
    branches: [
      { id: "dry", label: "Không mưa", isDefault: true, itinerary: [activity("walk", "10:15", "11:30")] },
      { id: "rain", label: "Có mưa", isDefault: false, itinerary: [activity("museum", "10:15", "11:30")] },
    ],
  }];

  assert.deepEqual(resolveActiveItinerary(backbone, groups).map((item) => item.id), ["anchor", "museum", "rejoin"]);
});

test("supports an empty skip branch and falls back to the default", () => {
  const backbone = [activity("anchor", "09:00", "10:00"), activity("rejoin", "12:00", "13:00")];
  const groups = [{
    id: "g1",
    anchorActivityId: "anchor",
    selectedBranchId: null,
    branches: [
      { id: "default", label: "Đi tiếp", isDefault: true, itinerary: [activity("visit", "10:15", "11:30")] },
      { id: "skip", label: "Bỏ qua", isDefault: false, itinerary: [] },
    ],
  }];

  assert.deepEqual(resolveActiveItinerary(backbone, groups).map((item) => item.id), ["anchor", "visit", "rejoin"]);
  groups[0].selectedBranchId = "skip";
  assert.deepEqual(resolveActiveItinerary(backbone, groups).map((item) => item.id), ["anchor", "rejoin"]);
});

test("resolves a selected branch before the first shared activity", () => {
  const backbone = [activity("rejoin", "10:30", "11:30")];
  const groups = [{
    id: "start",
    anchorActivityId: null,
    selectedBranchId: "rain",
    branches: [
      { id: "dry", label: "Không mưa", isDefault: true, itinerary: [activity("park", "09:00", "10:00")] },
      { id: "rain", label: "Có mưa", isDefault: false, itinerary: [activity("museum", "09:15", "10:00")] },
    ],
  }];

  assert.deepEqual(resolveActiveItinerary(backbone, groups).map((item) => item.id), ["museum", "rejoin"]);
  assert.equal(resolveActiveItinerary(backbone, groups)[0].branchGroupId, "start");
});

test("validates a trip-start branch against its first shared rejoin activity", () => {
  const rejoin = activity("rejoin", "10:30", "11:30");
  assert.doesNotThrow(() => validateBranchTimeline({ anchor: null, rejoin, itinerary: [activity("first", "09:00", "10:00")] }));
  assert.throws(() => validateBranchTimeline({ anchor: null, rejoin, itinerary: [activity("late", "10:00", "11:00")] }));
});

test("rejects branch overlaps and activities after the rejoin boundary", () => {
  const anchor = activity("anchor", "09:00", "10:00");
  const rejoin = activity("rejoin", "12:00", "13:00");
  assert.throws(() => validateBranchTimeline({ anchor, rejoin, itinerary: [activity("early", "09:30", "10:30")] }));
  assert.throws(() => validateBranchTimeline({ anchor, rejoin, itinerary: [activity("late", "11:00", "12:30")] }));
});

test("normalizes stable keys for nested branch imports and rejects nested forks", () => {
  const base = {
    trip: { slug: "sample", title: "Sample", date: "2030-01-01", timezone: "Asia/Tokyo", location: "Tokyo" },
    sources: [],
    schedule: [
      {
        start: "09:00", end: "10:00", type: "Visit", icon: "x", title: "Anchor", detail: "Anchor", refs: [],
        branchGroup: {
          title: "Weather", defaultBranchKey: "dry", branches: [
            { key: "dry", label: "Dry", condition: "No rain", schedule: [{ start: "10:15", end: "11:00", type: "Walk", icon: "x", title: "Walk", detail: "Walk", refs: [] }] },
            { key: "rain", label: "Rain", condition: "Rain", schedule: [] },
          ],
        },
      },
      { start: "12:00", end: "13:00", type: "Meet", icon: "x", title: "Rejoin", detail: "Rejoin", refs: [] },
    ],
  };
  const normalized = normalizeTripImport(base);
  assert.equal(normalized.schedule[0].key, "anchor");
  assert.equal(normalized.schedule[0].branchGroup.key, "weather");
  assert.equal(normalized.schedule[0].branchGroup.branches[0].schedule[0].key, "walk");

  base.schedule[0].branchGroup.branches[0].schedule[0].branchGroup = {};
  assert.throws(() => normalizeTripImport(base), /cannot be nested/);
});

test("trip imports accept route links without silently reclassifying older links", () => {
  const base = {
    trip: { slug: "route-import", title: "Route import", date: "2030-01-01", location: "Tokyo" },
    sources: [
      { number: 1, title: "Directions", url: "https://maps.example/dir", kind: "route" },
      { number: 2, title: "Official site", url: "https://example.com" },
    ],
    schedule: [{ start: "09:00", end: "10:00", type: "Travel", icon: "🚆", title: "Train", detail: "Train ride", refs: [1] }],
  };
  assert.deepEqual(normalizeTripImport(base).sources.map((source) => source.kind), ["route", null]);
  base.sources[0].kind = "place";
  assert.throws(() => normalizeTripImport(base), /kind must be reference or route/);
});

test("normalizes a trip-start branch group before the shared schedule", () => {
  const normalized = normalizeTripImport({
    trip: { slug: "start-fork", title: "Start fork", date: "2030-01-01", timezone: "Asia/Tokyo", location: "Tokyo" },
    sources: [],
    startBranchGroup: {
      key: "weather-start",
      title: "Weather from departure",
      defaultBranchKey: "dry",
      branches: [
        { key: "dry", label: "Dry", condition: "No rain", schedule: [{ start: "09:00", end: "10:00", type: "Walk", icon: "x", title: "Park", detail: "Park", refs: [] }] },
        { key: "rain", label: "Rain", condition: "Rain", schedule: [{ start: "09:00", end: "10:00", type: "Indoor", icon: "x", title: "Museum", detail: "Museum", refs: [] }] },
      ],
    },
    schedule: [{ start: "10:30", end: "11:00", type: "Meet", icon: "x", title: "Rejoin", detail: "Rejoin", refs: [] }],
  });

  assert.equal(normalized.startBranchGroup.key, "weather-start");
  assert.equal(normalized.startBranchGroup.branches[1].schedule[0].key, "museum");
  assert.equal(normalized.schedule[0].key, "rejoin");
});
