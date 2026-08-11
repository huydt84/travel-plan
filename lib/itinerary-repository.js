import { getSql } from "./db";
import { ValidationError } from "./validation";

const timeLabel = (value) => String(value).slice(0, 5);

const tripRecord = (trip) => ({
  slug: trip.slug,
  title: trip.title,
  date: String(trip.trip_date),
  timezone: trip.timezone,
  location: trip.location,
});

const sourceRecord = (source) => ({
  number: source.source_number,
  title: source.title,
  host: source.host,
  url: source.url,
});

const notFound = (code, message) => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

export async function getItinerary(slug) {
  const sql = getSql();
  const trips = await sql`
    SELECT id, slug, title, TO_CHAR(trip_date, 'YYYY-MM-DD') AS trip_date, timezone, location
    FROM trips
    WHERE slug = ${slug}
    LIMIT 1
  `;

  if (!trips.length) {
    const error = new Error(`Trip not found: ${slug}`);
    error.code = "TRIP_NOT_FOUND";
    throw error;
  }

  const trip = trips[0];
  const [sourceRows, activityRows] = await Promise.all([
    sql`
      SELECT source_number, title, host, url
      FROM sources
      WHERE trip_id = ${trip.id}
      ORDER BY source_number
    `,
    sql`
      SELECT
        a.id,
        a.sort_order,
        a.start_time,
        a.end_time,
        a.display_end,
        a.type,
        a.icon,
        a.title,
        a.detail,
        COALESCE(
          ARRAY_AGG(s.source_number ORDER BY s.source_number)
            FILTER (WHERE s.source_number IS NOT NULL),
          ARRAY[]::INTEGER[]
        ) AS refs
      FROM activities a
      LEFT JOIN activity_sources activity_source ON activity_source.activity_id = a.id
      LEFT JOIN sources s ON s.id = activity_source.source_id
      WHERE a.trip_id = ${trip.id}
      GROUP BY a.id
      ORDER BY a.start_time, a.sort_order
    `,
  ]);

  return {
    trip: tripRecord(trip),
    sources: sourceRows.map(sourceRecord),
    itinerary: activityRows.map((activity) => ({
      id: String(activity.id),
      start: timeLabel(activity.start_time),
      end: timeLabel(activity.end_time),
      displayEnd: activity.display_end,
      type: activity.type,
      icon: activity.icon,
      title: activity.title,
      detail: activity.detail,
      refs: activity.refs,
    })),
  };
}

export async function listTrips() {
  const sql = getSql();
  const rows = await sql`
    SELECT
      t.slug,
      t.title,
      TO_CHAR(t.trip_date, 'YYYY-MM-DD') AS trip_date,
      t.timezone,
      t.location,
      COUNT(a.id)::INTEGER AS schedule_count
    FROM trips t
    LEFT JOIN activities a ON a.trip_id = t.id
    GROUP BY t.id
    ORDER BY t.trip_date DESC, t.id DESC
  `;
  return rows.map((row) => ({ ...tripRecord(row), scheduleCount: row.schedule_count }));
}

export async function createTrip(input) {
  const sql = getSql();
  const [row] = await sql`
    INSERT INTO trips (slug, title, trip_date, timezone, location)
    VALUES (${input.slug}, ${input.title}, ${input.date}, ${input.timezone}, ${input.location})
    RETURNING slug, title, TO_CHAR(trip_date, 'YYYY-MM-DD') AS trip_date, timezone, location
  `;
  return tripRecord(row);
}

export async function updateTrip(slug, input) {
  const sql = getSql();
  const [row] = await sql`
    UPDATE trips
    SET
      slug = COALESCE(${input.slug ?? null}, slug),
      title = COALESCE(${input.title ?? null}, title),
      trip_date = COALESCE(${input.date ?? null}, trip_date),
      timezone = COALESCE(${input.timezone ?? null}, timezone),
      location = COALESCE(${input.location ?? null}, location),
      updated_at = NOW()
    WHERE slug = ${slug}
    RETURNING slug, title, TO_CHAR(trip_date, 'YYYY-MM-DD') AS trip_date, timezone, location
  `;
  if (!row) notFound("TRIP_NOT_FOUND", `Trip not found: ${slug}`);
  return tripRecord(row);
}

export async function deleteTrip(slug) {
  const sql = getSql();
  const rows = await sql`DELETE FROM trips WHERE slug = ${slug} RETURNING id`;
  if (!rows.length) notFound("TRIP_NOT_FOUND", `Trip not found: ${slug}`);
}

