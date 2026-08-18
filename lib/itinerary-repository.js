import { getSql } from "./db";
import { ValidationError } from "./validation";
import { nextBackboneActivity, resolveActiveItinerary, validateBranchTimeline } from "./schedule-branching.mjs";

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
  const [sourceRows, activityRows, groupRows, branchRows] = await Promise.all([
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
        a.branch_id,
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
      ORDER BY a.branch_id NULLS FIRST, a.start_time, a.sort_order
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
      t.timezone,
      t.location,
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
  const tripId = await getTripId(sql, slug);
  const branchId = input.branchId || null;
  if (branchId) await assertBranchBelongsToTrip(sql, tripId, branchId);
  const sourceIds = await resolveSourceIds(sql, tripId, input.refs);
  const itemKey = await nextItemKey(sql, tripId, input.title);
  if (branchId) await assertBranchCandidate(slug, branchId, { ...input, id: "new", refs: input.refs || [] });
  const [row] = await sql`
    INSERT INTO activities (trip_id, item_key, branch_id, sort_order, start_time, end_time, display_end, type, icon, title, detail)
    SELECT ${tripId}, ${itemKey}, ${branchId}::BIGINT, COALESCE(MAX(sort_order), -1) + 1, ${input.start}, ${input.end}, ${input.displayEnd}, ${input.type}, ${input.icon}, ${input.title}, ${input.detail}
    FROM activities
    WHERE trip_id = ${tripId} AND branch_id IS NOT DISTINCT FROM ${branchId}::BIGINT
    RETURNING id
  `;
  await replaceActivitySources(sql, row.id, sourceIds);
  return getScheduleItem(slug, row.id);
}

export async function updateScheduleItem(slug, activityId, input) {
  const sql = getSql();
  const existing = await getScheduleItem(slug, activityId);
  if (input.branchId !== undefined && String(input.branchId || "") !== String(existing.branchId || "")) {
    throw new ValidationError("Không thể chuyển activity sang branch khác bằng thao tác sửa");
  }
  const finalStart = input.start ?? existing.start;
  const finalEnd = input.end ?? existing.end;
  if (finalEnd <= finalStart) {
    throw new ValidationError("end must be later than start");
  }

  const tripId = await getTripId(sql, slug);
  const sourceIds = input.refs === undefined ? null : await resolveSourceIds(sql, tripId, input.refs);
  if (existing.branchId) {
    await assertBranchCandidate(slug, existing.branchId, {
      ...existing,
      ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    }, activityId);
  }
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
  const anchors = await sql`
    SELECT branch_group.id
    FROM schedule_branch_groups branch_group
    JOIN trips trip ON trip.id = branch_group.trip_id
    WHERE trip.slug = ${slug} AND branch_group.anchor_activity_id = ${activityId}
    LIMIT 1
  `;
  if (anchors.length) throw new ValidationError("Hãy gỡ điểm rẽ trước khi xoá activity neo");
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
        SELECT id, ROW_NUMBER() OVER (ORDER BY start_time, sort_order, id) - 1 AS next_order
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
        SELECT id, ROW_NUMBER() OVER (ORDER BY start_time, sort_order, id) - 1 AS next_order
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
  start: timeLabel(row.start_time),
  end: timeLabel(row.end_time),
  displayEnd: row.display_end,
  type: row.type,
  icon: row.icon,
  title: row.title,
  detail: row.detail,
  refs: row.refs,
  branchId: row.branch_id == null ? null : String(row.branch_id),
});

const activityRecord = (row) => scheduleRecord(row);

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

const nextGroupKey = async (sql, tripId, title) => {
  const base = keyFromTitle(title);
  const rows = await sql`SELECT item_key FROM schedule_branch_groups WHERE trip_id = ${tripId}`;
  const existing = new Set(rows.map((row) => row.item_key));
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
};

const nextBranchKey = async (sql, groupId, label) => {
  const base = keyFromTitle(label);
  const rows = await sql`SELECT item_key FROM schedule_branches WHERE group_id = ${groupId}`;
  const existing = new Set(rows.map((row) => row.item_key));
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
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
    .sort((left, right) => left.start.localeCompare(right.start) || left.end.localeCompare(right.end));
  const anchor = group.anchorActivityId == null ? null : plan.backbone.find((item) => item.id === group.anchorActivityId);
  validateTimelineOrThrow({ anchor, rejoin: nextBackboneActivity(plan.backbone, group.anchorActivityId), itinerary });
};

const validateTimelineOrThrow = (input) => {
  try { validateBranchTimeline(input); }
  catch (error) { throw new ValidationError(error.message); }
};
