import { getSql } from "./db";
import { ValidationError } from "./validation";
import { nextBackboneActivity, resolveActiveItinerary, validateBranchTimeline } from "./schedule-branching.mjs";
import { calendarDayDifference, compareActivityDateTime, validateActivityInterval } from "./trip-dates.mjs";

import { saveScheduleRecord } from "./schedule-store.mjs";
import { slugify as keyFromTitle, reserveItemKey } from "./schedule-keys.mjs";

const timeLabel = (value) => String(value).slice(0, 5);

const tripRecord = (trip) => ({
  slug: trip.slug,
  title: trip.title,
  startDate: String(trip.trip_date),
  endDate: String(trip.end_date),
  timezone: trip.timezone,
  location: trip.location,
  currency: trip.currency,
});

const sourceRecord = (source) => ({
  number: source.source_number,
  title: source.title,
  host: source.host,
  url: source.url,
});

const placeRecord = (place) => ({
  id: String(place.id),
  name: place.name,
  address: place.address,
  latitude: place.latitude,
  longitude: place.longitude,
  website: place.website,
  googlePlaceId: place.google_place_id,
  notes: place.notes,
});

const notFound = (code, message) => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

export async function getItinerary(slug) {
  const sql = getSql();
  const trips = await sql`
    SELECT id, slug, title, TO_CHAR(trip_date, 'YYYY-MM-DD') AS trip_date,
      TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date, timezone, location, currency
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
  const [sourceRows, activityRows, groupRows, branchRows, placeRows] = await Promise.all([
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
        TO_CHAR(a.start_date, 'YYYY-MM-DD') AS start_date,
        a.start_time,
        TO_CHAR(a.end_date, 'YYYY-MM-DD') AS end_date,
        a.end_time,
        a.display_end,
        a.type,
        a.icon,
        a.title,
        a.detail,
        a.branch_id,
        a.place_id,
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
      ORDER BY a.branch_id NULLS FIRST, a.start_date, a.start_time, a.sort_order
    `,
    sql`
      SELECT
        branch_group.id,
        branch_group.item_key,
        branch_group.anchor_activity_id,
        branch_group.title,
        selection.branch_id AS selected_branch_id,
        selection.selected_at
      FROM schedule_branch_groups branch_group
      LEFT JOIN schedule_branch_selections selection ON selection.group_id = branch_group.id
      WHERE branch_group.trip_id = ${trip.id}
      ORDER BY branch_group.id
    `,
    sql`
      SELECT id, group_id, item_key, label, condition_text, sort_order, is_default
      FROM schedule_branches
      WHERE trip_id = ${trip.id}
      ORDER BY group_id, sort_order
    `,
    sql`SELECT id::TEXT, name, address, latitude, longitude, website, google_place_id AS "googlePlaceId", notes FROM saved_places WHERE trip_id=${trip.id} ORDER BY id`,
  ]);

  const activities = activityRows.map(activityRecord);
  const backbone = activities.filter((activity) => activity.branchId == null);
  const branchGroups = groupRows.map((group) => ({
    id: String(group.id),
    key: group.item_key,
    anchorActivityId: group.anchor_activity_id == null ? null : String(group.anchor_activity_id),
    title: group.title,
    selectedBranchId: group.selected_branch_id == null ? null : String(group.selected_branch_id),
    selectedAt: group.selected_at ? new Date(group.selected_at).toISOString() : null,
    branches: branchRows.filter((branch) => String(branch.group_id) === String(group.id)).map((branch) => ({
      id: String(branch.id),
      key: branch.item_key,
      label: branch.label,
      condition: branch.condition_text,
      isDefault: branch.is_default,
      itinerary: activities.filter((activity) => String(activity.branchId) === String(branch.id)),
    })),
  }));

  return {
    trip: tripRecord(trip),
    sources: sourceRows.map(sourceRecord),
    places: placeRows,
    backbone,
    branchGroups,
    itinerary: resolveActiveItinerary(backbone, branchGroups),
  };
}

