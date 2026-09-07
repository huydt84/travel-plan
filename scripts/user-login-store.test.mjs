import assert from "node:assert/strict";
import test from "node:test";
import { USER_ACTIVITY_WRITE_INTERVAL_MS } from "../lib/user-activity.mjs";
import {
  listUserActivity,
  normalizeLoginIdentity,
  resolveStoredUserRole,
  updateStoredUserDisplayName,
  updateStoredUserRole,
  upsertUserActivity,
  upsertUserLogin,
} from "../lib/user-login-store.mjs";
import { parseDisplayName, ValidationError } from "../lib/validation.js";

const sqlMock = (rows) => {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return rows;
  };
  sql.transaction = async (buildQueries) => {
    const tx = (strings, ...values) => {
      calls.push({ text: strings.join("?"), values });
      return { text: strings.join("?"), values };
    };
    const queries = buildQueries(tx);
    return queries.map(() => rows);
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
    displayName: "Hoang Ngoc",
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
    displayName: "Owner",
    email: "owner@example.com",
    role: "member",
    first_login: "2026-08-10T01:00:00.000Z",
    last_login: "2026-08-11T02:00:00.000Z",
    last_active_at: "2026-08-15T00:00:00.000Z",
  }]);
});

test("preserves a custom display name while Google refreshes the source name", async () => {
  const loginTime = new Date("2026-08-17T09:30:00.000Z");
  const { calls, sql } = sqlMock([{
    name: "New Google Name",
    display_name: "My trip name",
    email: "friend@example.com",
    role: "member",
    first_login: loginTime,
    last_login: loginTime,
    last_active_at: loginTime,
  }]);

  const result = await upsertUserLogin(sql, { name: "New Google Name", email: "friend@example.com" }, loginTime);
  assert.equal(result.name, "My trip name");
  assert.equal(result.displayName, "My trip name");
  assert.match(calls[0].text, /name = EXCLUDED\.name/);
  assert.doesNotMatch(calls[0].text, /display_name\s*=\s*EXCLUDED\.display_name/);
});

test("validates display-name updates", () => {
  assert.deepEqual(parseDisplayName({ displayName: "  My name  " }), { displayName: "My name" });
  assert.throws(() => parseDisplayName({ displayName: "" }), ValidationError);
  assert.throws(() => parseDisplayName({ displayName: "A", extra: true }), ValidationError);
});

test("updates the display name everywhere a contribution identity is denormalized", async () => {
  const { calls, sql } = sqlMock([{
    name: "Google Name",
    display_name: "Chosen Name",
    email: "friend@example.com",
    role: "member",
    first_login: "2026-08-17T09:30:00.000Z",
    last_login: "2026-08-17T09:30:00.000Z",
    last_active_at: "2026-08-17T09:30:00.000Z",
  }]);

  const result = await updateStoredUserDisplayName(sql, {
    email: "FRIEND@example.com",
    displayName: "Chosen Name",
  });
  assert.equal(result.displayName, "Chosen Name");
  assert.equal(calls.length, 4);
  assert.match(calls[1].text, /UPDATE suggestions SET author_name/);
  assert.match(calls[2].text, /UPDATE notifications notification/);
  assert.match(calls[3].text, /UPDATE admin_notification_outbox outbox/);
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
