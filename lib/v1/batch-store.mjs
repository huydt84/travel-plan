import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { AssistantFault } from "./errors.mjs";
import { prepareBatch } from "./batch-proposal.mjs";
import { sourceDetailsFromUrl } from "../source-fields.mjs";
import { isIsoDate } from "../trip-dates.mjs";
import { batchSchema } from "./batch-schema.mjs";
import { validateSchema } from "./schemas.mjs";
import { isGroundingRedirectUrl } from "./evidence.mjs";

export const stableJson = (value) => JSON.stringify(value, (_key, nested) => nested && typeof nested === "object" && !Array.isArray(nested)
  ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b))) : nested);
const digest = (value) => createHash("sha256").update(stableJson(value)).digest("hex");
const tokenFor = (a, email, secret) => createHmac("sha256", secret).update(stableJson({ id: a.id, email, digest: a.digest, expiresAt: new Date(a.expires_at).toISOString() })).digest("base64url");
const editableFields = {
  trip: ["slug", "title", "startDate", "endDate", "timezone", "location"],
  source: ["title", "url"],
  place: ["name", "address", "latitude", "longitude", "website", "notes"],
  activity: ["startDate", "start", "endDate", "end", "displayEnd", "type", "icon", "title", "detail"],
};
const operationTargetKey = (operation) => {
  const kind = operation.kind.split(".")[0];
  return `${kind}:${operation.kind.endsWith(".create") ? `draft:${operation.draftId}` : `id:${operation.target.id}`}`;
};
const editFault = (code, message, targetKey, field, status = 400) => new AssistantFault(code, message, {
  status, details: { fieldErrors: [{ targetKey, field, message }] },
});
const publicPreview = (action) => {
  const fieldsByTarget = new Map((action.arguments?.operations || []).map((operation) => {
    const kind = operation.kind.split(".")[0];
    const source = operation.kind.endsWith(".create") ? operation.value || {} : operation.set || {};
    return [operationTargetKey(operation), editableFields[kind].filter((field) => Object.hasOwn(source, field))];
  }));
  return {
    ...action.preview,
    changes: (action.preview?.changes || []).map((change) => ({
      ...change,
      editableFields: fieldsByTarget.get(change.targetKey) || [],
    })),
  };
};
const publicAction = (a, email, secret) => ({ id: String(a.id), turnId: String(a.turn_id), segment: a.segment,
  revision: Number(a.revision_number || 0), supersedesActionId: a.supersedes_action_id ? String(a.supersedes_action_id) : null,
  preview: publicPreview(a), citations: a.citations, status: a.status, receipt: a.receipt, digest: a.digest,
  expiresAt: new Date(a.expires_at).toISOString(),
  confirmationToken: secret && a.status === "pending" && new Date(a.expires_at) > new Date() ? tokenFor(a, email, secret) : null,
});

const sameRevisions = (left = {}, right = {}) => stableJson(left) === stableJson(right);

