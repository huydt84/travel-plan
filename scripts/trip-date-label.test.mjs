import assert from "node:assert/strict";
import test from "node:test";
import { formatScheduleHeading, formatTripTitle } from "../lib/trip-date-label.mjs";

const timezone = "Asia/Tokyo";

test("changes a legacy 'hôm nay' trip title to 'hôm qua' after midnight", () => {
  const now = new Date("2030-01-16T14:42:15Z");

  assert.equal(formatTripTitle("Chuyến đi, hôm nay", "2030-01-15", timezone, now), "Chuyến đi, hôm qua");
  assert.equal(formatScheduleHeading("2030-01-15", timezone, now), "Lịch hôm qua");
});

test("keeps relative labels correct around Tokyo midnight", () => {
  const beforeMidnight = new Date("2030-01-15T14:59:59Z");
  const afterMidnight = new Date("2030-01-15T15:00:00Z");

  assert.equal(formatTripTitle("Chuyến đi, hôm nay", "2030-01-15", timezone, beforeMidnight), "Chuyến đi, hôm nay");
  assert.equal(formatTripTitle("Chuyến đi, hôm nay", "2030-01-15", timezone, afterMidnight), "Chuyến đi, hôm qua");
});

test("does not rewrite titles without a relative-day suffix", () => {
  const now = new Date("2030-01-16T14:42:15Z");

  assert.equal(
    formatTripTitle("Sample day trip", "2030-01-20", timezone, now),
    "Sample day trip",
  );
  assert.equal(formatScheduleHeading("2030-01-20", timezone, now), "Lịch ngày 20/01/2030");
});
