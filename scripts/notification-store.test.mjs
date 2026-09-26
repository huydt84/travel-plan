import assert from "node:assert/strict";
import test from "node:test";
import { parseNotificationCursor, parseNotificationLimit } from "../lib/notification-store.mjs";

test("cursor and limit validation use bounded defaults", () => {
  assert.equal(parseNotificationLimit(null), 30);
  assert.equal(parseNotificationLimit("500"), 50);
  assert.throws(() => parseNotificationCursor("not-a-cursor"), { code: "NOTIFICATION_CURSOR_INVALID" });
});
