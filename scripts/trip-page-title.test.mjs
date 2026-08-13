import test from "node:test";
import assert from "node:assert/strict";
import { getTripPageTitle } from "../lib/trip-page-title.mjs";

const tripTitle = "Tokyo, 12/08/2026";
const activityTitle = "Shibuya Crossing";

test("uses the trip title as a fallback when no live state exists", () => {
  assert.equal(getTripPageTitle({ tripTitle }), `Lịch trình chuyến đi · ${tripTitle}`);
});

test("describes the activity before the trip starts", () => {
  assert.equal(
    getTripPageTitle({ mode: "before", tripTitle, activityTitle }),
    `Sắp bắt đầu · ${activityTitle} · ${tripTitle}`,
  );
});

test("describes the activity currently in progress", () => {
  assert.equal(
    getTripPageTitle({ mode: "active", tripTitle, activityTitle }),
    `Đang diễn ra · ${activityTitle} · ${tripTitle}`,
  );
});

test("describes the wait between activities", () => {
  assert.equal(
    getTripPageTitle({ mode: "gap", tripTitle, activityTitle }),
    `Đang chờ · ${activityTitle} · ${tripTitle}`,
  );
});

test("describes the completed trip without repeating the last activity", () => {
  assert.equal(
    getTripPageTitle({ mode: "after", tripTitle, activityTitle }),
    `Đã kết thúc · ${tripTitle}`,
  );
});
