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

test("normalizes login values and serializes the stored user", async () => {
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

  assert.deepEqual(calls[0].values, [
    "Hoang Ngoc",
    "Hoang Ngoc",
    "friend@example.com",
    loginTime.toISOString(),
    loginTime.toISOString(),
    loginTime.toISOString(),
  ]);
});

test("normalizes activity values and serializes a stored activity update", async () => {
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

test("returns null when an activity write produces no stored row", async () => {
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

test("prefers a stored display name when serializing a refreshed login", async () => {
  const loginTime = new Date("2026-08-17T09:30:00.000Z");
  const { sql } = sqlMock([{
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
});

test("validates display-name updates", () => {
  assert.deepEqual(parseDisplayName({ displayName: "  My name  " }), { displayName: "My name" });
  assert.throws(() => parseDisplayName({ displayName: "" }), ValidationError);
  assert.throws(() => parseDisplayName({ displayName: "A", extra: true }), ValidationError);
});

test("normalizes a display-name update and serializes the stored result", async () => {
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
  assert.deepEqual(calls[0].values, ["Chosen Name", "friend@example.com"]);
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
  assert.deepEqual(roleUpdate.calls[0].values, ["admin", "friend@example.com"]);

  await assert.rejects(() => updateStoredUserRole(roleUpdate.sql, {
    email: "OWNER@example.com",
    role: "member",
    ownerEmail: "owner@example.com",
  }), (error) => error.code === "USER_ROLE_OWNER_IMMUTABLE");
});
