import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  backfillExistingContributorLogins,
  listUserLogins,
  normalizeLoginIdentity,
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
  }]);

  assert.deepEqual(await upsertUserLogin(sql, {
    name: "Hoang Ngoc",
    email: "FRIEND@example.com",
  }, loginTime), {
    name: "Hoang Ngoc",
    email: "friend@example.com",
    first_login: loginTime.toISOString(),
    last_login: loginTime.toISOString(),
  });

  assert.match(calls[0].text, /ON CONFLICT \(email\) DO UPDATE SET/);
  assert.doesNotMatch(calls[0].text, /first_login\s*=/);
  assert.deepEqual(calls[0].values, [
    "Hoang Ngoc",
    "friend@example.com",
    loginTime.toISOString(),
    loginTime.toISOString(),
  ]);
});

test("backfills existing contributors without requiring another login", async () => {
  const { calls, sql } = sqlMock([]);

  assert.equal(await backfillExistingContributorLogins(sql), 0);

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /INSERT INTO users/);
  assert.match(calls[0].text, /FROM suggestions/);
  assert.match(calls[0].text, /MIN\(created_at\)/);
  assert.match(calls[0].text, /MAX\(created_at\)/);
  assert.match(calls[0].text, /ON CONFLICT \(email\) DO UPDATE SET/);
  assert.match(calls[0].text, /LEAST\(users\.first_login, EXCLUDED\.first_login\)/);
  assert.match(calls[0].text, /GREATEST\(users\.last_login, EXCLUDED\.last_login\)/);
  assert.match(calls[0].text, /RETURNING 1 AS synced/);
});

test("runs the contributor backfill before the existing-schedule migration exit", async () => {
  const migration = await readFile(new URL("./migrate.mjs", import.meta.url), "utf8");
  const backfillIndex = migration.indexOf("await backfillExistingContributorLogins(sql)");
  const existingScheduleExitIndex = migration.indexOf("if (existingSchedule.count > 0)");

  assert.notEqual(backfillIndex, -1);
  assert.notEqual(existingScheduleExitIndex, -1);
  assert.ok(backfillIndex < existingScheduleExitIndex);
});

test("serializes login timestamps for the admin client", async () => {
  const { sql } = sqlMock([{
    name: "Owner",
    email: "owner@example.com",
    first_login: "2026-08-10T01:00:00.000Z",
    last_login: new Date("2026-08-11T02:00:00.000Z"),
  }]);

  assert.deepEqual(await listUserLogins(sql), [{
    name: "Owner",
    email: "owner@example.com",
    first_login: "2026-08-10T01:00:00.000Z",
    last_login: "2026-08-11T02:00:00.000Z",
  }]);
});
