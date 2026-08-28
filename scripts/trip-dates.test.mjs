import assert from "node:assert/strict";
import test from "node:test";
import {
  activityInstants,
  enumerateTripDays,
  validateActivityInterval,
  zonedDateTime,
} from "../lib/trip-dates.mjs";

test("enumerates every day in an inclusive trip range", () => {
  assert.deepEqual(enumerateTripDays("2030-01-30", "2030-02-02"), [
    "2030-01-30", "2030-01-31", "2030-02-01", "2030-02-02",
  ]);
});

test("accepts same-day and next-day activity intervals", () => {
  assert.equal(validateActivityInterval({ startDate: "2030-01-01", start: "09:00", endDate: "2030-01-01", end: "10:00" }), true);
  assert.equal(validateActivityInterval({ startDate: "2030-01-01", start: "23:30", endDate: "2030-01-02", end: "01:00" }), true);
});

test("rejects backwards same-day and multi-day activity intervals", () => {
  assert.throws(() => validateActivityInterval({ startDate: "2030-01-01", start: "10:00", endDate: "2030-01-01", end: "09:00" }));
  assert.throws(() => validateActivityInterval({ startDate: "2030-01-01", start: "09:00", endDate: "2030-01-03", end: "10:00" }));
});

test("rejects nonexistent DST wall times", () => {
  assert.throws(() => zonedDateTime("2030-03-10", "02:30", "America/New_York"), /does not exist/);
});

test("chooses the earlier instant for repeated DST wall times", () => {
  assert.equal(zonedDateTime("2030-11-03", "01:30", "America/New_York").toISOString(), "2030-11-03T05:30:00.000Z");
});

test("builds zoned instants for an overnight activity", () => {
  const result = activityInstants({ startDate: "2030-01-01", start: "23:30", endDate: "2030-01-02", end: "01:00" }, "Asia/Tokyo");
  assert.equal(result.endAt.getTime() - result.startAt.getTime(), 90 * 60 * 1000);
});
