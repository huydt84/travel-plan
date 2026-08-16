import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseSuggestionMutation, parseUserRole, ValidationError } from "../lib/validation.js";

test("suggestion mutations accept exactly one status or visibility change", () => {
  assert.deepEqual(parseSuggestionMutation({ status: "resolved" }), { status: "resolved" });
  assert.deepEqual(parseSuggestionMutation({ hidden: true }), { hidden: true });
  assert.throws(() => parseSuggestionMutation({ status: "open", hidden: false }), ValidationError);
  assert.throws(() => parseSuggestionMutation({ hidden: "true" }), ValidationError);
  assert.throws(() => parseSuggestionMutation({}), ValidationError);
});

test("role mutations accept only member and admin", () => {
  assert.deepEqual(parseUserRole({ role: "member" }), { role: "member" });
  assert.deepEqual(parseUserRole({ role: "admin" }), { role: "admin" });
  assert.throws(() => parseUserRole({ role: "owner" }), ValidationError);
  assert.throws(() => parseUserRole({ role: "admin", extra: true }), ValidationError);
});

test("migration adds reversible visibility, stored roles, and visibility notifications before seeding exits", async () => {
  const migration = await readFile(new URL("./migrate.mjs", import.meta.url), "utf8");
  const exitIndex = migration.indexOf("if (existingSchedule.count > 0)");
  for (const marker of [
    "ADD COLUMN IF NOT EXISTS hidden_at",
    "ADD COLUMN IF NOT EXISTS hidden_by_email",
    "ADD COLUMN IF NOT EXISTS role",
    "contribution_visibility_changed",
    "ADD COLUMN IF NOT EXISTS visibility_value",
  ]) {
    const index = migration.indexOf(marker);
    assert.notEqual(index, -1, `${marker} should exist`);
    assert.ok(index < exitIndex, `${marker} should run before the existing-schedule exit`);
  }
});

test("role endpoint is owner-only and suggestion visibility is enforced in the repository", async () => {
  const [roleRoute, suggestionRepository] = await Promise.all([
    readFile(new URL("../app/api/admin/users/[email]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/suggestion-repository.js", import.meta.url), "utf8"),
  ]);
  assert.match(roleRoute, /viewer\?\.isOwner/);
  assert.match(roleRoute, /updateUserRole/);
  assert.match(suggestionRepository, /canChangeSuggestionVisibility/);
  assert.match(suggestionRepository, /hidden_at IS NULL/);
  assert.match(suggestionRepository, /contribution_visibility_changed/);
});
