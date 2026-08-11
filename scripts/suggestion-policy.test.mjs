import assert from "node:assert/strict";
import test from "node:test";
import { canDeleteSuggestion, canManageSuggestion, canSetSuggestionStatus } from "../lib/suggestion-policy.mjs";

const owner = { email: "owner@example.com", isOwner: true };
const author = { email: "friend@example.com", isOwner: false };
const comment = { kind: "comment", author_email: "FRIEND@example.com" };
const suggestion = { kind: "suggestion", author_email: "friend@example.com" };

test("owners can manage every comment and suggestion status", () => {
  assert.equal(canManageSuggestion(owner, suggestion), true);
  for (const status of ["open", "accepted", "resolved", "rejected"]) {
    assert.equal(canSetSuggestionStatus(owner, suggestion, status), true);
  }
});

test("authors can manage only their own comments", () => {
  assert.equal(canManageSuggestion(author, comment), true);
  assert.equal(canManageSuggestion(author, suggestion), false);
  assert.equal(canManageSuggestion({ email: "other@example.com", isOwner: false }, comment), false);
  assert.equal(canManageSuggestion(null, comment), false);
});

test("authors can delete their own contribution without gaining moderation rights", () => {
  assert.equal(canDeleteSuggestion(author, comment), true);
  assert.equal(canDeleteSuggestion(author, suggestion), true);
  assert.equal(canDeleteSuggestion({ email: "other@example.com", isOwner: false }, suggestion), false);
  assert.equal(canSetSuggestionStatus(author, suggestion, "resolved"), false);
});

test("comment authors can resolve or reopen but cannot moderate other statuses", () => {
  assert.equal(canSetSuggestionStatus(author, comment, "resolved"), true);
  assert.equal(canSetSuggestionStatus(author, comment, "open"), true);
  assert.equal(canSetSuggestionStatus(author, comment, "accepted"), false);
  assert.equal(canSetSuggestionStatus(author, comment, "rejected"), false);
});
