import assert from "node:assert/strict";
import test from "node:test";
import { createInvitationHandler } from "../lib/invitation-handler.mjs";
import { InvitationRateLimitError, InvitationPermissionError } from "../lib/invitation-permission-store.mjs";

const input = { requestId: "6fce08bd-85b1-4e14-9011-1970fdc3764a", tripSlug: "sample", recipients: ["friend@example.com"], subject: "Join us", message: "A day out" };
function setup(overrides = {}) {
  const calls = [];
  const dependencies = {
    requireAuthenticated: async () => ({ viewer: { email: "owner@example.com" } }),
    resolveInvitationPermission: async () => ({ status: "approved" }),
    getGoogleMailAccess: async () => ({ email: "owner@example.com", accessToken: "test-token" }),
    getCachedItinerary: async () => ({ trip: { slug: "sample" }, itinerary: [] }),
    reserveInvitationBatch: async () => ({ remaining: 19 }),
    claimInvitationRecipients: async ({ recipients }) => recipients,
    sendInvitationBatch: async ({ recipients }) => ({ sent: recipients.length, deliveries: recipients.map((recipient) => ({ recipient, status: "sent" })) }),
    saveInvitationDeliveries: async ({ deliveries }) => deliveries,
    ...overrides,
  };
  const handler = createInvitationHandler(Object.fromEntries(Object.entries(dependencies).map(([key, fn]) => [key, async (...args) => {
    calls.push(key); return fn(...args);
  }])));
  return { calls, send: (body = input) => handler(new Request("https://example.com/api/invitations", { method: "POST", body: JSON.stringify(body) })) };
}

test("authentication and input validation precede every delivery side effect", async () => {
  const unauthorized = setup({ requireAuthenticated: async () => ({ response: new Response(null, { status: 401 }) }) });
  assert.equal((await unauthorized.send()).status, 401);
  assert.deepEqual(unauthorized.calls, ["requireAuthenticated"]);
  const invalid = setup();
  assert.equal((await invalid.send({})).status, 400);
  assert.deepEqual(invalid.calls, ["requireAuthenticated"]);
});

for (const [status, code] of [[null, "PERMISSION_REQUIRED"], ["pending", "PERMISSION_PENDING"], ["denied", "PERMISSION_DENIED"], ["revoked", "PERMISSION_REVOKED"]]) {
  test(`permission ${status} blocks Gmail and returns ${code}`, async () => {
    const context = setup({ resolveInvitationPermission: async () => status ? { status } : null });
    const response = await context.send();
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, code);
    assert.deepEqual(context.calls, ["requireAuthenticated", "resolveInvitationPermission"]);
  });
}

test("successful delivery claims recipients first and records client-safe history", async () => {
  const context = setup();
  const response = await context.send();
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { sent: 1, skipped: 0, history: [{ recipient: "friend@example.com", status: "sent" }], quota: { remaining: 19 } });
  assert.deepEqual(context.calls, ["requireAuthenticated", "resolveInvitationPermission", "getGoogleMailAccess", "getCachedItinerary", "reserveInvitationBatch", "claimInvitationRecipients", "sendInvitationBatch", "saveInvitationDeliveries"]);
});

test("replayed recipients are skipped without sending or rewriting history", async () => {
  const context = setup({ claimInvitationRecipients: async () => [] });
  const response = await context.send();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).skipped, 1);
  assert.ok(!context.calls.includes("sendInvitationBatch"));
});

test("a Gmail account mismatch cannot reserve or send a batch", async () => {
  const context = setup({ getGoogleMailAccess: async () => ({ email: "other@example.com" }) });
  assert.equal((await context.send()).status, 403);
  assert.ok(!context.calls.includes("reserveInvitationBatch"));
});

for (const [code, status] of [["INVITATION_AUTH_ERROR", 403], ["INVITATION_CONFIG_ERROR", 503], ["TRIP_NOT_FOUND", 404], ["UNEXPECTED", 500]]) {
  test(`maps ${code} to ${status}`, async () => {
    const context = setup({ getGoogleMailAccess: async () => { throw Object.assign(new Error("private"), { code }); } });
    const response = await context.send();
    assert.equal(response.status, status);
    assert.ok(!(await response.text()).includes("private"));
  });
}

test("partial delivery failures preserve each outcome before returning retry feedback", async () => {
  const deliveries = [{ recipient: "friend@example.com", status: "sent" }, { recipient: "other@example.com", status: "failed" }];
  const context = setup({ sendInvitationBatch: async () => { throw Object.assign(new Error(), { code: "INVITATION_DELIVERY_ERROR", deliveries }); } });
  const response = await context.send({ ...input, recipients: deliveries.map((item) => item.recipient) });
  assert.equal(response.status, 502);
  assert.deepEqual((await response.json()).history, deliveries);
  assert.equal(context.calls.at(-1), "saveInvitationDeliveries");
});

test("quota and idempotency conflicts do not claim recipients", async () => {
  for (const [error, status] of [[new InvitationRateLimitError({ remaining: 0 }), 429], [new InvitationPermissionError("REQUEST_ID_CONFLICT", "Conflict"), 409]]) {
    const context = setup({ reserveInvitationBatch: async () => { throw error; } });
    assert.equal((await context.send()).status, status);
    assert.ok(!context.calls.includes("claimInvitationRecipients"));
  }
});