const applyEdits = (argumentsValue, edits) => {
  const next = structuredClone(argumentsValue);
  const seen = new Set();
  for (const edit of edits) {
    const operation = next.operations.find((candidate) => operationTargetKey(candidate) === edit.targetKey);
    if (!operation) throw editFault("EDIT_TARGET_INVALID", "Không tìm thấy trường cần chỉnh sửa", edit.targetKey, edit.field);
    const kind = operation.kind.split(".")[0];
    if (!editableFields[kind].includes(edit.field)) {
      throw editFault("EDIT_FIELD_INVALID", "Trường này không thể chỉnh sửa trực tiếp", edit.targetKey, edit.field);
    }
    const source = operation.kind.endsWith(".create") ? operation.value : operation.set;
    const allowedOnProposal = operation.kind.endsWith(".create") || Object.hasOwn(source, edit.field);
    if (!allowedOnProposal) {
      throw editFault("EDIT_FIELD_INVALID", "Chỉ có thể chỉnh sửa trường đang có trong đề xuất", edit.targetKey, edit.field);
    }
    const key = `${edit.targetKey}:${edit.field}`;
    if (seen.has(key)) throw editFault("EDIT_DUPLICATE", "Mỗi trường chỉ được chỉnh sửa một lần", edit.targetKey, edit.field);
    seen.add(key);
    if (typeof edit.value !== "string" && typeof edit.value !== "number" && edit.value !== null) {
      throw editFault("EDIT_VALUE_INVALID", "Giá trị chỉnh sửa không hợp lệ", edit.targetKey, edit.field);
    }
    const schema = batchSchema.properties.operations.items.oneOf.find((item) => item.properties.kind.const === operation.kind);
    const fieldSchema = (schema.properties.value || schema.properties.set).properties[edit.field];
    try { validateSchema(fieldSchema, edit.value); }
    catch (error) { throw editFault("EDIT_VALUE_INVALID", error.message, edit.targetKey, edit.field); }
    if (["startDate", "endDate"].includes(edit.field) && !isIsoDate(edit.value)) {
      throw editFault("EDIT_VALUE_INVALID", "Ngày không hợp lệ", edit.targetKey, edit.field);
    }
    if (edit.field === "timezone") {
      try { new Intl.DateTimeFormat("vi-VN", { timeZone: edit.value.trim() }); }
      catch { throw editFault("EDIT_VALUE_INVALID", "Múi giờ không hợp lệ", edit.targetKey, edit.field); }
    }
    if (["url", "website"].includes(edit.field) && edit.value?.trim() && !sourceDetailsFromUrl(edit.value)) {
      throw editFault("EDIT_VALUE_INVALID", "URL phải dùng http hoặc https", edit.targetKey, edit.field);
    }
    source[edit.field] = edit.value;
  }
  return next;
};

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
      const rows = await sql`SELECT DISTINCT ON (a.turn_id,a.segment) a.* FROM assistant_actions a JOIN assistant_turns t ON t.id=a.turn_id
        JOIN assistant_conversations c ON c.id=t.conversation_id WHERE t.id=ANY(${turnIds}::UUID[]) AND c.owner_email=${email}
        AND a.status <> 'superseded' ORDER BY a.turn_id,a.segment,a.revision_number DESC,a.created_at DESC,a.id DESC`;
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
    async revise({ id, email, expectedDigest, edits, actor, contextService, lifetimeMs }) {
      const original = await get(id, email);
      if (original.digest !== expectedDigest) throw new AssistantFault("EDIT_STALE", "Đề xuất đã thay đổi. Hãy tải lại trước khi chỉnh sửa.", { status: 409 });
      if (original.status !== "pending") throw new AssistantFault("ACTION_RESOLVED", "Nhóm thay đổi đã được xử lý.", { status: 409 });
      if (new Date(original.expires_at) <= new Date()) throw new AssistantFault("ACTION_EXPIRED", "Đề xuất đã hết hạn. Hãy tạo lại.", { status: 409 });
      if (!Array.isArray(edits) || !edits.length) throw new AssistantFault("EDIT_EMPTY", "Chưa có chỉnh sửa nào", { status: 400 });

      const args = applyEdits(original.arguments, edits);
      const citedUrls = new Set((original.citations || []).map((citation) => sourceDetailsFromUrl(citation.url)?.url).filter(Boolean));
      for (const edit of edits.filter((item) => item.field === "url" && item.targetKey.startsWith("source:"))) {
        const originalOperation = original.arguments.operations.find((operation) => operationTargetKey(operation) === edit.targetKey);
        const revisedOperation = args.operations.find((operation) => operationTargetKey(operation) === edit.targetKey);
        const originalUrl = originalOperation?.value?.url || originalOperation?.set?.url;
        const revisedUrl = revisedOperation?.value?.url || revisedOperation?.set?.url;
        if (originalUrl === revisedUrl) continue;
        const canonical = sourceDetailsFromUrl(revisedUrl);
        if (!canonical || !citedUrls.has(canonical.url)) {
          throw new AssistantFault("EDIT_SOURCE_EVIDENCE_REQUIRED", "URL nguồn mới cần được tra cứu trước khi lưu. Hãy yêu cầu trợ lý nghiên cứu rồi tạo lại đề xuất.", { status: 400 });
        }
      }
      const activityKeys = Object.fromEntries(original.operations.filter((operation) => operation.kind === "activity.create")
        .map((operation) => [`activity:draft:${operation.ref.draftId}`, operation.value.key]));
      const compiled = await prepareBatch({ args, actor, contextService, evidence: original.citations || [], activityKeys });
      if (!sameRevisions(compiled.revisions, original.revisions)) {
        throw new AssistantFault("PLAN_CONFLICT", "Dữ liệu lịch đã thay đổi. Hãy tạo lại đề xuất.", { status: 409 });
      }
      const newId = randomUUID();
      const expiresAt = new Date(Date.now() + lifetimeMs).toISOString();
      const call = { id: original.call_id, arguments: args };
      const nextDigest = digest({ call, ...compiled, expiresAt, email, turnId: String(original.turn_id), segment: original.segment });
      const [result] = await sql`SELECT revise_assistant_action(${id}::UUID,${email},${expectedDigest},
        ${JSON.stringify({ id: newId, arguments: args, ...compiled, digest: nextDigest, expiresAt })}::JSONB) AS action`;
      if (result.action.error) throw new AssistantFault(result.action.error, ({
        PLAN_CONFLICT: "Dữ liệu lịch đã thay đổi. Hãy tạo lại đề xuất.",
        ACTION_EXPIRED: "Đề xuất đã hết hạn. Hãy tạo lại.",
        EDIT_STALE: "Đề xuất đã thay đổi. Hãy tải lại trước khi chỉnh sửa.",
      })[result.action.error] || "Nhóm thay đổi đã được xử lý hoặc không còn hiệu lực.", { status: result.action.error === "ACTION_NOT_FOUND" ? 404 : 409 });
      return publicAction(result.action, email, secret);
    },
    async approve(id, email, token) {
      const row = await get(id, email);
      const expected = tokenFor(row, email, secret);
      if (typeof token !== "string" || Buffer.byteLength(token) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(token), Buffer.from(expected)))
        throw new AssistantFault("CONFIRMATION_INVALID", "Phê duyệt không hợp lệ", { status: 403 });
      if ((row.operations || []).some((operation) => operation.kind?.startsWith("source.") && isGroundingRedirectUrl(operation.value?.url))) {
        throw new AssistantFault("ACTION_SOURCE_INVALID", "Đề xuất chứa URL trung gian của nhà cung cấp và phải được tạo lại", { status: 409 });
      }
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