export async function listTrips() {
  const sql = getSql();
  const rows = await sql`
    SELECT
      t.slug,
      t.title,
      TO_CHAR(t.trip_date, 'YYYY-MM-DD') AS trip_date,
      TO_CHAR(t.end_date, 'YYYY-MM-DD') AS end_date,
      t.timezone,
      t.location,
      t.currency,
      COUNT(DISTINCT a.id) FILTER (
        WHERE a.branch_id IS NULL OR a.branch_id = selection.branch_id
      )::INTEGER AS schedule_count,
      COUNT(DISTINCT branch_group.id)::INTEGER AS branch_group_count
    FROM trips t
    LEFT JOIN activities a ON a.trip_id = t.id
    LEFT JOIN schedule_branch_groups branch_group ON branch_group.trip_id = t.id
    LEFT JOIN schedule_branch_selections selection ON selection.group_id = branch_group.id
    GROUP BY t.id
    ORDER BY t.trip_date DESC, t.id DESC
  `;
  return rows.map((row) => ({
    ...tripRecord(row),
    scheduleCount: row.schedule_count,
    branchGroupCount: row.branch_group_count,
  }));
}

export async function createTrip(input) {
  const sql = getSql();
  const [row] = await sql`
    INSERT INTO trips (slug, title, trip_date, end_date, timezone, location, currency)
    VALUES (${input.slug}, ${input.title}, ${input.startDate}, ${input.endDate}, ${input.timezone}, ${input.location}, ${input.currency || "JPY"})
    RETURNING slug, title, TO_CHAR(trip_date, 'YYYY-MM-DD') AS trip_date,
      TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date, timezone, location, currency
  `;
  return tripRecord(row);
}

