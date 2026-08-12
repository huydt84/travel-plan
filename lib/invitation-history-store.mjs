const isoTimestamp = (value) => new Date(value).toISOString();
const INVITATION_CLAIM_LEASE_MS = 10 * 60 * 1000;

const serializeInvitationDelivery = (row) => ({
  id: String(row.id),
  requestId: row.request_id,
  inviterEmail: row.inviter_email,
  recipientEmail: row.recipient_email,
  tripSlug: row.trip_slug,
  tripTitle: row.trip_title,
  subject: row.subject,
  status: row.status,
  errorCode: row.error_code || null,
  attemptedAt: isoTimestamp(row.attempted_at),
  sentAt: row.sent_at ? isoTimestamp(row.sent_at) : null,
});

export async function recordInvitationDeliveries(sql, { requestId, inviterEmail, trip, subject, deliveries }, now = new Date()) {
  if (!deliveries?.length) return [];
  const attemptedAt = isoTimestamp(now);
  const rows = await sql.transaction((tx) => deliveries.map((delivery) => tx`
      INSERT INTO invitation_deliveries (
        request_id, inviter_email, recipient_email, trip_id, trip_slug, trip_title, subject,
        status, gmail_message_id, error_code, attempted_at, sent_at
      )
      VALUES (
        ${requestId}, ${inviterEmail}, ${delivery.recipient}, (SELECT id FROM trips WHERE slug = ${trip.slug}),
        ${trip.slug}, ${trip.title}, ${subject},
        ${delivery.status}, ${delivery.gmailMessageId}, ${delivery.errorCode}, ${attemptedAt},
        ${delivery.status === "sent" ? attemptedAt : null}
      )
      ON CONFLICT (request_id, recipient_email) DO UPDATE SET
        inviter_email = EXCLUDED.inviter_email,
        trip_id = EXCLUDED.trip_id,
        trip_slug = EXCLUDED.trip_slug,
        trip_title = EXCLUDED.trip_title,
        subject = EXCLUDED.subject,
        status = EXCLUDED.status,
        gmail_message_id = EXCLUDED.gmail_message_id,
        error_code = EXCLUDED.error_code,
        attempted_at = EXCLUDED.attempted_at,
        sent_at = EXCLUDED.sent_at
      RETURNING id, request_id, inviter_email, recipient_email, trip_slug, trip_title, subject,
        status, error_code, attempted_at, sent_at
    `));
  return rows.flat().map(serializeInvitationDelivery);
}

export async function claimInvitationDeliveries(
  sql,
  { requestId, inviterEmail, recipients, trip, subject },
  now = new Date(),
) {
  if (!recipients?.length) return [];
  const attemptedAt = isoTimestamp(now);
  const leaseExpiredAt = isoTimestamp(new Date(now.getTime() - INVITATION_CLAIM_LEASE_MS));
  const rows = await sql.transaction((tx) => recipients.map((recipient) => tx`
      INSERT INTO invitation_deliveries (
        request_id, inviter_email, recipient_email, trip_id, trip_slug, trip_title, subject,
        status, gmail_message_id, error_code, attempted_at, sent_at
      )
      VALUES (
        ${requestId}, ${inviterEmail}, ${recipient}, (SELECT id FROM trips WHERE slug = ${trip.slug}),
        ${trip.slug}, ${trip.title}, ${subject}, 'sending', NULL, NULL, ${attemptedAt}, NULL
      )
      ON CONFLICT (request_id, recipient_email) DO UPDATE SET
        inviter_email = EXCLUDED.inviter_email,
        trip_id = EXCLUDED.trip_id,
        trip_slug = EXCLUDED.trip_slug,
        trip_title = EXCLUDED.trip_title,
        subject = EXCLUDED.subject,
        status = 'sending',
        gmail_message_id = NULL,
        error_code = NULL,
        attempted_at = EXCLUDED.attempted_at,
        sent_at = NULL
      WHERE invitation_deliveries.status = 'failed'
        OR (
          invitation_deliveries.status = 'sending'
          AND invitation_deliveries.attempted_at < ${leaseExpiredAt}
        )
      RETURNING recipient_email
    `));
  return rows.flat().map((row) => row.recipient_email);
}

export async function listInvitationDeliveries(sql) {
  const rows = await sql`
    SELECT id, request_id, inviter_email, recipient_email, trip_slug, trip_title, subject,
      status, error_code, attempted_at, sent_at
    FROM invitation_deliveries
    WHERE status IN ('sent', 'failed')
    ORDER BY attempted_at DESC, id DESC
    LIMIT 200
  `;
  return rows.map(serializeInvitationDelivery);
}

export async function listInvitationDeliveriesByInviter(sql, { inviterEmail, tripSlug, limit = 20 }) {
  const rows = await sql`
    SELECT id, request_id, inviter_email, recipient_email, trip_slug, trip_title, subject,
      status, error_code, attempted_at, sent_at
    FROM invitation_deliveries
    WHERE status IN ('sent', 'failed')
      AND inviter_email = ${inviterEmail}
      AND trip_slug = ${tripSlug}
    ORDER BY attempted_at DESC, id DESC
    LIMIT ${limit}
  `;
  return rows.map(serializeInvitationDelivery);
}
