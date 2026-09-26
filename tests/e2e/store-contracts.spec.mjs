import { randomUUID } from "node:crypto";
import {
  claimInvitationDeliveries,
  listInvitationDeliveries,
  recordInvitationDeliveries,
} from "../../lib/invitation-history-store.mjs";
import {
  claimInvitationBatch,
  getInvitationPermission,
  InvitationPermissionError,
  InvitationRateLimitError,
  requestInvitationPermission,
  reviewInvitationPermission,
} from "../../lib/invitation-permission-store.mjs";
import {
  processAdminNotificationOutboxRecords,
} from "../../lib/admin-notification-outbox-store.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import {
  listUserActivity,
  resolveStoredUserRole,
  updateStoredUserRole,
  updateStoredUserDisplayName,
  upsertUserActivity,
  upsertUserLogin,
} from "../../lib/user-login-store.mjs";
import { expect, test } from "./fixtures.mjs";

const future = new Date("2099-01-01T00:00:00.000Z");

async function createTrip(sql, marker) {
  const [trip] = await sql`
    INSERT INTO trips (slug, title, trip_date, end_date, timezone, location)
    VALUES (${`store-contract-${marker}`}, 'Store contract', '2099-01-01', '2099-01-01', 'Asia/Tokyo', 'Tokyo')
    RETURNING id, slug, title
  `;
  return trip;
}

test("invitation delivery conflicts, leases, filtering, ordering, and the history bound work in PostgreSQL", async () => {
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  const marker = randomUUID();
  const inviterEmail = `inviter-${marker}@localhost.invalid`;
  const trip = await createTrip(sql, marker);
  const requestId = randomUUID();

  try {
    const delivery = {
      requestId,
      inviterEmail,
      trip,
      subject: "First attempt",
      deliveries: [{ recipient: "same@example.com", status: "failed", gmailMessageId: null, errorCode: "TEMPORARY" }],
    };
    const [failed] = await recordInvitationDeliveries(sql, delivery, future);
    expect(failed).toEqual({
      id: expect.any(String), requestId, inviterEmail, recipientEmail: "same@example.com",
      tripSlug: trip.slug, tripTitle: trip.title, subject: "First attempt",
      status: "failed", errorCode: "TEMPORARY", attemptedAt: future.toISOString(), sentAt: null,
    });
    const claimInput = { requestId, inviterEmail, recipients: ["same@example.com"], trip, subject: "Retry" };
    expect(await claimInvitationDeliveries(sql, claimInput, new Date(future.getTime() + 500))).toEqual(["same@example.com"]);
    const [sent] = await recordInvitationDeliveries(sql, {
      requestId,
      inviterEmail,
      trip,
      subject: "Retry",
      deliveries: [{ recipient: "same@example.com", status: "sent", gmailMessageId: "gmail-1", errorCode: null }],
    }, new Date(future.getTime() + 1_000));
    expect(sent).toEqual({
      ...failed, subject: "Retry", status: "sent", errorCode: null,
      attemptedAt: new Date(future.getTime() + 1_000).toISOString(),
      sentAt: new Date(future.getTime() + 1_000).toISOString(),
    });
    expect(await claimInvitationDeliveries(sql, claimInput, new Date(future.getTime() + 1_500))).toEqual([]);

    expect(await sql`
      SELECT status, subject, error_code, sent_at IS NOT NULL AS sent
      FROM invitation_deliveries
      WHERE request_id = ${requestId}
    `).toEqual([{ status: "sent", subject: "Retry", error_code: null, sent: true }]);

    const leaseRequest = randomUUID();
    const leaseInput = {
      requestId: leaseRequest,
      inviterEmail,
      recipients: ["lease@example.com"],
      trip,
      subject: "Lease",
    };
    expect(await claimInvitationDeliveries(sql, leaseInput, future)).toEqual(["lease@example.com"]);
    expect(await claimInvitationDeliveries(sql, leaseInput, new Date(future.getTime() + 9 * 60_000))).toEqual([]);
    expect(await claimInvitationDeliveries(sql, leaseInput, new Date(future.getTime() + 11 * 60_000))).toEqual(["lease@example.com"]);

    const bulkRequest = randomUUID();
    await recordInvitationDeliveries(sql, {
      requestId: bulkRequest,
      inviterEmail,
      trip,
      subject: "Bounded history",
      deliveries: Array.from({ length: 201 }, (_, index) => ({
        recipient: `history-${String(index).padStart(3, "0")}@example.com`,
        status: "sent",
        gmailMessageId: `gmail-${index}`,
        errorCode: null,
      })),
    }, new Date(future.getTime() + 20 * 60_000));
    const history = await listInvitationDeliveries(sql);
    expect(history).toHaveLength(200);
    expect(history[0].recipientEmail).toBe("history-200@example.com");
    expect(history.at(-1).recipientEmail).toBe("history-001@example.com");
    expect(history.some((row) => row.recipientEmail === "lease@example.com")).toBe(false);
  } finally {
    await sql`DELETE FROM invitation_deliveries WHERE inviter_email = ${inviterEmail}`;
    await sql`DELETE FROM trips WHERE id = ${trip.id}`;
    await sql.end();
  }
});

