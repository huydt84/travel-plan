import assert from "node:assert/strict";
import test from "node:test";
import {
  listNotificationRecords,
  markAllNotificationRecordsRead,
  markNotificationRecordRead,
  parseNotificationCursor,
  parseNotificationLimit,
} from "../lib/notification-store.mjs";

const row = {
  id: 8,
  event_type: "contribution_created",
  actor_name: "Bạn B",
  actor_image: null,
  trip_slug: "tokyo-day",
  trip_title: "Tokyo Day",
  suggestion_id: 15,
  kind: "comment",
  body: "Hẹn ở cửa Bắc",
  status_value: null,
  current_status: "open",
  activity_id: 3,
  activity_title: "Ga Tokyo",
  created_at: "2026-08-13T02:00:00.000Z",
  read_at: null,
};

const queuedSql = (...responses) => {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return responses.shift();
  };
  sql.calls = calls;
  return sql;
};

test("notification list is private, paginated, and does not expose actor email", async () => {
  const sql = queuedSql([row, { ...row, id: 7 }], [{ count: 2 }]);
  const result = await listNotificationRecords(sql, {
    recipientEmail: "FRIEND@example.com",
    limit: 1,
  });
  assert.equal(result.notifications.length, 1);
  assert.equal(result.unreadCount, 2);
  assert.ok(result.nextCursor);
  assert.deepEqual(result.notifications[0].actor, { name: "Bạn B", image: null });
  assert.equal(result.notifications[0].targetUrl, "/?trip=tokyo-day#contribution-15");
  assert.equal("email" in result.notifications[0].actor, false);
  assert.ok(sql.calls[0].values.includes("friend@example.com"));
  assert.deepEqual(parseNotificationCursor(result.nextCursor), { createdAt: row.created_at, id: "8" });
});

test("cursor and limit validation use bounded defaults", () => {
  assert.equal(parseNotificationLimit(null), 30);
  assert.equal(parseNotificationLimit("500"), 50);
  assert.throws(() => parseNotificationCursor("not-a-cursor"), { code: "NOTIFICATION_CURSOR_INVALID" });
});

test("request fulfillment notifications map to a plan link without a contribution payload", async () => {
  const requestRow = {
    ...row,
    id: 9,
    event_type: "trip_request_fulfilled",
    suggestion_id: null,
    trip_request_id: 21,
    request_start_date: "2026-10-10",
    request_end_date: "2026-10-12",
    request_places: ["Kamakura", "Enoshima"],
  };
  const sql = queuedSql([requestRow], [{ count: 1 }]);
  const result = await listNotificationRecords(sql, { recipientEmail: "friend@example.com", limit: 30 });
  assert.equal(result.notifications[0].targetUrl, "/?trip=tokyo-day");
  assert.equal(result.notifications[0].contribution, null);
  assert.deepEqual(result.notifications[0].request, {
    id: "21",
    startDate: "2026-10-10",
    endDate: "2026-10-12",
    places: ["Kamakura", "Enoshima"],
  });
});

test("mark read scopes the update to its recipient and is idempotent", async () => {
  const sql = queuedSql([{ id: 8, read_at: "2026-08-13T03:00:00.000Z" }], [{ count: 1 }]);
  const result = await markNotificationRecordRead(sql, {
    notificationId: "8",
    recipientEmail: "Friend@Example.com",
  });
  assert.equal(result.readAt, "2026-08-13T03:00:00.000Z");
  assert.equal(result.unreadCount, 1);
  assert.ok(sql.calls[0].values.includes("friend@example.com"));
});

test("mark read does not reveal notifications owned by someone else", async () => {
  const sql = queuedSql([]);
  await assert.rejects(
    () => markNotificationRecordRead(sql, { notificationId: "8", recipientEmail: "other@example.com" }),
    { code: "NOTIFICATION_NOT_FOUND" },
  );
});

test("mark all reports exactly how many unread records changed", async () => {
  const sql = queuedSql([{ id: 1 }, { id: 2 }]);
  assert.deepEqual(await markAllNotificationRecordsRead(sql, "friend@example.com"), { updated: 2, unreadCount: 0 });
});
