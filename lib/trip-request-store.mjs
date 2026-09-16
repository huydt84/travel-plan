const normalizeEmail = (value) => typeof value === "string" ? value.trim().toLowerCase() : "";

const requestError = (code, message) => Object.assign(new Error(message), { code });

const tripRequestRecord = (row) => ({
  id: String(row.id),
  requester: {
    email: row.requester_email,
    name: row.requester_name || row.requester_email?.split("@")[0] || "Người dùng",
  },
  startDate: String(row.start_date),
  endDate: String(row.end_date),
  places: Array.isArray(row.places) ? row.places : [],
  sources: Array.isArray(row.sources) ? row.sources : [],
  notes: row.notes || "",
  state: row.trip_slug ? "fulfilled" : row.state,
  decisionReason: row.decision_reason || "",
  reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
  reviewedBy: row.reviewed_by || null,
  trip: row.trip_slug ? { slug: row.trip_slug, title: row.trip_title } : null,
  attachedAt: row.attached_at ? new Date(row.attached_at).toISOString() : null,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export async function listTripRequestRecords(sql, { requesterEmail = null, requestId = null } = {}) {
  const email = requesterEmail == null ? null : normalizeEmail(requesterEmail);
  const rows = await sql`
    SELECT
      request.*,
      TO_CHAR(request.start_date, 'YYYY-MM-DD') AS start_date,
      TO_CHAR(request.end_date, 'YYYY-MM-DD') AS end_date,
      COALESCE(NULLIF(requester.display_name, ''), requester.name) AS requester_name,
      fulfillment.attached_at,
      trip.slug AS trip_slug,
      trip.title AS trip_title,
      COALESCE((
        SELECT JSONB_AGG(place.name ORDER BY place.position)
        FROM trip_request_places place
        WHERE place.request_id = request.id
      ), '[]'::JSONB) AS places,
      COALESCE((
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT('label', source.label, 'url', source.url) ORDER BY source.position)
        FROM trip_request_sources source
        WHERE source.request_id = request.id
      ), '[]'::JSONB) AS sources
    FROM trip_requests request
    JOIN users requester ON requester.email = request.requester_email
    LEFT JOIN trip_request_fulfillments fulfillment ON fulfillment.request_id = request.id
    LEFT JOIN trips trip ON trip.id = fulfillment.trip_id
    WHERE (${email}::TEXT IS NULL OR request.requester_email = ${email})
      AND (${requestId}::BIGINT IS NULL OR request.id = ${requestId})
    ORDER BY request.created_at DESC, request.id DESC
  `;
  return rows.map(tripRequestRecord);
}

export async function countOpenTripRequestRecords(sql) {
  const [row] = await sql`
    SELECT COUNT(*)::INTEGER AS count
    FROM trip_requests request
    LEFT JOIN trip_request_fulfillments fulfillment ON fulfillment.request_id = request.id
    WHERE request.state = 'open' AND fulfillment.request_id IS NULL
  `;
  return Number(row?.count || 0);
}

async function readRequest(sql, requestId, requesterEmail = null) {
  const [request] = await listTripRequestRecords(sql, { requestId, requesterEmail });
  if (!request) throw requestError("TRIP_REQUEST_NOT_FOUND", "Không tìm thấy yêu cầu chuyến đi");
  return request;
}

export async function createTripRequestRecord(sql, { requesterEmail, input }) {
  const email = normalizeEmail(requesterEmail);
  const results = await sql.transaction((tx) => [
    tx`
      INSERT INTO trip_requests (requester_email, start_date, end_date, notes)
      VALUES (${email}, ${input.startDate}, ${input.endDate}, ${input.notes})
      RETURNING id
    `,
    tx`
      INSERT INTO trip_request_places (request_id, position, name)
      SELECT CURRVAL(pg_get_serial_sequence('trip_requests', 'id')), place.ordinality - 1, place.value
      FROM JSONB_ARRAY_ELEMENTS_TEXT(${JSON.stringify(input.places)}::JSONB) WITH ORDINALITY AS place(value, ordinality)
    `,
    tx`
      INSERT INTO trip_request_sources (request_id, position, label, url)
      SELECT CURRVAL(pg_get_serial_sequence('trip_requests', 'id')), source.ordinality - 1, source.label, source.url
      FROM ROWS FROM (JSONB_TO_RECORDSET(${JSON.stringify(input.sources)}::JSONB) AS (label TEXT, url TEXT))
        WITH ORDINALITY AS source(label, url, ordinality)
    `,
  ], { isolationLevel: "Serializable" });
  const requestId = results[0][0]?.id;
  return readRequest(sql, requestId, email);
}

export async function updateTripRequestRecord(sql, { requestId, requesterEmail, input }) {
  const email = normalizeEmail(requesterEmail);
  const results = await sql.transaction((tx) => [
    tx`
      UPDATE trip_requests
      SET start_date = ${input.startDate}, end_date = ${input.endDate}, notes = ${input.notes}, updated_at = NOW()
      WHERE id = ${requestId} AND requester_email = ${email} AND state = 'open'
        AND NOT EXISTS (SELECT 1 FROM trip_request_fulfillments WHERE request_id = trip_requests.id)
      RETURNING id
    `,
    tx`
      DELETE FROM trip_request_places place
      USING trip_requests request
      WHERE place.request_id = request.id AND request.id = ${requestId}
        AND request.requester_email = ${email} AND request.state = 'open'
        AND NOT EXISTS (SELECT 1 FROM trip_request_fulfillments WHERE request_id = request.id)
    `,
    tx`
      INSERT INTO trip_request_places (request_id, position, name)
      SELECT request.id, place.ordinality - 1, place.value
      FROM trip_requests request
      CROSS JOIN JSONB_ARRAY_ELEMENTS_TEXT(${JSON.stringify(input.places)}::JSONB) WITH ORDINALITY AS place(value, ordinality)
      WHERE request.id = ${requestId} AND request.requester_email = ${email} AND request.state = 'open'
        AND NOT EXISTS (SELECT 1 FROM trip_request_fulfillments WHERE request_id = request.id)
    `,
    tx`
      DELETE FROM trip_request_sources source
      USING trip_requests request
      WHERE source.request_id = request.id AND request.id = ${requestId}
        AND request.requester_email = ${email} AND request.state = 'open'
        AND NOT EXISTS (SELECT 1 FROM trip_request_fulfillments WHERE request_id = request.id)
    `,
    tx`
      INSERT INTO trip_request_sources (request_id, position, label, url)
      SELECT request.id, source.ordinality - 1, source.label, source.url
      FROM trip_requests request
      CROSS JOIN ROWS FROM (JSONB_TO_RECORDSET(${JSON.stringify(input.sources)}::JSONB) AS (label TEXT, url TEXT))
        WITH ORDINALITY AS source(label, url, ordinality)
      WHERE request.id = ${requestId} AND request.requester_email = ${email} AND request.state = 'open'
        AND NOT EXISTS (SELECT 1 FROM trip_request_fulfillments WHERE request_id = request.id)
    `,
  ], { isolationLevel: "Serializable" });
  if (!results[0].length) {
    const existing = await readRequest(sql, requestId, email);
    throw requestError("TRIP_REQUEST_STATE_CONFLICT", `Không thể sửa yêu cầu đang ở trạng thái ${existing.state}`);
  }
  return readRequest(sql, requestId, email);
}

export async function changeOwnTripRequestState(sql, { requestId, requesterEmail, action }) {
  const email = normalizeEmail(requesterEmail);
  const from = action === "withdraw" ? "open" : "withdrawn";
  const to = action === "withdraw" ? "withdrawn" : "open";
  const rows = await sql`
    UPDATE trip_requests
    SET state = ${to}, decision_reason = '', reviewed_at = NULL, reviewed_by = NULL, updated_at = NOW()
    WHERE id = ${requestId} AND requester_email = ${email} AND state = ${from}
      AND NOT EXISTS (SELECT 1 FROM trip_request_fulfillments WHERE request_id = trip_requests.id)
    RETURNING id
  `;
  if (!rows.length) {
    const existing = await readRequest(sql, requestId, email);
    throw requestError("TRIP_REQUEST_STATE_CONFLICT", `Không thể ${action === "withdraw" ? "rút" : "khôi phục"} yêu cầu đang ở trạng thái ${existing.state}`);
  }
  return readRequest(sql, requestId, email);
}

export async function changeAdminTripRequestState(sql, { requestId, actorEmail, action, reason = "" }) {
  const from = action === "decline" ? "open" : "declined";
  const to = action === "decline" ? "declined" : "open";
  const rows = await sql`
    UPDATE trip_requests
    SET state = ${to}, decision_reason = ${action === "decline" ? reason : ""},
        reviewed_at = ${action === "decline" ? new Date().toISOString() : null},
        reviewed_by = ${action === "decline" ? normalizeEmail(actorEmail) : null}, updated_at = NOW()
    WHERE id = ${requestId} AND state = ${from}
      AND NOT EXISTS (SELECT 1 FROM trip_request_fulfillments WHERE request_id = trip_requests.id)
    RETURNING id
  `;
  if (!rows.length) {
    const existing = await readRequest(sql, requestId);
    throw requestError("TRIP_REQUEST_STATE_CONFLICT", `Không thể cập nhật yêu cầu đang ở trạng thái ${existing.state}`);
  }
  return readRequest(sql, requestId);
}

export async function attachTripRequestRecord(sql, { requestId, tripSlug, actor }) {
  const rows = await sql`
    WITH target AS (
      SELECT request.id, request.requester_email, trip.id AS trip_id
      FROM trip_requests request
      JOIN trips trip ON trip.slug = ${tripSlug}
      WHERE request.id = ${requestId} AND request.state = 'open'
    ), attached AS (
      INSERT INTO trip_request_fulfillments (request_id, trip_id, attached_by)
      SELECT id, trip_id, ${normalizeEmail(actor.email)} FROM target
      ON CONFLICT (request_id) DO UPDATE SET
        trip_id = EXCLUDED.trip_id, attached_by = EXCLUDED.attached_by, attached_at = NOW()
      WHERE trip_request_fulfillments.trip_id <> EXCLUDED.trip_id
      RETURNING request_id, trip_id
    ), removed_notifications AS (
      DELETE FROM notifications notification
      USING attached
      WHERE notification.trip_request_id = attached.request_id
      RETURNING notification.id
    ), membership AS (
      INSERT INTO trip_participants (trip_id, user_email, role, added_by_email, joined_at, last_participated_at)
      SELECT attached.trip_id, target.requester_email, 'member', ${normalizeEmail(actor.email)}, NOW(), NOW()
      FROM target JOIN attached ON attached.request_id = target.id
      ON CONFLICT (trip_id, user_email) DO NOTHING
      RETURNING trip_id, user_email
    ), created_notification AS (
      INSERT INTO notifications (
        recipient_email, trip_id, suggestion_id, trip_request_id, event_type,
        actor_name, actor_image, status_value, visibility_value
      )
      SELECT target.requester_email, attached.trip_id, NULL, attached.request_id,
        'trip_request_fulfilled', ${actor.name}, ${actor.image}, NULL, NULL
      FROM target JOIN attached ON attached.request_id = target.id
      ON CONFLICT DO NOTHING
      RETURNING id
    ), audit_event AS (
      INSERT INTO trip_audit_events (
        trip_id, trip_slug, trip_title, actor_email, actor_name, actor_role,
        source, action, entity_type, entity_id, after_value
      )
      SELECT trip.id, trip.slug, trip.title, ${normalizeEmail(actor.email)}, ${actor.name},
        ${actor.isOwner ? "owner" : actor.isAdmin ? "admin" : "member"}, 'web',
        'trip_request.attached', 'trip_request', target.id::TEXT,
        jsonb_build_object('requestId', target.id, 'requesterEmail', target.requester_email)
      FROM target JOIN attached ON attached.request_id=target.id JOIN trips trip ON trip.id=attached.trip_id
      RETURNING id
    )
    SELECT request_id FROM attached
  `;
  if (!rows.length) {
    const existing = await readRequest(sql, requestId);
    if (existing.state !== "open" && existing.state !== "fulfilled") {
      throw requestError("TRIP_REQUEST_STATE_CONFLICT", `Không thể gắn lịch cho yêu cầu đang ở trạng thái ${existing.state}`);
    }
    const trips = await sql`SELECT slug FROM trips WHERE slug = ${tripSlug} LIMIT 1`;
    if (!trips.length) throw requestError("TRIP_NOT_FOUND", `Trip not found: ${tripSlug}`);
    if (existing.trip?.slug !== tripSlug) {
      throw requestError("TRIP_REQUEST_STATE_CONFLICT", "Không thể gắn lịch cho yêu cầu này");
    }
  }
  return readRequest(sql, requestId);
}

export async function detachTripRequestRecord(sql, { requestId, actor }) {
  const results = await sql.transaction((tx) => [
    tx`
      WITH target AS (
        SELECT fulfillment.request_id, fulfillment.trip_id, trip.slug, trip.title, request.requester_email
        FROM trip_request_fulfillments fulfillment
        JOIN trips trip ON trip.id = fulfillment.trip_id
        JOIN trip_requests request ON request.id = fulfillment.request_id
        WHERE fulfillment.request_id = ${requestId}
        FOR UPDATE OF fulfillment
      ), removed AS (
        DELETE FROM trip_request_fulfillments fulfillment
        USING target
        WHERE fulfillment.request_id = target.request_id
        RETURNING fulfillment.request_id
      ), audit AS (
        INSERT INTO trip_audit_events (
          trip_id, trip_slug, trip_title, actor_email, actor_name, actor_role,
          source, action, entity_type, entity_id, before_value
        )
        SELECT target.trip_id, target.slug, target.title, ${normalizeEmail(actor.email)}, ${actor.name},
          ${actor.isOwner ? "owner" : actor.isAdmin ? "admin" : "member"}, 'web',
          'trip_request.detached', 'trip_request', target.request_id::TEXT,
          jsonb_build_object('requestId', target.request_id, 'requesterEmail', target.requester_email)
        FROM target JOIN removed ON removed.request_id = target.request_id
        RETURNING id
      )
      SELECT request_id FROM removed
    `,
    tx`DELETE FROM notifications WHERE trip_request_id = ${requestId}`,
  ], { isolationLevel: "Serializable" });
  if (!results[0].length) {
    await readRequest(sql, requestId);
    throw requestError("TRIP_REQUEST_STATE_CONFLICT", "Yêu cầu chưa được gắn với lịch trình");
  }
  return readRequest(sql, requestId);
}

export async function createTripForRequestRecord(sql, { requestId, trip, actor }) {
  const rows = await sql`
    WITH target AS (
      SELECT id, requester_email
      FROM trip_requests request
      WHERE id = ${requestId} AND state = 'open'
        AND NOT EXISTS (SELECT 1 FROM trip_request_fulfillments WHERE request_id = request.id)
      FOR UPDATE
    ), created_trip AS (
      INSERT INTO trips (slug, title, trip_date, end_date, timezone, location, currency)
      SELECT ${trip.slug}, ${trip.title}, ${trip.startDate}, ${trip.endDate}, ${trip.timezone}, ${trip.location}, ${trip.currency || "JPY"}
      FROM target
      RETURNING id, slug, title, trip_date, end_date, timezone, location, currency
    ), attached AS (
      INSERT INTO trip_request_fulfillments (request_id, trip_id, attached_by)
      SELECT target.id, created_trip.id, ${normalizeEmail(actor.email)}
      FROM target CROSS JOIN created_trip
      RETURNING request_id, trip_id
    ), membership AS (
      INSERT INTO trip_participants (trip_id, user_email, role, added_by_email, joined_at, last_participated_at)
      SELECT created_trip.id, target.requester_email, 'leader', ${normalizeEmail(actor.email)}, NOW(), NOW()
      FROM target CROSS JOIN created_trip
      RETURNING trip_id, user_email
    ), created_notification AS (
      INSERT INTO notifications (
        recipient_email, trip_id, suggestion_id, trip_request_id, event_type,
        actor_name, actor_image, status_value, visibility_value
      )
      SELECT target.requester_email, created_trip.id, NULL, target.id,
        'trip_request_fulfilled', ${actor.name}, ${actor.image}, NULL, NULL
      FROM target CROSS JOIN created_trip
      RETURNING id
    ), audit_event AS (
      INSERT INTO trip_audit_events (
        trip_id, trip_slug, trip_title, actor_email, actor_name, actor_role,
        source, action, entity_type, entity_id, after_value
      )
      SELECT created_trip.id, created_trip.slug, created_trip.title, ${normalizeEmail(actor.email)}, ${actor.name},
        ${actor.isOwner ? "owner" : actor.isAdmin ? "admin" : "member"}, 'web',
        'trip.created_from_request', 'trip_request', target.id::TEXT,
        jsonb_build_object('requestId', target.id, 'leaderEmail', target.requester_email, 'currency', created_trip.currency)
      FROM target CROSS JOIN created_trip
      RETURNING id
    )
    SELECT slug, title, TO_CHAR(trip_date, 'YYYY-MM-DD') AS start_date,
      TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date, timezone, location, currency
    FROM created_trip
  `;
  if (!rows.length) {
    const existing = await readRequest(sql, requestId);
    throw requestError("TRIP_REQUEST_STATE_CONFLICT", `Không thể tạo lịch cho yêu cầu đang ở trạng thái ${existing.state}`);
  }
  const row = rows[0];
  return {
    slug: row.slug,
    title: row.title,
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    timezone: row.timezone,
    location: row.location,
  };
}
