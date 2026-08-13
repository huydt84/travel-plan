const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

const normalizeEmail = (value) => typeof value === "string" ? value.trim().toLowerCase() : "";
const encodedCursor = (row) => Buffer.from(JSON.stringify({
  createdAt: new Date(row.created_at).toISOString(),
  id: String(row.id),
}), "utf8").toString("base64url");

export const parseNotificationLimit = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(MAX_LIMIT, parsed) : DEFAULT_LIMIT;
};

export function parseNotificationCursor(value) {
  if (!value) return { createdAt: null, id: null };
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const date = new Date(parsed.createdAt);
    if (!Number.isFinite(date.getTime()) || !/^\d+$/.test(String(parsed.id))) throw new Error("Invalid cursor");
    return { createdAt: date.toISOString(), id: String(parsed.id) };
  } catch {
    const error = new Error("cursor không hợp lệ");
    error.code = "NOTIFICATION_CURSOR_INVALID";
    throw error;
  }
}

const notificationRecord = (row) => ({
  id: String(row.id),
  type: row.event_type,
  actor: {
    name: row.actor_name,
    image: row.actor_image || null,
  },
  trip: {
    slug: row.trip_slug,
    title: row.trip_title,
  },
  contribution: {
    id: String(row.suggestion_id),
    kind: row.kind,
    body: row.body,
    status: row.status_value || row.current_status,
    activityId: row.activity_id == null ? null : String(row.activity_id),
    activityTitle: row.activity_title || null,
  },
  createdAt: new Date(row.created_at).toISOString(),
  readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
  targetUrl: `/?trip=${encodeURIComponent(row.trip_slug)}#contribution-${row.suggestion_id}`,
});

export async function listNotificationRecords(sql, { recipientEmail, cursor, limit }) {
  const email = normalizeEmail(recipientEmail);
  const pageSize = parseNotificationLimit(limit);
  const parsedCursor = parseNotificationCursor(cursor);
  const rows = await sql`
    SELECT
      notification.*,
      trip.slug AS trip_slug,
      trip.title AS trip_title,
      suggestion.kind,
      suggestion.body,
      suggestion.status AS current_status,
      suggestion.activity_id,
      activity.title AS activity_title
    FROM notifications notification
    JOIN trips trip ON trip.id = notification.trip_id
    JOIN suggestions suggestion ON suggestion.id = notification.suggestion_id
    LEFT JOIN activities activity ON activity.id = suggestion.activity_id
    WHERE notification.recipient_email = ${email}
      AND (suggestion.status <> 'rejected' OR LOWER(suggestion.author_email) = ${email})
      AND (
        ${parsedCursor.createdAt}::TIMESTAMPTZ IS NULL
        OR (notification.created_at, notification.id) < (${parsedCursor.createdAt}::TIMESTAMPTZ, ${parsedCursor.id}::BIGINT)
      )
    ORDER BY notification.created_at DESC, notification.id DESC
    LIMIT ${pageSize + 1}
  `;
  const [countRow] = await sql`
    SELECT COUNT(*)::INTEGER AS count
    FROM notifications notification
    JOIN suggestions suggestion ON suggestion.id = notification.suggestion_id
    WHERE notification.recipient_email = ${email}
      AND notification.read_at IS NULL
      AND (suggestion.status <> 'rejected' OR LOWER(suggestion.author_email) = ${email})
  `;
  const hasMore = rows.length > pageSize;
  const page = rows.slice(0, pageSize);
  return {
    notifications: page.map(notificationRecord),
    unreadCount: Number(countRow?.count || 0),
    nextCursor: hasMore && page.length ? encodedCursor(page.at(-1)) : null,
  };
}

export async function markNotificationRecordRead(sql, { notificationId, recipientEmail }) {
  const email = normalizeEmail(recipientEmail);
  const rows = await sql`
    UPDATE notifications
    SET read_at = COALESCE(read_at, NOW())
    WHERE id = ${notificationId} AND recipient_email = ${email}
    RETURNING id, read_at
  `;
  if (!rows.length) {
    const error = new Error("Không tìm thấy thông báo");
    error.code = "NOTIFICATION_NOT_FOUND";
    throw error;
  }
  const [countRow] = await sql`
    SELECT COUNT(*)::INTEGER AS count
    FROM notifications notification
    JOIN suggestions suggestion ON suggestion.id = notification.suggestion_id
    WHERE notification.recipient_email = ${email}
      AND notification.read_at IS NULL
      AND (suggestion.status <> 'rejected' OR LOWER(suggestion.author_email) = ${email})
  `;
  return {
    id: String(rows[0].id),
    readAt: new Date(rows[0].read_at).toISOString(),
    unreadCount: Number(countRow?.count || 0),
  };
}

export async function markAllNotificationRecordsRead(sql, recipientEmail) {
  const email = normalizeEmail(recipientEmail);
  const rows = await sql`
    UPDATE notifications
    SET read_at = NOW()
    WHERE recipient_email = ${email} AND read_at IS NULL
    RETURNING id
  `;
  return { updated: rows.length, unreadCount: 0 };
}
