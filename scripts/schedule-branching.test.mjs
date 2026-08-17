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
