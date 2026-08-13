import assert from "node:assert/strict";
import test from "node:test";
import {
  nextAdminNotificationRetryAt,
  processAdminNotificationOutboxRecords,
} from "../lib/admin-notification-outbox-store.mjs";

const outboxRow = (attemptCount) => ({
  outbox_id: "41",
  attempt_count: attemptCount,
  suggestion_id: "19",
  recipient_email: "owner@example.com",
  kind: "comment",
  body: "Một cập nhật",
  author_name: "Contributor",
  trip_slug: "tokyo",
  trip_title: "Tokyo",
  activity_title: "Ga Tokyo",
});

const scriptedSql = (attemptCount) => {
  const mutations = [];
  const sql = async (strings, ...values) => {
    const query = strings.join("?").replaceAll(/\s+/g, " ").trim();
    if (query.includes("UPDATE admin_notification_outbox AS outbox")) {
      return [{ id: "41", suggestion_id: "19", attempt_count: attemptCount }];
    }
    if (query.includes("outbox.id AS outbox_id")) return [outboxRow(attemptCount)];
    mutations.push({ query, values });
    return [];
  };
  return { sql, mutations };
};

test("provider failures retry at the next daily cron boundary", () => {
  assert.equal(
    nextAdminNotificationRetryAt(new Date("2026-08-13T00:16:30.000Z")).toISOString(),
    "2026-08-13T00:17:00.000Z",
  );
  assert.equal(
    nextAdminNotificationRetryAt(new Date("2026-08-13T00:17:00.000Z")).toISOString(),
    "2026-08-14T00:17:00.000Z",
  );
  assert.equal(
    nextAdminNotificationRetryAt(new Date("2026-08-13T12:00:00.000Z")).toISOString(),
    "2026-08-14T00:17:00.000Z",
  );
});

for (const [attemptCount, expectedStatus] of [[4, "pending"], [5, "failed"]]) {
  test(`provider failure on attempt ${attemptCount} records ${expectedStatus}`, async () => {
    const { sql, mutations } = scriptedSql(attemptCount);
    const deliveryError = Object.assign(new Error("provider unavailable"), { code: "RESEND_HTTP_503" });
    const deliveries = await processAdminNotificationOutboxRecords(sql, {}, {
      sendImpl: async () => { throw deliveryError; },
      logger: { error() {} },
    });

    assert.deepEqual(deliveries, [{ outboxId: "41", status: "failed", errorCode: "RESEND_HTTP_503" }]);
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0].values[0], expectedStatus);
    assert.equal(mutations[0].values[1], "RESEND_HTTP_503");
    assert.ok(mutations[0].values[2] instanceof Date);
    assert.equal(mutations[0].values[2].getUTCHours(), 0);
    assert.equal(mutations[0].values[2].getUTCMinutes(), 17);
  });
}

test("successful delivery stores the Resend message id", async () => {
  const { sql, mutations } = scriptedSql(1);
  const deliveries = await processAdminNotificationOutboxRecords(sql, {}, {
    sendImpl: async () => "resend-message-1",
    logger: { error() {} },
  });

  assert.deepEqual(deliveries, [{ outboxId: "41", status: "sent", resendMessageId: "resend-message-1" }]);
  assert.equal(mutations.length, 1);
  assert.match(mutations[0].query, /status = 'sent'/);
  assert.equal(mutations[0].values[0], "resend-message-1");
});
