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

const notificationRecord = (row) => {
  const shared = {
    id: String(row.id),
    type: row.event_type,
    actor: { name: row.actor_name, image: row.actor_image || null },
    trip: { slug: row.trip_slug, title: row.trip_title },
    createdAt: new Date(row.created_at).toISOString(),
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
  };
  if (row.event_type === "assistant_handoff_created") {
    return {
      ...shared,
      trip: null,
      request: null,
      contribution: null,
      handoff: {
        id: String(row.handoff_id),
        conversationId: String(row.handoff_conversation_id),
        title: row.handoff_conversation_title,
        message: row.handoff_message_body,
      },
      targetUrl: `/admin/assistant/handoffs/${encodeURIComponent(row.handoff_id)}`,
    };
  }
  if (row.event_type === "trip_request_fulfilled") {
    return {
      ...shared,
      request: {
        id: String(row.trip_request_id),
        startDate: String(row.request_start_date),
        endDate: String(row.request_end_date),
        places: Array.isArray(row.request_places) ? row.request_places : [],
      },
      contribution: null,
      handoff: null,
      targetUrl: `/?trip=${encodeURIComponent(row.trip_slug)}`,
    };
  }
  if (["trip_member_added", "trip_member_removed", "trip_leader_received"].includes(row.event_type)) {
    return {
      ...shared,
      request: null,
      contribution: null,
      handoff: null,
      membership: { event: row.event_type },
      targetUrl: row.event_type === "trip_member_removed"
        ? "/"
        : `/?trip=${encodeURIComponent(row.trip_slug)}`,
    };
  }
  return {
    ...shared,
    request: null,
    handoff: null,
    contribution: {
      id: String(row.suggestion_id),
      kind: row.kind,
      body: row.body,
      status: row.status_value || row.current_status,
      hidden: row.visibility_value
        ? row.visibility_value === "hidden"
        : row.current_hidden_at != null,
      activityId: row.activity_id == null ? null : String(row.activity_id),
      activityTitle: row.activity_title || null,
    },
    targetUrl: `/?trip=${encodeURIComponent(row.trip_slug)}#contribution-${row.suggestion_id}`,
  };
};

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
      suggestion.hidden_at AS current_hidden_at,
      suggestion.activity_id,
      activity.title AS activity_title,
      handoff.conversation_id AS handoff_conversation_id,
      handoff_conversation.title AS handoff_conversation_title,
      handoff_message.body AS handoff_message_body,
      TO_CHAR(request.start_date, 'YYYY-MM-DD') AS request_start_date,
      TO_CHAR(request.end_date, 'YYYY-MM-DD') AS request_end_date,
      COALESCE((
        SELECT JSONB_AGG(place.name ORDER BY place.position)
        FROM trip_request_places place
        WHERE place.request_id = request.id
      ), '[]'::JSONB) AS request_places
    FROM notifications notification
    LEFT JOIN trips trip ON trip.id = notification.trip_id
    LEFT JOIN suggestions suggestion ON suggestion.id = notification.suggestion_id
    LEFT JOIN activities activity ON activity.id = suggestion.activity_id
    LEFT JOIN trip_requests request ON request.id = notification.trip_request_id
    LEFT JOIN assistant_handoffs handoff ON handoff.id = notification.handoff_id
    LEFT JOIN assistant_conversations handoff_conversation ON handoff_conversation.id = handoff.conversation_id
    LEFT JOIN assistant_handoff_messages handoff_message ON handoff_message.id = handoff.trigger_message_id
    WHERE notification.recipient_email = ${email}
      AND (
        notification.event_type IN ('trip_request_fulfilled', 'assistant_handoff_created', 'trip_member_added', 'trip_member_removed', 'trip_leader_received')
        OR suggestion.status <> 'rejected'
        OR LOWER(suggestion.author_email) = ${email}
      )
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
    LEFT JOIN suggestions suggestion ON suggestion.id = notification.suggestion_id
    WHERE notification.recipient_email = ${email}
      AND notification.read_at IS NULL
      AND (
        notification.event_type IN ('trip_request_fulfilled', 'assistant_handoff_created', 'trip_member_added', 'trip_member_removed', 'trip_leader_received')
        OR suggestion.status <> 'rejected'
        OR LOWER(suggestion.author_email) = ${email}
      )
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
    LEFT JOIN suggestions suggestion ON suggestion.id = notification.suggestion_id
    WHERE notification.recipient_email = ${email}
      AND notification.read_at IS NULL
      AND (
        notification.event_type IN ('trip_request_fulfilled', 'assistant_handoff_created', 'trip_member_added', 'trip_member_removed', 'trip_leader_received')
        OR suggestion.status <> 'rejected'
        OR LOWER(suggestion.author_email) = ${email}
      )
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
