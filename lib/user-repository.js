import "server-only";

import { getSql } from "./db";
import { listUserLogins, upsertUserLogin } from "./user-login-store.mjs";

export function recordUserLogin(input) {
  return upsertUserLogin(getSql(), input);
}

export function listUsers() {
  return listUserLogins(getSql());
}