test("invitation permissions and rolling batch limits follow persisted decisions", async () => {
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  const marker = randomUUID();
  const email = `invitation-permission-${marker}@localhost.invalid`;
  const trip = await createTrip(sql, marker);
  const requestId = randomUUID();

  try {
    await upsertUserLogin(sql, { name: "Inviter", email }, future);
    const requested = await requestInvitationPermission(sql, { userEmail: email.toUpperCase(), trip });
    expect(requested).toMatchObject({ userEmail: email, status: "pending", requestedTripSlug: trip.slug });
    const denied = await reviewInvitationPermission(sql, {
      id: requested.id, action: "deny", reviewerEmail: "owner@example.com", reason: "x".repeat(400),
    });
    expect(denied).toMatchObject({ status: "denied", decisionReason: "x".repeat(300) });
    expect((await requestInvitationPermission(sql, { userEmail: email, trip })).status).toBe("denied");
    await reviewInvitationPermission(sql, { id: requested.id, action: "approve", reviewerEmail: "owner@example.com" });
    expect((await reviewInvitationPermission(sql, {
      id: requested.id, action: "revoke", reviewerEmail: "owner@example.com",
    })).status).toBe("revoked");
    expect((await getInvitationPermission(sql, email)).status).toBe("revoked");
    expect((await reviewInvitationPermission(sql, {
      id: requested.id, action: "approve", reviewerEmail: "owner@example.com",
    })).status).toBe("approved");

    for (let index = 0; index < 20; index += 1) {
      const quota = await claimInvitationBatch(sql, {
        requestId: index === 0 ? requestId : randomUUID(), inviterEmail: email, now: future,
      });
      expect(quota.batchesUsed).toBe(index + 1);
    }
    await expect(claimInvitationBatch(sql, { requestId: randomUUID(), inviterEmail: email, now: future }))
      .rejects.toBeInstanceOf(InvitationRateLimitError);
    expect((await claimInvitationBatch(sql, { requestId, inviterEmail: email, now: future })).batchesRemaining).toBe(0);
    await expect(claimInvitationBatch(sql, {
      requestId, inviterEmail: "other@example.com", now: future,
    })).rejects.toBeInstanceOf(InvitationPermissionError);
    expect(await sql`SELECT COUNT(*)::INTEGER AS count FROM invitation_batches WHERE inviter_email=${email}`)
      .toEqual([{ count: 20 }]);
  } finally {
    await sql`DELETE FROM invitation_batches WHERE inviter_email=${email}`;
    await sql`DELETE FROM users WHERE email=${email}`;
    await sql`DELETE FROM trips WHERE id=${trip.id}`;
    await sql.end();
  }
});

