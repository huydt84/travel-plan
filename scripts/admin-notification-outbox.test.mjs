import assert from "node:assert/strict";
import test from "node:test";
import { nextAdminNotificationRetryAt } from "../lib/admin-notification-outbox-store.mjs";

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
