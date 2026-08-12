const PERMISSION_STATUSES = new Set(["pending", "approved", "denied", "revoked"]);
export const INVITATION_BATCH_LIMIT = 20;
export const INVITATION_BATCH_WINDOW_MS = 24 * 60 * 60 * 1000;

const textValue = (value) => typeof value === "string" ? value.trim() : "";
const isoTimestamp = (value) => value ? new Date(value).toISOString() : null;

const serializePermission = (row) => row ? ({
  id: String(row.id),
  userEmail: row.user_email,
  userName: row.user_name || row.user_email?.split("@")[0] || "Người dùng",
  status: row.status,
  requestedTripSlug: row.requested_trip_slug,
  requestedTripTitle: row.requested_trip_title,
  requestedAt: isoTimestamp(row.requested_at),
  reviewedAt: isoTimestamp(row.reviewed_at),
  reviewedBy: row.reviewed_by || null,
  decisionReason: row.decision_reason || "",
  updatedAt: isoTimestamp(row.updated_at),
}) : null;

export class InvitationPermissionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export class InvitationRateLimitError extends Error {
  constructor(quota) {
    super("Invitation batch limit reached");
    this.code = "INVITATION_RATE_LIMIT";
    this.quota = quota;
  }
}

export async function getInvitationPermission(sql, userEmail) {
  const email = textValue(userEmail).toLowerCase();
  if (!email) return null;
  const [row] = await sql`
    SELECT permission.*, users.name AS user_name
    FROM invitation_permissions permission
    LEFT JOIN users ON users.email = permission.user_email
    WHERE permission.user_email = ${email}
  `;
  return serializePermission(row);
}

export async function requestInvitationPermission(sql, { userEmail, trip }) {
  const email = textValue(userEmail).toLowerCase();
  if (!email) throw new InvitationPermissionError("AUTH_REQUIRED", "Bạn cần đăng nhập bằng Google");
  const rows = await sql`
    INSERT INTO invitation_permissions (
      user_email, status, requested_trip_slug, requested_trip_title,
      requested_at, reviewed_at, reviewed_by, decision_reason, updated_at
    )
    VALUES (${email}, 'pending', ${trip.slug}, ${trip.title}, NOW(), NULL, NULL, NULL, NOW())
    ON CONFLICT (user_email) DO NOTHING
    RETURNING *, NULL::TEXT AS user_name
  `;
  if (rows[0]) return serializePermission(rows[0]);
  return getInvitationPermission(sql, email);
}

export async function listInvitationPermissions(sql) {
  const rows = await sql`
    SELECT permission.*, users.name AS user_name
    FROM invitation_permissions permission
    LEFT JOIN users ON users.email = permission.user_email
    ORDER BY
      CASE permission.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'denied' THEN 2 ELSE 3 END,
      permission.requested_at DESC,
      permission.id DESC
  `;
  return rows.map(serializePermission);
}

export async function countPendingInvitationPermissions(sql) {
  const [row] = await sql`
    SELECT COUNT(*)::INTEGER AS count
    FROM invitation_permissions
    WHERE status = 'pending'
  `;
  return Number(row?.count || 0);
}

export async function reviewInvitationPermission(sql, { id, action, reviewerEmail, reason = "" }) {
  const status = action === "approve" ? "approved" : action === "deny" ? "denied" : action === "revoke" ? "revoked" : "";
  if (!PERMISSION_STATUSES.has(status) || status === "pending") {
    throw new InvitationPermissionError("INVALID_PERMISSION_ACTION", "Hành động duyệt không hợp lệ");
  }
  const normalizedReason = textValue(reason).slice(0, 300);
  const [row] = await sql`
    UPDATE invitation_permissions
    SET status = ${status}, reviewed_at = NOW(), reviewed_by = ${reviewerEmail},
        decision_reason = ${normalizedReason || null}, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *, NULL::TEXT AS user_name
  `;
  if (!row) throw new InvitationPermissionError("PERMISSION_NOT_FOUND", "Yêu cầu quyền không còn tồn tại");
  return serializePermission(row);
}

export async function getInvitationQuota(sql, inviterEmail, now = new Date()) {
  const windowStart = new Date(now.getTime() - INVITATION_BATCH_WINDOW_MS).toISOString();
  const [row] = await sql`
    SELECT COUNT(*)::INTEGER AS used, MIN(created_at) AS oldest
    FROM invitation_batches
    WHERE inviter_email = ${inviterEmail}
      AND created_at > ${windowStart}
  `;
  const used = Number(row?.used || 0);
  const resetAt = used >= INVITATION_BATCH_LIMIT && row?.oldest
    ? new Date(new Date(row.oldest).getTime() + INVITATION_BATCH_WINDOW_MS).toISOString()
    : null;
  return {
    batchLimit: INVITATION_BATCH_LIMIT,
    batchesUsed: used,
    batchesRemaining: Math.max(0, INVITATION_BATCH_LIMIT - used),
    resetAt,
  };
}

export async function claimInvitationBatch(sql, { requestId, inviterEmail, now = new Date() }) {
  const createdAt = now.toISOString();
  const windowStart = new Date(now.getTime() - INVITATION_BATCH_WINDOW_MS).toISOString();
  const run = async () => {
    const [rows] = await sql.transaction((tx) => [tx`
      WITH existing AS (
        SELECT request_id, inviter_email FROM invitation_batches WHERE request_id = ${requestId}
      ), usage AS (
        SELECT COUNT(*)::INTEGER AS used, MIN(created_at) AS oldest
        FROM invitation_batches
        WHERE inviter_email = ${inviterEmail} AND created_at > ${windowStart}
      ), inserted AS (
        INSERT INTO invitation_batches (request_id, inviter_email, created_at)
        SELECT ${requestId}, ${inviterEmail}, ${createdAt}
        FROM usage
        WHERE NOT EXISTS (SELECT 1 FROM existing) AND usage.used < ${INVITATION_BATCH_LIMIT}
        ON CONFLICT (request_id) DO NOTHING
        RETURNING request_id
      )
      SELECT
        EXISTS (SELECT 1 FROM existing WHERE inviter_email = ${inviterEmail}) OR EXISTS (SELECT 1 FROM inserted) AS allowed,
        EXISTS (SELECT 1 FROM existing WHERE inviter_email <> ${inviterEmail}) AS owner_mismatch,
        (SELECT used FROM usage) + CASE WHEN EXISTS (SELECT 1 FROM inserted) THEN 1 ELSE 0 END AS used,
        (SELECT oldest FROM usage) AS oldest
    `], { isolationLevel: "Serializable" });
    return rows[0];
  };

  let row;
  try {
    row = await run();
  } catch (error) {
    if (error.code !== "40001") throw error;
    row = await run();
  }
  const used = Number(row?.used || 0);
  const quota = {
    batchLimit: INVITATION_BATCH_LIMIT,
    batchesUsed: used,
    batchesRemaining: Math.max(0, INVITATION_BATCH_LIMIT - used),
    resetAt: used >= INVITATION_BATCH_LIMIT && row?.oldest
      ? new Date(new Date(row.oldest).getTime() + INVITATION_BATCH_WINDOW_MS).toISOString()
      : null,
  };
  if (row?.owner_mismatch) {
    throw new InvitationPermissionError("REQUEST_ID_CONFLICT", "Mã lượt gửi đã thuộc về một tài khoản khác");
  }
  if (!row?.allowed) throw new InvitationRateLimitError(quota);
  return quota;
}
