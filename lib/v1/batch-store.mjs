import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { AssistantFault } from "./errors.mjs";

export const stableJson = (value) => JSON.stringify(value, (_key, nested) => nested && typeof nested === "object" && !Array.isArray(nested)
  ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b))) : nested);
const digest = (value) => createHash("sha256").update(stableJson(value)).digest("hex");
const tokenFor = (a, email, secret) => createHmac("sha256", secret).update(stableJson({ id: a.id, email, digest: a.digest, expiresAt: new Date(a.expires_at).toISOString() })).digest("base64url");
const publicAction = (a, email, secret) => ({ id: String(a.id), turnId: String(a.turn_id), segment: a.segment,
  preview: a.preview, citations: a.citations, status: a.status, receipt: a.receipt, digest: a.digest,
  expiresAt: new Date(a.expires_at).toISOString(),
  confirmationToken: secret && a.status === "pending" && new Date(a.expires_at) > new Date() ? tokenFor(a, email, secret) : null,
});

export function createBatchStore(sql, secret = null) {
  const get = async (id, email) => {
    const [row] = await sql`SELECT a.* FROM assistant_actions a JOIN assistant_turns t ON t.id=a.turn_id
      JOIN assistant_conversations c ON c.id=t.conversation_id WHERE a.id=${id}::UUID AND c.owner_email=${email}`;
    if (!row) throw new AssistantFault("ACTION_NOT_FOUND", "Không tìm thấy nhóm thay đổi", { status: 404 });
    return row;
  };
  return {
    async list(turnIds, email) {
      if (!turnIds.length) return [];
      const rows = await sql`SELECT a.* FROM assistant_actions a JOIN assistant_turns t ON t.id=a.turn_id
        JOIN assistant_conversations c ON c.id=t.conversation_id WHERE t.id=ANY(${turnIds}::UUID[]) AND c.owner_email=${email} ORDER BY a.created_at,a.id`;
      return rows.map((a) => publicAction(a, email, secret));
    },
    async stage({ turnId, segment = 0, call, compiled, citations, usedContext, lifetimeMs, email }) {
      const id = randomUUID(), expiresAt = new Date(Date.now() + lifetimeMs).toISOString();
      const hash = digest({ call, ...compiled, expiresAt, email, turnId, segment });
      const [row] = await sql`WITH paused AS (
        UPDATE assistant_turns SET status='awaiting_approval',lease_expires_at=NULL,output_text=${compiled.preview.summary + '. Chưa lưu thay đổi. Hãy kiểm tra và phê duyệt.'},
          citations=${JSON.stringify(citations)}::JSONB,used_context=${JSON.stringify(usedContext)}::JSONB
        WHERE id=${turnId}::UUID AND segment=${segment} AND status='running' AND lease_expires_at>NOW() RETURNING id
      ) INSERT INTO assistant_actions(id,turn_id,segment,call_id,tool_name,arguments,operations,revisions,preview,citations,digest,expires_at)
        SELECT ${id}::UUID,id,${segment},${call.id},'apply_changes',${JSON.stringify(call.arguments)}::JSONB,${JSON.stringify(compiled.operations)}::JSONB,
          ${JSON.stringify(compiled.revisions)}::JSONB,${JSON.stringify(compiled.preview)}::JSONB,${JSON.stringify(citations)}::JSONB,${hash},${expiresAt}::TIMESTAMPTZ FROM paused RETURNING *`;
      if (!row) throw new AssistantFault("TURN_INTERRUPTED", "Yêu cầu đã dừng", { status: 409 });
      return publicAction(row, email, secret);
    },
    async approve(id, email, token) {
      const row = await get(id, email);
      const expected = tokenFor(row, email, secret);
      if (typeof token !== "string" || Buffer.byteLength(token) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(token), Buffer.from(expected)))
        throw new AssistantFault("CONFIRMATION_INVALID", "Phê duyệt không hợp lệ", { status: 403 });
      const [result] = await sql`SELECT execute_assistant_action(${id}::UUID,${email},${row.digest}) AS receipt`;
      if (result.receipt.error) throw new AssistantFault(result.receipt.error, ({ ACTION_FAILED: "Không lưu được nhóm thay đổi. Không có thay đổi nào được áp dụng. Hãy tạo lại đề xuất.", ACTION_EXPIRED: "Đề xuất đã hết hạn. Hãy tạo lại.", PLAN_CONFLICT: "Dữ liệu đã thay đổi. Hãy tạo lại đề xuất.", ACTION_RESOLVED: "Nhóm thay đổi đã được xử lý." })[result.receipt.error], { status: 409 });
      return { receipt: result.receipt, turnId: String(row.turn_id) };
    },
    async reject(id, email) {
      const row = await get(id, email);
      await sql.transaction((tx) => [
        tx`SELECT id FROM assistant_turns WHERE id=${row.turn_id}::UUID FOR UPDATE`,
        tx`UPDATE assistant_actions SET status='rejected',decided_at=NOW() WHERE id=${id}::UUID AND status='pending'`,
        tx`UPDATE assistant_turns SET status='completed',completed_at=NOW(),lease_expires_at=NULL
          WHERE id=${row.turn_id}::UUID AND status='awaiting_approval' AND EXISTS(SELECT 1 FROM assistant_actions WHERE id=${id}::UUID AND status='rejected')`,
      ]);
      return { turnId: String(row.turn_id) };
    },
  };
}
