import assert from "node:assert/strict";
import test from "node:test";
import {
  claimInvitationDeliveries,
  listInvitationDeliveries,
  recordInvitationDeliveries,
} from "../lib/invitation-history-store.mjs";

const requestId = "f14f33e9-668c-4c5f-9f80-16f3af284926";
const timestamp = new Date("2026-08-11T12:34:56.000Z");

test("stores each recipient outcome atomically and returns client-safe history rows", async () => {
  const transactionQueries = [];
  const sql = async () => [];
  sql.transaction = async (buildQueries) => {
    const queries = buildQueries((strings, ...values) => ({ text: strings.join("?"), values }));
    transactionQueries.push(...queries);
    return queries.map((query, index) => [{
      id: index + 10,
      request_id: query.values[0],
      inviter_email: query.values[1],
      recipient_email: query.values[2],
      trip_slug: query.values[4],
      trip_title: query.values[5],
      subject: query.values[6],
      status: query.values[7],
      error_code: query.values[9],
      attempted_at: query.values[10],
      sent_at: query.values[11],
    }]);
  };

  const rows = await recordInvitationDeliveries(sql, {
    requestId,
    inviterEmail: "owner@example.com",
    trip: { slug: "kasai-evening", title: "Kasai Rinkai Park" },
    subject: "Đi Kasai cùng mình nhé?",
    deliveries: [
      { recipient: "one@example.com", status: "sent", gmailMessageId: "gmail-one", errorCode: null },
      { recipient: "two@example.com", status: "failed", gmailMessageId: null, errorCode: "INVITATION_DELIVERY_ERROR" },
    ],
  }, timestamp);

  assert.equal(transactionQueries.length, 2);
  assert.match(transactionQueries[0].text, /ON CONFLICT \(request_id, recipient_email\) DO UPDATE/);
  assert.deepEqual(rows, [
    {
      id: "10",
      requestId,
      inviterEmail: "owner@example.com",
      recipientEmail: "one@example.com",
      tripSlug: "kasai-evening",
      tripTitle: "Kasai Rinkai Park",
      subject: "Đi Kasai cùng mình nhé?",
      status: "sent",
      errorCode: null,
      attemptedAt: timestamp.toISOString(),
      sentAt: timestamp.toISOString(),
    },
    {
      id: "11",
      requestId,
      inviterEmail: "owner@example.com",
      recipientEmail: "two@example.com",
      tripSlug: "kasai-evening",
      tripTitle: "Kasai Rinkai Park",
      subject: "Đi Kasai cùng mình nhé?",
      status: "failed",
      errorCode: "INVITATION_DELIVERY_ERROR",
      attemptedAt: timestamp.toISOString(),
      sentAt: null,
    },
  ]);
});

test("lists the latest 200 invitation deliveries", async () => {
  let query = "";
  const sql = async (strings) => {
    query = strings.join("");
    return [{
      id: "2",
      request_id: requestId,
      inviter_email: "owner@example.com",
      recipient_email: "friend@example.com",
      trip_slug: "kasai-evening",
      trip_title: "Kasai",
      subject: "Đi cùng mình nhé?",
      status: "sent",
      error_code: null,
      attempted_at: timestamp,
      sent_at: timestamp,
    }];
  };
  const rows = await listInvitationDeliveries(sql);
  assert.match(query, /ORDER BY attempted_at DESC, id DESC/);
  assert.match(query, /status IN \('sent', 'failed'\)/);
  assert.match(query, /LIMIT 200/);
  assert.equal(rows[0].id, "2");
});

test("claims only retryable recipients before Gmail delivery", async () => {
  const transactionQueries = [];
  const sql = async () => [];
  sql.transaction = async (buildQueries) => {
    const queries = buildQueries((strings, ...values) => ({ text: strings.join("?"), values }));
    transactionQueries.push(...queries);
    return [[{ recipient_email: queries[0].values[2] }], []];
  };

  const claimed = await claimInvitationDeliveries(sql, {
    requestId,
    inviterEmail: "owner@example.com",
    recipients: ["retry@example.com", "already-sent@example.com"],
    trip: { slug: "kasai-evening", title: "Kasai" },
    subject: "Đi Kasai nhé?",
  }, timestamp);

  assert.deepEqual(claimed, ["retry@example.com"]);
  assert.match(transactionQueries[0].text, /status = 'sending'/);
  assert.match(transactionQueries[0].text, /invitation_deliveries\.status = 'failed'/);
  assert.match(transactionQueries[0].text, /invitation_deliveries\.status = 'sending'/);
  assert.match(transactionQueries[0].text, /RETURNING recipient_email/);
});