export async function updateTrip(slug, input) {
  const sql = getSql();
  const [current] = await sql`
    SELECT id, slug, currency, TO_CHAR(trip_date, 'YYYY-MM-DD') AS trip_date,
      TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date
    FROM trips WHERE slug = ${slug} LIMIT 1
  `;
  if (!current) notFound("TRIP_NOT_FOUND", `Trip not found: ${slug}`);
  const nextStart = input.startDate ?? current.trip_date;
  const nextEnd = input.endDate ?? current.end_date;
  if (nextEnd < nextStart) throw new ValidationError("endDate must not be before startDate");
  if (input.currency && input.currency !== current.currency) {
    const [expense] = await sql`SELECT id FROM activity_expenses WHERE trip_id=${current.id} LIMIT 1`;
    if (expense) {
      const error = new Error("Hãy xóa toàn bộ khoản chi trước khi đổi tiền tệ của chuyến đi");
      error.code = "EXPENSE_CURRENCY_LOCKED";
      throw error;
    }
  }

  const queries = [];
  if (input.moveSchedule) {
    if (!input.startDate || !input.endDate) throw new ValidationError("moveSchedule requires startDate and endDate");
    const oldDuration = calendarDayDifference(current.trip_date, current.end_date);
    const newDuration = calendarDayDifference(nextStart, nextEnd);
    if (oldDuration !== newDuration) throw new ValidationError("Chỉ có thể dời toàn bộ lịch khi thời lượng chuyến đi không đổi");
    const delta = calendarDayDifference(current.trip_date, nextStart);
    queries.push((tx) => tx`
      UPDATE activities
      SET start_date = start_date + ${delta}::INTEGER,
          end_date = end_date + ${delta}::INTEGER
      WHERE trip_id = ${current.id}
    `);
  } else {
    const [outside] = await sql`
      SELECT COUNT(*)::INTEGER AS count
      FROM activities
      WHERE trip_id = ${current.id}
        AND (start_date < ${nextStart}::DATE OR end_date > ${nextEnd}::DATE)
    `;
    if (Number(outside?.count || 0) > 0) {
      throw new ValidationError(`${outside.count} hoạt động nằm ngoài khoảng ngày mới`);
    }
  }
  queries.push((tx) => tx`
    UPDATE trips
    SET slug = COALESCE(${input.slug ?? null}, slug),
        title = COALESCE(${input.title ?? null}, title),
        trip_date = ${nextStart},
        end_date = ${nextEnd},
        timezone = COALESCE(${input.timezone ?? null}, timezone),
        location = COALESCE(${input.location ?? null}, location),
        currency = COALESCE(${input.currency ?? null}, currency),
        updated_at = NOW()
    WHERE id = ${current.id}
  `);
  await sql.transaction((tx) => queries.map((query) => query(tx)), { isolationLevel: "Serializable" });
  const [row] = await sql`
    SELECT slug, title, TO_CHAR(trip_date, 'YYYY-MM-DD') AS trip_date,
      TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date, timezone, location, currency
    FROM trips WHERE id = ${current.id}
  `;
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

export async function updateSource(slug, sourceNumber, input) {
  const sql = getSql();
  const rows = await sql`
    UPDATE sources
    SET
      title = COALESCE(${input.title ?? null}, sources.title),
      host = COALESCE(${input.host ?? null}, sources.host),
      url = COALESCE(${input.url ?? null}, sources.url)
    FROM trips
    WHERE sources.trip_id = trips.id
      AND trips.slug = ${slug}
      AND sources.source_number = ${sourceNumber}
    RETURNING sources.source_number, sources.title, sources.host, sources.url
  `;
  if (!rows.length) notFound("SOURCE_NOT_FOUND", `Source not found: ${sourceNumber}`);
  return sourceRecord(rows[0]);
}

export async function deleteSource(slug, sourceNumber) {
  const sql = getSql();
  const rows = await sql`
    DELETE FROM sources
    USING trips
    WHERE sources.trip_id = trips.id
      AND trips.slug = ${slug}
      AND sources.source_number = ${sourceNumber}
    RETURNING sources.id
  `;
  if (!rows.length) notFound("SOURCE_NOT_FOUND", `Source not found: ${sourceNumber}`);
}

export async function createPlace(slug, input) {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO saved_places (trip_id, name, address, latitude, longitude, website, google_place_id, notes)
    SELECT id, ${input.name}, ${input.address}, ${input.latitude}, ${input.longitude},
      ${input.website}, ${input.googlePlaceId}, ${input.notes}
    FROM trips WHERE slug = ${slug}
    RETURNING id, name, address, latitude, longitude, website, google_place_id, notes
  `;
  if (!rows.length) notFound("TRIP_NOT_FOUND", `Trip not found: ${slug}`);
  return placeRecord(rows[0]);
}

export async function updatePlace(slug, placeId, input) {
  const sql = getSql();
  const rows = await sql`
    UPDATE saved_places
    SET name = ${input.name}, address = ${input.address}, latitude = ${input.latitude},
      longitude = ${input.longitude}, website = ${input.website},
      google_place_id = ${input.googlePlaceId}, notes = ${input.notes}
    FROM trips
    WHERE saved_places.trip_id = trips.id AND trips.slug = ${slug} AND saved_places.id = ${placeId}
    RETURNING saved_places.id, saved_places.name, saved_places.address, saved_places.latitude,
      saved_places.longitude, saved_places.website, saved_places.google_place_id, saved_places.notes
  `;
  if (!rows.length) notFound("PLACE_NOT_FOUND", `Saved place not found: ${placeId}`);
  return placeRecord(rows[0]);
}

export async function deletePlace(slug, placeId) {
  const sql = getSql();
  const [trip] = await sql`SELECT id FROM trips WHERE slug = ${slug} LIMIT 1`;
  if (!trip) notFound("TRIP_NOT_FOUND", `Trip not found: ${slug}`);
  const [place] = await sql`SELECT id FROM saved_places WHERE id = ${placeId} AND trip_id = ${trip.id} LIMIT 1`;
  if (!place) notFound("PLACE_NOT_FOUND", `Saved place not found: ${placeId}`);
  await sql.transaction((tx) => [
    tx`UPDATE activities SET place_id = NULL WHERE trip_id = ${trip.id} AND place_id = ${placeId}`,
    tx`DELETE FROM saved_places WHERE trip_id = ${trip.id} AND id = ${placeId}`,
  ], { isolationLevel: "Serializable" });
}

export async function getScheduleItem(slug, activityId) {
  const sql = getSql();
  const rows = await sql`
    SELECT
      a.id,
      TO_CHAR(a.start_date, 'YYYY-MM-DD') AS start_date,
      a.start_time,
      TO_CHAR(a.end_date, 'YYYY-MM-DD') AS end_date,
      a.end_time,
      a.display_end,
      a.type,
      a.icon,
      a.title,
      a.detail,
      a.branch_id,
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
  const trip = await getTripRow(sql, slug);
  const tripId = trip.id;
  try { validateActivityInterval(input, { trip }); }
  catch (error) { throw new ValidationError(error.message); }
  const branchId = input.branchId || null;
  if (branchId) await assertBranchBelongsToTrip(sql, tripId, branchId);
  const sourceIds = await resolveSourceIds(sql, tripId, input.refs);
  const itemKey = await nextItemKey(sql, tripId, input.title);
  if (branchId) await assertBranchCandidate(slug, branchId, { ...input, id: "new", refs: input.refs || [] });
  const activityId = await saveScheduleRecord(sql, { tripId, itemKey, input: { ...input, branchId }, sourceIds });
  return getScheduleItem(slug, activityId);
}

export async function updateScheduleItem(slug, activityId, input) {
  const sql = getSql();
  const existing = await getScheduleItem(slug, activityId);
  if (input.branchId !== undefined && String(input.branchId || "") !== String(existing.branchId || "")) {
    throw new ValidationError("Không thể chuyển activity sang branch khác bằng thao tác sửa");
  }
  const finalStart = input.start ?? existing.start;
  const finalEnd = input.end ?? existing.end;
  const finalInterval = {
    startDate: input.startDate ?? existing.startDate,
    start: finalStart,
    endDate: input.endDate ?? existing.endDate,
    end: finalEnd,
  };
  const trip = await getTripRow(sql, slug);
  try { validateActivityInterval(finalInterval, { trip }); }
  catch (error) { throw new ValidationError(error.message); }

  const tripId = trip.id;
  const sourceIds = input.refs === undefined ? null : await resolveSourceIds(sql, tripId, input.refs);
  if (existing.branchId) {
    await assertBranchCandidate(slug, existing.branchId, {
      ...existing,
      ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    }, activityId);
  }
  const savedId = await saveScheduleRecord(sql, { tripId, activityId, input, sourceIds });
  if (!savedId) notFound("SCHEDULE_NOT_FOUND", `Schedule item not found: ${activityId}`);
  return getScheduleItem(slug, activityId);
}

export async function deleteScheduleItem(slug, activityId) {
  const sql = getSql();
  const anchors = await sql`
    SELECT branch_group.id
    FROM schedule_branch_groups branch_group
    JOIN trips trip ON trip.id = branch_group.trip_id
    WHERE trip.slug = ${slug} AND branch_group.anchor_activity_id = ${activityId}
    LIMIT 1
  `;
  if (anchors.length) throw new ValidationError("Hãy gỡ điểm rẽ trước khi xoá activity neo");
  const [expense] = await sql`SELECT expense.id FROM activity_expenses expense
    JOIN trips trip ON trip.id=expense.trip_id
    WHERE trip.slug=${slug} AND expense.activity_id=${activityId} LIMIT 1`;
  if (expense) {
    const error = new Error("Hãy xóa các khoản chi của hoạt động trước khi xóa hoạt động này");
    error.code = "EXPENSE_ACTIVITY_IN_USE";
    throw error;
  }
  const rows = await sql`
    DELETE FROM activities
    USING trips
    WHERE activities.trip_id = trips.id AND trips.slug = ${slug} AND activities.id = ${activityId}
    RETURNING activities.id
  `;
  if (!rows.length) notFound("SCHEDULE_NOT_FOUND", `Schedule item not found: ${activityId}`);
}

export async function createBranchGroup(slug, input, actorEmail) {
  const sql = getSql();
  const plan = await getItinerary(slug);
  const startsTrip = input.anchorActivityId == null;
  const anchorIndex = startsTrip ? -1 : plan.backbone.findIndex((item) => item.id === String(input.anchorActivityId));
  if (!startsTrip && anchorIndex < 0) throw new ValidationError("Activity neo phải nằm trên tuyến chính");
  if (plan.branchGroups.some((group) => startsTrip ? group.anchorActivityId == null : group.anchorActivityId === String(input.anchorActivityId))) {
    throw new ValidationError(startsTrip ? "Đầu chuyến đã có điểm rẽ" : "Activity này đã có điểm rẽ");
  }
  const segmentStart = startsTrip ? 0 : anchorIndex + 1;
  const expectedSegment = plan.backbone.slice(segmentStart, segmentStart + input.segmentActivityIds.length);
  if (expectedSegment.length !== input.segmentActivityIds.length
    || expectedSegment.some((item, index) => item.id !== String(input.segmentActivityIds[index]))) {
    throw new ValidationError(startsTrip
      ? "Đoạn chuyển thành branch phải là các activity liên tiếp từ đầu chuyến"
      : "Đoạn chuyển thành branch phải liên tiếp ngay sau activity neo");
  }
  const nestedAnchor = plan.branchGroups.find((group) => group.anchorActivityId != null
    && expectedSegment.some((activity) => activity.id === group.anchorActivityId));
  if (nestedAnchor) {
    throw new ValidationError(`Đoạn này chứa activity đang neo điểm rẽ “${nestedAnchor.title}”; hãy gỡ hoặc chọn mốc hội nhập trước điểm rẽ đó`);
  }
  const rejoin = plan.backbone[segmentStart + input.segmentActivityIds.length] || null;
  if (startsTrip && !rejoin) throw new ValidationError("Điểm rẽ đầu chuyến cần giữ lại ít nhất một activity làm mốc hội nhập");
  validateTimelineOrThrow({ anchor: startsTrip ? null : plan.backbone[anchorIndex], rejoin, itinerary: expectedSegment });

  const tripId = await getTripId(sql, slug);
  const groupKey = await nextGroupKey(sql, tripId, input.title);
  const defaultKey = input.defaultBranch.key || keyFromTitle(input.defaultBranch.label);
  const alternateKey = input.alternateBranch.key || keyFromTitle(input.alternateBranch.label);
  if (defaultKey === alternateKey) throw new ValidationError("Hai phương án cần key khác nhau");
  const segmentIds = input.segmentActivityIds;

  await sql.transaction((tx) => [
    tx`UPDATE activities SET sort_order = sort_order + 1000000 WHERE trip_id = ${tripId} AND branch_id IS NULL`,
    tx`
      INSERT INTO schedule_branch_groups (trip_id, item_key, anchor_activity_id, title)
      VALUES (${tripId}, ${groupKey}, ${input.anchorActivityId ?? null}, ${input.title})
    `,
    tx`
      INSERT INTO schedule_branches (trip_id, group_id, item_key, label, condition_text, sort_order, is_default)
      SELECT ${tripId}, id, ${defaultKey}, ${input.defaultBranch.label}, ${input.defaultBranch.condition}, 0, TRUE
      FROM schedule_branch_groups WHERE trip_id = ${tripId} AND item_key = ${groupKey}
    `,
    tx`
      INSERT INTO schedule_branches (trip_id, group_id, item_key, label, condition_text, sort_order, is_default)
      SELECT ${tripId}, id, ${alternateKey}, ${input.alternateBranch.label}, ${input.alternateBranch.condition}, 1, FALSE
      FROM schedule_branch_groups WHERE trip_id = ${tripId} AND item_key = ${groupKey}
    `,
    tx`
      UPDATE activities
      SET
        branch_id = (
          SELECT branch.id FROM schedule_branches branch
          JOIN schedule_branch_groups branch_group ON branch_group.id = branch.group_id
          WHERE branch_group.trip_id = ${tripId} AND branch_group.item_key = ${groupKey} AND branch.item_key = ${defaultKey}
        ),
        sort_order = array_position(${segmentIds}::BIGINT[], id) - 1
      WHERE trip_id = ${tripId} AND id = ANY(${segmentIds}::BIGINT[])
    `,
    tx`
      INSERT INTO schedule_branch_selections (group_id, trip_id, branch_id, selected_by_email)
      SELECT branch_group.id, ${tripId}, branch.id, ${actorEmail}
      FROM schedule_branch_groups branch_group
      JOIN schedule_branches branch ON branch.group_id = branch_group.id AND branch.is_default
      WHERE branch_group.trip_id = ${tripId} AND branch_group.item_key = ${groupKey}
    `,
    tx`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY start_date, start_time, sort_order, id) - 1 AS next_order
        FROM activities WHERE trip_id = ${tripId} AND branch_id IS NULL
      )
      UPDATE activities activity SET sort_order = ranked.next_order
      FROM ranked WHERE activity.id = ranked.id
    `,
  ], { isolationLevel: "Serializable" });
  return getItinerary(slug);
}

export async function createBranchOption(slug, groupId, input) {
  const sql = getSql();
  const tripId = await getTripId(sql, slug);
  await getBranchGroupOrThrow(slug, groupId);
  const key = input.key || await nextBranchKey(sql, groupId, input.label);
  const rows = await sql`
    INSERT INTO schedule_branches (trip_id, group_id, item_key, label, condition_text, sort_order, is_default)
    SELECT ${tripId}, branch_group.id, ${key}, ${input.label}, ${input.condition}, COALESCE(MAX(branch.sort_order), -1) + 1, FALSE
    FROM schedule_branch_groups branch_group
    LEFT JOIN schedule_branches branch ON branch.group_id = branch_group.id
    WHERE branch_group.trip_id = ${tripId} AND branch_group.id = ${groupId}
    GROUP BY branch_group.id
    RETURNING id
  `;
  if (!rows.length) notFound("BRANCH_GROUP_NOT_FOUND", "Không tìm thấy điểm rẽ");
  return getItinerary(slug);
}

export async function updateBranchOption(slug, groupId, branchId, input) {
  const sql = getSql();
  const group = await getBranchGroupOrThrow(slug, groupId);
  const branch = group.branches.find((item) => item.id === String(branchId));
  if (!branch) notFound("BRANCH_NOT_FOUND", "Không tìm thấy phương án");
  if (input.isDefault === false && branch.isDefault) throw new ValidationError("Hãy chọn phương án mặc định khác trước");
  const queries = [];
  if (input.isDefault === true && !branch.isDefault) {
    queries.push((tx) => tx`UPDATE schedule_branches SET is_default = FALSE WHERE group_id = ${groupId} AND is_default`);
  }
  queries.push((tx) => tx`
    UPDATE schedule_branches
    SET
      label = COALESCE(${input.label ?? null}, label),
      condition_text = COALESCE(${input.condition ?? null}, condition_text),
      is_default = CASE WHEN ${input.isDefault === true} THEN TRUE ELSE is_default END,
      updated_at = NOW()
    WHERE id = ${branchId} AND group_id = ${groupId}
  `);
  await sql.transaction((tx) => queries.map((query) => query(tx)));
  return getItinerary(slug);
}

export async function deleteBranchOption(slug, groupId, branchId) {
  const sql = getSql();
  const group = await getBranchGroupOrThrow(slug, groupId);
  const branch = group.branches.find((item) => item.id === String(branchId));
  if (!branch) notFound("BRANCH_NOT_FOUND", "Không tìm thấy phương án");
  if (group.branches.length <= 2) throw new ValidationError("Điểm rẽ cần ít nhất hai phương án; hãy gỡ điểm rẽ thay vì xoá");
  if (branch.isDefault) throw new ValidationError("Không thể xoá phương án mặc định");
  if (group.selectedBranchId === String(branchId)) throw new ValidationError("Hãy kích hoạt phương án khác trước khi xoá");
  await sql`DELETE FROM schedule_branches WHERE id = ${branchId} AND group_id = ${groupId}`;
  return getItinerary(slug);
}

export async function selectBranch(slug, groupId, branchId, actorEmail) {
  const sql = getSql();
  const plan = await getItinerary(slug);
  const group = plan.branchGroups.find((item) => item.id === String(groupId));
  if (!group) notFound("BRANCH_GROUP_NOT_FOUND", "Không tìm thấy điểm rẽ");
  const branch = group.branches.find((item) => item.id === String(branchId));
  if (!branch) notFound("BRANCH_NOT_FOUND", "Phương án không thuộc điểm rẽ này");
  const anchor = group.anchorActivityId == null ? null : plan.backbone.find((item) => item.id === group.anchorActivityId);
  validateTimelineOrThrow({ anchor, rejoin: nextBackboneActivity(plan.backbone, group.anchorActivityId), itinerary: branch.itinerary });
  const tripId = await getTripId(sql, slug);
  await sql.transaction((tx) => [
    tx`
      INSERT INTO schedule_branch_selections (group_id, trip_id, branch_id, selected_at, selected_by_email)
      VALUES (${groupId}, ${tripId}, ${branchId}, NOW(), ${actorEmail})
      ON CONFLICT (group_id) DO UPDATE SET
        branch_id = EXCLUDED.branch_id,
        selected_at = NOW(),
        selected_by_email = EXCLUDED.selected_by_email
    `,
    tx`UPDATE schedule_branch_groups SET updated_at = NOW() WHERE id = ${groupId} AND trip_id = ${tripId}`,
  ], { isolationLevel: "Serializable" });
  return getItinerary(slug);
}

export async function unwrapBranchGroup(slug, groupId, keepBranchId) {
  const sql = getSql();
  const plan = await getItinerary(slug);
  const group = plan.branchGroups.find((item) => item.id === String(groupId));
  if (!group) notFound("BRANCH_GROUP_NOT_FOUND", "Không tìm thấy điểm rẽ");
  const branch = group.branches.find((item) => item.id === String(keepBranchId));
  if (!branch) notFound("BRANCH_NOT_FOUND", "Phương án giữ lại không thuộc điểm rẽ này");
  const anchor = group.anchorActivityId == null ? null : plan.backbone.find((item) => item.id === group.anchorActivityId);
  validateTimelineOrThrow({ anchor, rejoin: nextBackboneActivity(plan.backbone, group.anchorActivityId), itinerary: branch.itinerary });
  const tripId = await getTripId(sql, slug);
  await sql.transaction((tx) => [
    tx`UPDATE activities SET sort_order = sort_order + 1000000 WHERE trip_id = ${tripId} AND branch_id IS NULL`,
    tx`UPDATE activities SET branch_id = NULL, sort_order = sort_order + 2000000 WHERE trip_id = ${tripId} AND branch_id = ${keepBranchId}`,
    tx`DELETE FROM schedule_branch_groups WHERE id = ${groupId} AND trip_id = ${tripId}`,
    tx`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY start_date, start_time, sort_order, id) - 1 AS next_order
        FROM activities WHERE trip_id = ${tripId} AND branch_id IS NULL
      )
      UPDATE activities activity SET sort_order = ranked.next_order
      FROM ranked WHERE activity.id = ranked.id
    `,
  ], { isolationLevel: "Serializable" });
  return getItinerary(slug);
}

const scheduleRecord = (row) => ({
  id: String(row.id),
  startDate: String(row.start_date),
  start: timeLabel(row.start_time),
  endDate: String(row.end_date),
  end: timeLabel(row.end_time),
  displayEnd: row.display_end,
  type: row.type,
  icon: row.icon,
  title: row.title,
  detail: row.detail,
  refs: row.refs,
  branchId: row.branch_id == null ? null : String(row.branch_id),
});

const activityRecord = (row) => ({ ...scheduleRecord(row), placeId: row.place_id ? String(row.place_id) : null });

const getTripId = async (sql, slug) => {
  const rows = await sql`SELECT id FROM trips WHERE slug = ${slug} LIMIT 1`;
  if (!rows.length) notFound("TRIP_NOT_FOUND", `Trip not found: ${slug}`);
  return rows[0].id;
};

const getTripRow = async (sql, slug) => {
  const rows = await sql`
    SELECT id, TO_CHAR(trip_date, 'YYYY-MM-DD') AS start_date,
      TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date
    FROM trips WHERE slug = ${slug} LIMIT 1
  `;
  if (!rows.length) notFound("TRIP_NOT_FOUND", `Trip not found: ${slug}`);
  return { id: rows[0].id, startDate: rows[0].start_date, endDate: rows[0].end_date };
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

const nextItemKey = async (sql, tripId, title) => {
  const base = keyFromTitle(title);
  const rows = await sql`
    SELECT item_key FROM activities
    WHERE trip_id = ${tripId} AND item_key IS NOT NULL
  `;
  const existing = new Set(rows.map((row) => row.item_key));
  return reserveItemKey(base, existing);
};

const nextGroupKey = async (sql, tripId, title) => {
  const base = keyFromTitle(title);
  const rows = await sql`SELECT item_key FROM schedule_branch_groups WHERE trip_id = ${tripId}`;
  const existing = new Set(rows.map((row) => row.item_key));
  return reserveItemKey(base, existing);
};

const nextBranchKey = async (sql, groupId, label) => {
  const base = keyFromTitle(label);
  const rows = await sql`SELECT item_key FROM schedule_branches WHERE group_id = ${groupId}`;
  const existing = new Set(rows.map((row) => row.item_key));
  return reserveItemKey(base, existing);
};

const assertBranchBelongsToTrip = async (sql, tripId, branchId) => {
  const rows = await sql`SELECT id FROM schedule_branches WHERE id = ${branchId} AND trip_id = ${tripId}`;
  if (!rows.length) notFound("BRANCH_NOT_FOUND", "Không tìm thấy phương án trong trip này");
};

const getBranchGroupOrThrow = async (slug, groupId) => {
  const plan = await getItinerary(slug);
  const group = plan.branchGroups.find((item) => item.id === String(groupId));
  if (!group) notFound("BRANCH_GROUP_NOT_FOUND", "Không tìm thấy điểm rẽ");
  return group;
};

const assertBranchCandidate = async (slug, branchId, candidate, replacingId = null) => {
  const plan = await getItinerary(slug);
  const group = plan.branchGroups.find((item) => item.branches.some((branch) => branch.id === String(branchId)));
  const branch = group?.branches.find((item) => item.id === String(branchId));
  if (!group || !branch) notFound("BRANCH_NOT_FOUND", "Không tìm thấy phương án trong trip này");
  const itinerary = branch.itinerary
    .filter((item) => item.id !== String(replacingId))
    .concat(candidate)
    .sort(compareActivityDateTime);
  const anchor = group.anchorActivityId == null ? null : plan.backbone.find((item) => item.id === group.anchorActivityId);
  validateTimelineOrThrow({ anchor, rejoin: nextBackboneActivity(plan.backbone, group.anchorActivityId), itinerary });
};

const validateTimelineOrThrow = (input) => {
  try { validateBranchTimeline(input); }
  catch (error) { throw new ValidationError(error.message); }
};
