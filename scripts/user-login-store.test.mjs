import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { USER_ACTIVITY_WRITE_INTERVAL_MS } from "../lib/user-activity.mjs";
import {
  backfillExistingContributorLogins,
  listUserActivity,
  normalizeLoginIdentity,
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

test("backfills existing contributors without requiring another login", async () => {
  const { calls, sql } = sqlMock([]);

  assert.equal(await backfillExistingContributorLogins(sql), 0);

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /INSERT INTO users/);
  assert.match(calls[0].text, /FROM suggestions/);
  assert.match(calls[0].text, /MIN\(created_at\)/);
  assert.match(calls[0].text, /MAX\(created_at\)/);
  assert.match(calls[0].text, /last_active_at/);
  assert.match(calls[0].text, /ON CONFLICT \(email\) DO UPDATE SET/);
  assert.match(calls[0].text, /LEAST\(users\.first_login, EXCLUDED\.first_login\)/);
  assert.match(calls[0].text, /GREATEST\(users\.last_login, EXCLUDED\.last_login\)/);
  assert.match(calls[0].text, /GREATEST\(users\.last_active_at, EXCLUDED\.last_active_at\)/);
  assert.match(calls[0].text, /RETURNING 1 AS synced/);
});

test("runs the contributor backfill before the existing-schedule migration exit", async () => {
  const migration = await readFile(new URL("./migrate.mjs", import.meta.url), "utf8");
  const backfillIndex = migration.indexOf("await backfillExistingContributorLogins(sql)");
  const existingScheduleExitIndex = migration.indexOf("if (existingSchedule.count > 0)");
  const activityColumnIndex = migration.indexOf("ADD COLUMN IF NOT EXISTS last_active_at");

  assert.notEqual(backfillIndex, -1);
  assert.notEqual(existingScheduleExitIndex, -1);
  assert.notEqual(activityColumnIndex, -1);
  assert.ok(activityColumnIndex < backfillIndex);
  assert.ok(backfillIndex < existingScheduleExitIndex);
});

test("serializes and sorts activity timestamps for the admin client", async () => {
  const { sql } = sqlMock([{
    name: "Owner",
    email: "owner@example.com",
    first_login: "2026-08-10T01:00:00.000Z",
    last_login: new Date("2026-08-11T02:00:00.000Z"),
    last_active_at: new Date("2026-08-15T00:00:00.000Z"),
  }]);

  assert.deepEqual(await listUserActivity(sql), [{
    name: "Owner",
    email: "owner@example.com",
    first_login: "2026-08-10T01:00:00.000Z",
    last_login: "2026-08-11T02:00:00.000Z",
    last_active_at: "2026-08-15T00:00:00.000Z",
  }]);
});
