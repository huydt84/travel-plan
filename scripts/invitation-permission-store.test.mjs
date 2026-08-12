import assert from "node:assert/strict";
import test from "node:test";
import {
  claimInvitationBatch,
  InvitationPermissionError,
  InvitationRateLimitError,
  requestInvitationPermission,
  reviewInvitationPermission,
} from "../lib/invitation-permission-store.mjs";

const now = new Date("2026-08-12T00:00:00.000Z");

test("creates only the first permission request and preserves later denied or revoked decisions", async () => {
  let call = 0;
  const sql = async () => {
    call += 1;
    if (call === 1) return [{
      id: 9,
      user_email: "friend@example.com",
      status: "pending",
      requested_trip_slug: "kasai",
      requested_trip_title: "Kasai",
      requested_at: now,
      updated_at: now,
    }];
    return [];
  };
  const created = await requestInvitationPermission(sql, {
    userEmail: "Friend@Example.com",
    trip: { slug: "kasai", title: "Kasai" },
  });
  assert.equal(created.status, "pending");
  assert.equal(created.userEmail, "friend@example.com");
});

test("owner review supports approve, deny, revoke, and reapproval with a bounded reason", async () => {
  const sql = async (_strings, ...values) => [{
    id: 9,
    user_email: "friend@example.com",
    status: values[0],
    requested_trip_slug: "kasai",
    requested_trip_title: "Kasai",
    requested_at: now,
    reviewed_at: now,
    reviewed_by: values[1],
    decision_reason: values[2],
    updated_at: now,
  }];
  for (const [action, expected] of [["approve", "approved"], ["deny", "denied"], ["revoke", "revoked"]]) {
    const permission = await reviewInvitationPermission(sql, {
      id: 9,
      action,
      reviewerEmail: "owner@example.com",
      reason: "x".repeat(400),
    });
    assert.equal(permission.status, expected);
    assert.ok(permission.decisionReason.length <= 300);
  }
});

test("the 21st rolling-day batch is rejected while an idempotent retry remains allowed", async () => {
  const makeSql = (row) => {
    const sql = async () => [];
    sql.transaction = async (buildQueries) => {
      const queries = buildQueries(() => Promise.resolve([row]));
      return Promise.all(queries);
    };
    return sql;
  };
  await assert.rejects(
    claimInvitationBatch(makeSql({ allowed: false, used: 20, oldest: now }), {
      requestId: "f14f33e9-668c-4c5f-9f80-16f3af284926",
      inviterEmail: "friend@example.com",
      now,
    }),
    InvitationRateLimitError,
  );
  const retryQuota = await claimInvitationBatch(makeSql({ allowed: true, used: 20, oldest: now }), {
    requestId: "f14f33e9-668c-4c5f-9f80-16f3af284926",
    inviterEmail: "friend@example.com",
    now,
  });
  assert.equal(retryQuota.batchesUsed, 20);
  assert.equal(retryQuota.batchesRemaining, 0);
  await assert.rejects(
    claimInvitationBatch(makeSql({ allowed: false, owner_mismatch: true, used: 0, oldest: null }), {
      requestId: "f14f33e9-668c-4c5f-9f80-16f3af284926",
      inviterEmail: "other@example.com",
      now,
    }),
    InvitationPermissionError,
  );
});
