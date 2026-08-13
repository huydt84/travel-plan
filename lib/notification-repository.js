import "server-only";

import { getSql } from "./db";
import {
  listNotificationRecords,
  markAllNotificationRecordsRead,
  markNotificationRecordRead,
} from "./notification-store.mjs";

export function listNotifications(input) {
  return listNotificationRecords(getSql(), input);
}

export function markNotificationRead(input) {
  return markNotificationRecordRead(getSql(), input);
}

export function markAllNotificationsRead(recipientEmail) {
  return markAllNotificationRecordsRead(getSql(), recipientEmail);
}
