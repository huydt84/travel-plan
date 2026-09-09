import { sendAssistantHandoffEmail } from "./assistant-handoff-email.mjs";

export const ASSISTANT_HANDOFF_MAX_ATTEMPTS = 5;
const nextRetryAt = (now = new Date()) => { const next = new Date(now); next.setUTCHours(0, 17, 0, 0); if (next <= now) next.setUTCDate(next.getUTCDate() + 1); return next; };

export async function processAssistantHandoffOutboxRecords(sql, { outboxId = null, handoffId = null, limit = 20 } = {}, { env = process.env, fetchImpl = globalThis.fetch, sendImpl = sendAssistantHandoffEmail, logger = console } = {}) {
  const rows = await sql`UPDATE assistant_handoff_email_outbox o SET status='sending',attempt_count=attempt_count+1,
    lease_expires_at=NOW()+INTERVAL '5 minutes',updated_at=NOW() WHERE id IN (
      SELECT id FROM assistant_handoff_email_outbox WHERE (${outboxId}::BIGINT IS NULL OR id=${outboxId})
        AND (${handoffId}::UUID IS NULL OR handoff_id=${handoffId}::UUID)
      AND attempt_count<${ASSISTANT_HANDOFF_MAX_ATTEMPTS} AND ((status='pending' AND next_attempt_at<=NOW()) OR (status='sending' AND lease_expires_at<NOW()))
      ORDER BY next_attempt_at,id LIMIT ${Math.min(20, Math.max(1, Number(limit) || 20))} FOR UPDATE SKIP LOCKED)
    RETURNING *`;
  const results = [];
  for (const row of rows) {
    try {
      const resendId = await sendImpl(row, { env, fetchImpl });
      await sql`UPDATE assistant_handoff_email_outbox SET status='sent',resend_message_id=${resendId},last_error_code=NULL,
        lease_expires_at=NULL,sent_at=NOW(),updated_at=NOW() WHERE id=${row.id} AND status='sending'`;
      results.push({ outboxId: String(row.id), status: "sent", resendMessageId: resendId });
    } catch (error) {
      const terminal = Number(row.attempt_count) >= ASSISTANT_HANDOFF_MAX_ATTEMPTS;
      const code = String(error?.code || "RESEND_DELIVERY_ERROR").slice(0, 100);
      await sql`UPDATE assistant_handoff_email_outbox SET status=${terminal ? "failed" : "pending"},last_error_code=${code},
        lease_expires_at=NULL,next_attempt_at=${nextRetryAt()},updated_at=NOW() WHERE id=${row.id} AND status='sending'`;
      logger.error("Assistant handoff email delivery failed", { outboxId: String(row.id), errorCode: code });
      results.push({ outboxId: String(row.id), status: "failed", errorCode: code });
    }
  }
  return results;
}
