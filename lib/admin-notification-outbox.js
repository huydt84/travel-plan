import "server-only";

import { getSql } from "./db";
import {
  claimAdminNotificationOutboxRecords,
  processAdminNotificationOutboxRecords,
} from "./admin-notification-outbox-store.mjs";

export async function claimAdminNotificationOutbox(
  options = {},
  sql = getSql(),
) {
  return claimAdminNotificationOutboxRecords(sql, options);
}

export async function processAdminNotificationOutbox(
  options = {},
  dependencies = {},
) {
  const sql = dependencies.sql || getSql();
  return processAdminNotificationOutboxRecords(sql, options, dependencies);
}
