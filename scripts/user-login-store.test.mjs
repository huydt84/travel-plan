import assert from "node:assert/strict";
import test from "node:test";
import { USER_ACTIVITY_WRITE_INTERVAL_MS } from "../lib/user-activity.mjs";
import {
  listUserActivity,
  normalizeLoginIdentity,
  resolveStoredUserRole,
  updateStoredUserRole,
  upsertUserActivity,
  upsertUserLogin,
} from "../lib/user-login-store.mjs";

const sqlMock = (rows) => {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return rows;
  };
  return { calls, sql };
};

test("normalizes verified Google identities", () => {
  assert.deepEqual(normalizeLoginIdentity({ name: "  Hoang Ngoc ", email: " FRIEND@Example.com " }), {
    name: "Hoang Ngoc",
    email: "friend@example.com",
  });
  assert.deepEqual(normalizeLoginIdentity({ email: "person@example.com" }), {
    name: "person",
    email: "person@example.com",
  });
  assert.throws(() => normalizeLoginIdentity({}), /verified email is required/);
});

test("upserts only the latest login while preserving the first login", async () => {
  const loginTime = new Date("2026-08-11T09:30:00.000Z");
  const { calls, sql } = sqlMock([{
    name: "Hoang Ngoc",
    email: "friend@example.com",
    role: "member",
    first_login: loginTime,
    last_login: loginTime,
    last_active_at: loginTime,
  }]);

  assert.deepEqual(await upsertUserLogin(sql, {
    name: "Hoang Ngoc",
    email: "FRIEND@example.com",
  }, loginTime), {
    name: "Hoang Ngoc",
    email: "friend@example.com",
    role: "member",
    first_login: loginTime.toISOString(),
    last_login: loginTime.toISOString(),
    last_active_at: loginTime.toISOString(),
  });

  assert.match(calls[0].text, /ON CONFLICT \(email\) DO UPDATE SET/);
  assert.doesNotMatch(calls[0].text, /first_login\s*=/);
  assert.deepEqual(calls[0].values, [
    "Hoang Ngoc",
    "friend@example.com",
    loginTime.toISOString(),
    loginTime.toISOString(),
    loginTime.toISOString(),
  ]);
});

test("upserts activity without changing login timestamps and throttles writes for five minutes", async () => {
  const activityTime = new Date("2026-08-11T10:00:00.000Z");
  const { calls, sql } = sqlMock([{
    name: "Hoang Ngoc",
    email: "friend@example.com",
    first_login: "2026-08-11T09:00:00.000Z",
    last_login: "2026-08-11T09:30:00.000Z",
    last_active_at: activityTime,
  }]);

  const result = await upsertUserActivity(sql, {
    name: "Hoang Ngoc",
    email: "friend@example.com",
  }, activityTime);

  assert.equal(result.last_active_at, activityTime.toISOString());
  assert.match(calls[0].text, /last_active_at = EXCLUDED\.last_active_at/);
  assert.match(calls[0].text, /INTERVAL '1 millisecond'/);
  assert.doesNotMatch(calls[0].text, /DO UPDATE SET[\s\S]*last_login\s*=/);
  assert.deepEqual(calls[0].values, [
    "Hoang Ngoc",
    "friend@example.com",
    activityTime.toISOString(),
    activityTime.toISOString(),
    activityTime.toISOString(),
    USER_ACTIVITY_WRITE_INTERVAL_MS,
  ]);
});

test("returns null when activity falls inside the database throttle window", async () => {
  const { sql } = sqlMock([]);
  assert.equal(await upsertUserActivity(sql, {
    name: "Hoang Ngoc",
    email: "friend@example.com",
  }, new Date("2026-08-11T10:04:59.000Z")), null);
});

test("serializes and sorts activity timestamps for the admin client", async () => {
  const { sql } = sqlMock([{
    name: "Owner",
    email: "owner@example.com",
    role: "member",
    role: "member",
    first_login: "2026-08-10T01:00:00.000Z",
    last_login: new Date("2026-08-11T02:00:00.000Z"),
    last_active_at: new Date("2026-08-15T00:00:00.000Z"),
  }]);

  assert.deepEqual(await listUserActivity(sql), [{
    name: "Owner",
    email: "owner@example.com",
    role: "member",
    first_login: "2026-08-10T01:00:00.000Z",
    last_login: "2026-08-11T02:00:00.000Z",
    last_active_at: "2026-08-15T00:00:00.000Z",
  }]);
});

test("resolves, updates, and protects stored roles", async () => {
  const roleLookup = sqlMock([{ role: "admin" }]);
  assert.equal(await resolveStoredUserRole(roleLookup.sql, " ADMIN@example.com "), "admin");
  assert.deepEqual(roleLookup.calls[0].values, ["admin@example.com"]);

  const changedAt = "2026-08-16T01:00:00.000Z";
  const roleUpdate = sqlMock([{
    name: "Friend",
    email: "friend@example.com",
    role: "admin",
    first_login: changedAt,
    last_login: changedAt,
    last_active_at: changedAt,
  }]);
  const updated = await updateStoredUserRole(roleUpdate.sql, {
    email: "friend@example.com",
    role: "admin",
    ownerEmail: "owner@example.com",
  });
  assert.equal(updated.role, "admin");
  assert.match(roleUpdate.calls[0].text, /UPDATE users/);

  await assert.rejects(() => updateStoredUserRole(roleUpdate.sql, {
    email: "OWNER@example.com",
    role: "member",
    ownerEmail: "owner@example.com",
  }), (error) => error.code === "USER_ROLE_OWNER_IMMUTABLE");
});