export async function createSource(slug, input) {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO sources (trip_id, source_number, title, host, url)
    SELECT
      t.id,
      COALESCE(MAX(s.source_number), 0) + 1,
      ${input.title},
      ${input.host},
      ${input.url}
    FROM trips t
    LEFT JOIN sources s ON s.trip_id = t.id
    WHERE t.slug = ${slug}
    GROUP BY t.id
    RETURNING source_number, title, host, url
  `;
  if (!rows.length) notFound("TRIP_NOT_FOUND", `Trip not found: ${slug}`);
  return sourceRecord(rows[0]);
}

export async function getScheduleItem(slug, activityId) {
  const sql = getSql();
  const rows = await sql`
    SELECT
      a.id,
      a.start_time,
      a.end_time,
      a.display_end,
      a.type,
      a.icon,
      a.title,
      a.detail,
      COALESCE(
        ARRAY_AGG(s.source_number ORDER BY s.source_number)
          FILTER (WHERE s.source_number IS NOT NULL),
        ARRAY[]::INTEGER[]
      ) AS refs
    FROM activities a
    JOIN trips t ON t.id = a.trip_id
    LEFT JOIN activity_sources activity_source ON activity_source.activity_id = a.id
    LEFT JOIN sources s ON s.id = activity_source.source_id
    WHERE t.slug = ${slug} AND a.id = ${activityId}
    GROUP BY a.id
  `;
  if (!rows.length) notFound("SCHEDULE_NOT_FOUND", `Schedule item not found: ${activityId}`);
  return scheduleRecord(rows[0]);
}

export async function createScheduleItem(slug, input) {
  const sql = getSql();
  const tripId = await getTripId(sql, slug);
  const sourceIds = await resolveSourceIds(sql, tripId, input.refs);
  const itemKey = await nextItemKey(sql, tripId, input.title);
  const [row] = await sql`
    INSERT INTO activities (trip_id, item_key, sort_order, start_time, end_time, display_end, type, icon, title, detail)
    SELECT ${tripId}, ${itemKey}, COALESCE(MAX(sort_order), -1) + 1, ${input.start}, ${input.end}, ${input.displayEnd}, ${input.type}, ${input.icon}, ${input.title}, ${input.detail}
    FROM activities
    WHERE trip_id = ${tripId}
    RETURNING id
  `;
  await replaceActivitySources(sql, row.id, sourceIds);
  return getScheduleItem(slug, row.id);
}

export async function updateScheduleItem(slug, activityId, input) {
  const sql = getSql();
  const existing = await getScheduleItem(slug, activityId);
  const finalStart = input.start ?? existing.start;
  const finalEnd = input.end ?? existing.end;
  if (finalEnd <= finalStart) {
    throw new ValidationError("end must be later than start");
  }

  const tripId = await getTripId(sql, slug);
  const sourceIds = input.refs === undefined ? null : await resolveSourceIds(sql, tripId, input.refs);
  const hasDisplayEnd = input.displayEnd !== undefined;
  const rows = await sql`
    UPDATE activities
    SET
      start_time = COALESCE(${input.start ?? null}, start_time),
      end_time = COALESCE(${input.end ?? null}, end_time),
      display_end = CASE WHEN ${hasDisplayEnd} THEN ${input.displayEnd ?? null} ELSE display_end END,
      type = COALESCE(${input.type ?? null}, type),
      icon = COALESCE(${input.icon ?? null}, icon),
      title = COALESCE(${input.title ?? null}, title),
      detail = COALESCE(${input.detail ?? null}, detail)
    WHERE id = ${activityId} AND trip_id = ${tripId}
    RETURNING id
  `;
  if (!rows.length) notFound("SCHEDULE_NOT_FOUND", `Schedule item not found: ${activityId}`);
  if (sourceIds) await replaceActivitySources(sql, activityId, sourceIds);
  return getScheduleItem(slug, activityId);
}

export async function deleteScheduleItem(slug, activityId) {
  const sql = getSql();
  const rows = await sql`
    DELETE FROM activities
    USING trips
    WHERE activities.trip_id = trips.id AND trips.slug = ${slug} AND activities.id = ${activityId}
    RETURNING activities.id
  `;
  if (!rows.length) notFound("SCHEDULE_NOT_FOUND", `Schedule item not found: ${activityId}`);
}

const scheduleRecord = (row) => ({
  id: String(row.id),
  start: timeLabel(row.start_time),
  end: timeLabel(row.end_time),
  displayEnd: row.display_end,
  type: row.type,
  icon: row.icon,
  title: row.title,
  detail: row.detail,
  refs: row.refs,
});

const getTripId = async (sql, slug) => {
  const rows = await sql`SELECT id FROM trips WHERE slug = ${slug} LIMIT 1`;
  if (!rows.length) notFound("TRIP_NOT_FOUND", `Trip not found: ${slug}`);
  return rows[0].id;
};

const resolveSourceIds = async (sql, tripId, refs = []) => {
  if (!refs.length) return [];
  const rows = await sql`
    SELECT id, source_number FROM sources
    WHERE trip_id = ${tripId} AND source_number = ANY(${refs}::integer[])
  `;
  if (rows.length !== refs.length) {
    const error = new Error("One or more refs do not belong to this trip");
    error.code = "INVALID_SOURCE_REFS";
    throw error;
  }
  return rows.map((row) => row.id);
};

const replaceActivitySources = async (sql, activityId, sourceIds) => {
  await sql`DELETE FROM activity_sources WHERE activity_id = ${activityId}`;
  for (const sourceId of sourceIds) {
    await sql`INSERT INTO activity_sources (activity_id, source_id) VALUES (${activityId}, ${sourceId})`;
  }
};

const keyFromTitle = (title) => title
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "")
  .slice(0, 100) || "activity";

const nextItemKey = async (sql, tripId, title) => {
  const base = keyFromTitle(title);
  const rows = await sql`
    SELECT item_key FROM activities
    WHERE trip_id = ${tripId} AND item_key IS NOT NULL
  `;
  const existing = new Set(rows.map((row) => row.item_key));
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
};
