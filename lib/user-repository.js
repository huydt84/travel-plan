import "server-only";

import { getSql } from "./db";
import { listUserActivity, upsertUserActivity, upsertUserLogin } from "./user-login-store.mjs";

export function recordUserLogin(input) {
  return upsertUserLogin(getSql(), input);
}

export function recordUserActivity(input) {
  return upsertUserActivity(getSql(), input);
}

export function listUsers() {
  return listUserActivity(getSql());
}
