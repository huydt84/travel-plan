import assert from "node:assert/strict";
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