test("login timestamps, activity throttling, and denormalized display names are enforced by PostgreSQL", async () => {
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  const marker = randomUUID();
  const email = `user-${marker}@localhost.invalid`;
  const ownerEmail = `owner-${marker}@localhost.invalid`;
  const firstLogin = new Date("2098-12-01T00:00:00.000Z");
  const secondLogin = new Date("2098-12-02T00:00:00.000Z");
  const trip = await createTrip(sql, marker);

  try {
    const first = await upsertUserLogin(sql, { name: "Original Google Name", email }, firstLogin);
    expect(first).toMatchObject({ email, name: "Original Google Name", displayName: "Original Google Name", role: "member" });
    const refreshed = await upsertUserLogin(sql, { name: "Refreshed Google Name", email }, secondLogin);
    expect(refreshed).toMatchObject({ email, name: "Original Google Name", displayName: "Original Google Name" });
    expect(await upsertUserActivity(sql, { name: "Refreshed Google Name", email }, new Date(secondLogin.getTime() + 4 * 60_000))).toBeNull();
    const activity = await upsertUserActivity(sql, { name: "Refreshed Google Name", email }, new Date(secondLogin.getTime() + 5 * 60_000));
    expect(activity.last_active_at).toBe(new Date(secondLogin.getTime() + 5 * 60_000).toISOString());

    const [stored] = await sql`
      SELECT name, display_name, first_login, last_login, last_active_at
      FROM users WHERE email = ${email}
    `;
    expect(stored.name).toBe("Refreshed Google Name");
    expect(stored.display_name).toBe("Original Google Name");
    expect(stored.first_login.toISOString()).toBe(firstLogin.toISOString());
    expect(stored.last_login.toISOString()).toBe(secondLogin.toISOString());
    expect(stored.last_active_at.toISOString()).toBe(new Date(secondLogin.getTime() + 5 * 60_000).toISOString());

    await upsertUserLogin(sql, { name: "Owner", email: ownerEmail }, firstLogin);
    const [suggestion] = await sql`
      INSERT INTO suggestions (trip_id, kind, body, author_email, author_name)
      VALUES (${trip.id}, 'comment', 'Contract', ${email}, 'Original Google Name') RETURNING id
    `;
    await sql`
      INSERT INTO notifications (recipient_email, trip_id, suggestion_id, event_type, actor_name)
      VALUES (${ownerEmail}, ${trip.id}, ${suggestion.id}, 'contribution_created', 'Original Google Name')
    `;
    await sql`
      INSERT INTO admin_notification_outbox
        (suggestion_id, recipient_email, author_name, contribution_kind, contribution_body, trip_slug, trip_title)
      VALUES (${suggestion.id}, ${ownerEmail}, 'Original Google Name', 'comment', 'Contract', ${trip.slug}, ${trip.title})
    `;

    const renamed = await updateStoredUserDisplayName(sql, { email: email.toUpperCase(), displayName: "Chosen Name" });
    expect(renamed).toMatchObject({ email, name: "Chosen Name", displayName: "Chosen Name" });
    expect((await sql`SELECT author_name FROM suggestions WHERE id = ${suggestion.id}`)[0].author_name).toBe("Chosen Name");
    expect((await sql`SELECT actor_name FROM notifications WHERE suggestion_id = ${suggestion.id}`)[0].actor_name).toBe("Chosen Name");
    expect((await sql`SELECT author_name FROM admin_notification_outbox WHERE suggestion_id = ${suggestion.id}`)[0].author_name).toBe("Chosen Name");
    const laterLogin = await upsertUserLogin(sql, { name: "Latest Google Name", email }, new Date(secondLogin.getTime() + 10 * 60_000));
    expect(laterLogin).toMatchObject({ name: "Chosen Name", displayName: "Chosen Name" });
    expect((await sql`SELECT name,display_name FROM users WHERE email=${email}`)[0])
      .toEqual({ name: "Latest Google Name", display_name: "Chosen Name" });
    expect(await resolveStoredUserRole(sql, email.toUpperCase())).toBe("member");
    expect((await updateStoredUserRole(sql, { email, role: "admin", ownerEmail })).role).toBe("admin");
    expect(await resolveStoredUserRole(sql, email)).toBe("admin");
    await expect(updateStoredUserRole(sql, { email: ownerEmail.toUpperCase(), role: "member", ownerEmail }))
      .rejects.toMatchObject({ code: "USER_ROLE_OWNER_IMMUTABLE" });
    const listed = await listUserActivity(sql, { ownerEmail });
    expect(listed.find((user) => user.email === email)).toMatchObject({
      name: "Chosen Name", displayName: "Chosen Name", role: "admin",
    });
    expect(listed.find((user) => user.email === ownerEmail).role).toBe("owner");
  } finally {
    await sql`DELETE FROM trips WHERE id = ${trip.id}`;
    await sql`DELETE FROM users WHERE email IN (${email}, ${ownerEmail})`;
    await sql.end();
  }
});

