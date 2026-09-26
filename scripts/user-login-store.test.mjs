import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLoginIdentity } from "../lib/user-login-store.mjs";
import { parseDisplayName, ValidationError } from "../lib/validation.js";

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

test("validates display-name updates", () => {
  assert.deepEqual(parseDisplayName({ displayName: "  My name  " }), { displayName: "My name" });
  assert.throws(() => parseDisplayName({ displayName: "" }), ValidationError);
  assert.throws(() => parseDisplayName({ displayName: "A", extra: true }), ValidationError);
});
