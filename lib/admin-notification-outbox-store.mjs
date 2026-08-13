import { sendAdminContributionEmail } from "./admin-notification-email.mjs";

export const ADMIN_NOTIFICATION_MAX_ATTEMPTS = 5;
const DEFAULT_BATCH_SIZE = 20;
const DAILY_RETRY_UTC_MINUTES = 17;

export const nextAdminNotificationRetryAt = (now = new Date()) => {
  const next = new Date(now);
  next.setUTCHours(0, DAILY_RETRY_UTC_MINUTES, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
};

const positiveInteger = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

export async function claimAdminNotificationOutboxRecords(
  sql,
  { outboxId = null, limit = DEFAULT_BATCH_SIZE } = {},
) {
  const requestedId = positiveInteger(outboxId);
  const batchSize = Math.min(DEFAULT_BATCH_SIZE, positiveInteger(limit) || DEFAULT_BATCH_SIZE);
  const claimed = await sql`
    UPDATE admin_notification_outbox AS outbox
    SET
      status = 'sending',
      attempt_count = outbox.attempt_count + 1,
      lease_expires_at = NOW() + INTERVAL '5 minutes',
      updated_at = NOW()
    WHERE outbox.id IN (
      SELECT candidate.id
      FROM admin_notification_outbox candidate
      WHERE
        (${requestedId}::BIGINT IS NULL OR candidate.id = ${requestedId})
        AND candidate.attempt_count < ${ADMIN_NOTIFICATION_MAX_ATTEMPTS}
        AND (
          (candidate.status = 'pending' AND candidate.next_attempt_at <= NOW())
          OR (candidate.status = 'sending' AND candidate.lease_expires_at < NOW())
        )
      ORDER BY candidate.next_attempt_at ASC, candidate.id ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING outbox.id, outbox.suggestion_id, outbox.attempt_count
  `;
  if (!claimed.length) return [];

  const claimedIds = claimed.map((row) => String(row.id));
  return sql`
    SELECT
      outbox.id AS outbox_id,
      outbox.attempt_count,
      outbox.suggestion_id,
      outbox.recipient_email,
      outbox.contribution_kind AS kind,
      outbox.contribution_body AS body,
      outbox.author_name,
      outbox.trip_slug,
      outbox.trip_title,
      outbox.activity_title
    FROM admin_notification_outbox outbox
    WHERE outbox.id = ANY(${claimedIds}::BIGINT[])
    ORDER BY outbox.id ASC
  `;
}

const recordDeliverySuccess = async (sql, row, resendMessageId) => {
  await sql`
    UPDATE admin_notification_outbox
    SET
      status = 'sent',
      resend_message_id = ${resendMessageId},
      last_error_code = NULL,
      lease_expires_at = NULL,
      sent_at = NOW(),
      updated_at = NOW()
    WHERE id = ${row.outbox_id} AND status = 'sending'
  `;
};

const recordDeliveryFailure = async (sql, row, errorCode) => {
  const terminal = Number(row.attempt_count) >= ADMIN_NOTIFICATION_MAX_ATTEMPTS;
  const nextAttemptAt = nextAdminNotificationRetryAt();
  await sql`
    UPDATE admin_notification_outbox
    SET
      status = ${terminal ? "failed" : "pending"},
      last_error_code = ${String(errorCode || "RESEND_DELIVERY_ERROR").slice(0, 100)},
      lease_expires_at = NULL,
      next_attempt_at = ${nextAttemptAt},
      updated_at = NOW()
    WHERE id = ${row.outbox_id} AND status = 'sending'
  `;
};

export async function processAdminNotificationOutboxRecords(
  sql,
  options = {},
  {
    env = process.env,
    fetchImpl = globalThis.fetch,
    sendImpl = sendAdminContributionEmail,
    logger = console,
  } = {},
) {
  const rows = await claimAdminNotificationOutboxRecords(sql, options);
  const deliveries = [];

  for (const row of rows) {
    try {
      const resendMessageId = await sendImpl(row, { env, fetchImpl });
      await recordDeliverySuccess(sql, row, resendMessageId);
      deliveries.push({ outboxId: String(row.outbox_id), status: "sent", resendMessageId });
    } catch (error) {
      const errorCode = error?.code || "RESEND_DELIVERY_ERROR";
      await recordDeliveryFailure(sql, row, errorCode);
      logger.error("Admin notification email delivery failed", {
        outboxId: String(row.outbox_id),
        errorCode,
      });
      deliveries.push({ outboxId: String(row.outbox_id), status: "failed", errorCode });
    }
  }

  return deliveries;
}
