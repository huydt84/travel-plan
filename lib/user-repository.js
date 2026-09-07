import "server-only";

import { getSql } from "./db";
import {
  listUserActivity,
  resolveStoredUser,
  resolveStoredUserRole,
  updateStoredUserDisplayName,
  updateStoredUserRole,
  upsertUserActivity,
  upsertUserLogin,
} from "./user-login-store.mjs";

export function recordUserLogin(input) {
  return upsertUserLogin(getSql(), input);
}

export function recordUserActivity(input) {
  return upsertUserActivity(getSql(), input);
}

export function resolveUserRole(email) {
  return resolveStoredUserRole(getSql(), email);
}

export function getStoredUser(email) {
  return resolveStoredUser(getSql(), email);
}

export function updateUserDisplayName(input) {
  return updateStoredUserDisplayName(getSql(), input);
}

export function updateUserRole(input) {
  return updateStoredUserRole(getSql(), input);
}

export function listUsers(options) {
  return listUserActivity(getSql(), options);
}