test("outbox retries persist pending and terminal failures before a successful delivery", async () => {
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  const marker = randomUUID();
  const authorEmail = `outbox-author-${marker}@localhost.invalid`;
  const ownerEmail = `outbox-owner-${marker}@localhost.invalid`;
  const trip = await createTrip(sql, marker);

  try {
    await upsertUserLogin(sql, { name: "Author", email: authorEmail }, future);
    await upsertUserLogin(sql, { name: "Owner", email: ownerEmail }, future);
    const [suggestion] = await sql`
      INSERT INTO suggestions (trip_id, kind, body, author_email, author_name)
      VALUES (${trip.id}, 'comment', 'Outbox contract', ${authorEmail}, 'Author') RETURNING id
    `;
    const [outbox] = await sql`
      INSERT INTO admin_notification_outbox
        (suggestion_id, recipient_email, author_name, contribution_kind, contribution_body, trip_slug, trip_title, attempt_count)
      VALUES (${suggestion.id}, ${ownerEmail}, 'Author', 'comment', 'Outbox contract', ${trip.slug}, ${trip.title}, 3)
      RETURNING id
    `;
    const failure = Object.assign(new Error("provider unavailable"), { code: "RESEND_HTTP_503" });
    const dependencies = { sendImpl: async () => { throw failure; }, logger: { error() {} } };

    await processAdminNotificationOutboxRecords(sql, { outboxId: outbox.id }, dependencies);
    let [stored] = await sql`
      SELECT status, attempt_count, last_error_code, next_attempt_at, lease_expires_at
      FROM admin_notification_outbox WHERE id = ${outbox.id}
    `;
    expect(stored).toMatchObject({ status: "pending", attempt_count: 4, last_error_code: "RESEND_HTTP_503", lease_expires_at: null });
    expect(stored.next_attempt_at.getUTCHours()).toBe(0);
    expect(stored.next_attempt_at.getUTCMinutes()).toBe(17);

    await sql`UPDATE admin_notification_outbox SET next_attempt_at = NOW() WHERE id = ${outbox.id}`;
    await processAdminNotificationOutboxRecords(sql, { outboxId: outbox.id }, dependencies);
    [stored] = await sql`
      SELECT status, attempt_count, last_error_code, lease_expires_at
      FROM admin_notification_outbox WHERE id = ${outbox.id}
    `;
    expect(stored).toEqual({ status: "failed", attempt_count: 5, last_error_code: "RESEND_HTTP_503", lease_expires_at: null });

    await sql`
      UPDATE admin_notification_outbox
      SET status = 'pending', attempt_count = 0, next_attempt_at = NOW(), last_error_code = NULL
      WHERE id = ${outbox.id}
    `;
    await processAdminNotificationOutboxRecords(sql, { outboxId: outbox.id }, {
      sendImpl: async () => "resend-contract-id",
      logger: { error() {} },
    });
    [stored] = await sql`
      SELECT status, attempt_count, resend_message_id, sent_at IS NOT NULL AS sent
      FROM admin_notification_outbox WHERE id = ${outbox.id}
    `;
    expect(stored).toEqual({ status: "sent", attempt_count: 1, resend_message_id: "resend-contract-id", sent: true });
  } finally {
    await sql`DELETE FROM trips WHERE id = ${trip.id}`;
    await sql`DELETE FROM users WHERE email IN (${authorEmail}, ${ownerEmail})`;
    await sql.end();
  }
});
