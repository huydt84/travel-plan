import "server-only";

import { getSql } from "./db";

const emailOf = (value) => String(value || "").trim().toLowerCase();

const accessError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const tripDto = (row) => ({
  slug: row.slug,
  title: row.title,
  startDate: String(row.trip_date),
  endDate: String(row.end_date),
  timezone: row.timezone,
  location: row.location,
  scheduleCount: Number(row.schedule_count || 0),
  branchGroupCount: Number(row.branch_group_count || 0),
  membershipRole: row.membership_role || null,
  leader: row.leader_email ? { email: row.leader_email, displayName: row.leader_name } : null,
  memberCount: Number(row.member_count || 0),
});

export async function resolveTripAccess(viewer, slug, { allowAdmin = true } = {}) {
  if (!viewer?.email) throw accessError("AUTH_REQUIRED", "Bạn cần đăng nhập bằng Google");
  const [row] = await getSql()`
    SELECT trip.id,trip.slug,trip.title,participant.role AS membership_role
    FROM trips trip
    LEFT JOIN trip_participants participant ON participant.trip_id=trip.id AND participant.user_email=${emailOf(viewer.email)}
    WHERE trip.slug=${slug} LIMIT 1
  `;
  if (!row || (!row.membership_role && !(allowAdmin && viewer.isAdmin))) {
    throw accessError("TRIP_NOT_FOUND", `Trip not found: ${slug}`);
  }
  return {
    trip: { id: row.id, slug: row.slug, title: row.title },
    membershipRole: row.membership_role || null,
    canView: true,
    canManage: Boolean(viewer.isAdmin || row.membership_role === "leader"),
    canManageMembers: Boolean(viewer.isAdmin || row.membership_role === "leader"),
    canSelectBranch: Boolean(row.membership_role || viewer.isAdmin),
    adminOverride: Boolean(viewer.isAdmin && !row.membership_role),
  };
}

export async function requireTripAccess(viewer, slug, permission = "view", options) {
  const access = await resolveTripAccess(viewer, slug, options);
  const allowed = permission === "view"
    ? access.canView
    : permission === "selectBranch"
      ? access.canSelectBranch
      : permission === "manageMembers"
        ? access.canManageMembers
        : access.canManage;
  if (!allowed) throw accessError("TRIP_FORBIDDEN", "Bạn không có quyền thực hiện thao tác này");
  return access;
}

const listQuery = async (email, mode) => getSql()`
  SELECT trip.slug,trip.title,TO_CHAR(trip.trip_date,'YYYY-MM-DD') AS trip_date,
    TO_CHAR(trip.end_date,'YYYY-MM-DD') AS end_date,trip.timezone,trip.location,
    mine.role AS membership_role,
    COUNT(DISTINCT activity.id) FILTER(WHERE activity.branch_id IS NULL OR activity.branch_id=selection.branch_id)::INTEGER AS schedule_count,
    COUNT(DISTINCT branch_group.id)::INTEGER AS branch_group_count,
    COUNT(DISTINCT participant.user_email)::INTEGER AS member_count,
    leader.user_email AS leader_email,COALESCE(leader_user.display_name,leader_user.name) AS leader_name
  FROM trips trip
  LEFT JOIN trip_participants mine ON mine.trip_id=trip.id AND mine.user_email=${email}
  LEFT JOIN trip_participants participant ON participant.trip_id=trip.id
  LEFT JOIN trip_participants leader ON leader.trip_id=trip.id AND leader.role='leader'
  LEFT JOIN users leader_user ON leader_user.email=leader.user_email
  LEFT JOIN activities activity ON activity.trip_id=trip.id
  LEFT JOIN schedule_branch_groups branch_group ON branch_group.trip_id=trip.id
  LEFT JOIN schedule_branch_selections selection ON selection.group_id=branch_group.id
  WHERE (${mode}='all' OR mine.role IS NOT NULL) AND (${mode}<>'leader' OR mine.role='leader')
  GROUP BY trip.id,mine.role,leader.user_email,leader_user.display_name,leader_user.name
  ORDER BY trip.trip_date DESC,trip.id DESC
`;

export async function listVisibleTrips(viewer) {
  if (!viewer?.email) return [];
  return (await listQuery(emailOf(viewer.email), "visible")).map(tripDto);
}

export async function listLedTrips(viewer) {
  if (!viewer?.email) return [];
  return (await listQuery(emailOf(viewer.email), "leader")).map(tripDto);
}

export async function listAdminTrips(viewer, { ownership = "all" } = {}) {
  if (!viewer?.email) throw accessError("AUTH_REQUIRED", "Bạn cần đăng nhập bằng Google");
  if (!viewer?.isAdmin) throw accessError("TRIP_FORBIDDEN", "Chỉ admin mới có quyền xem toàn bộ chuyến đi");
  const trips = (await listQuery(emailOf(viewer.email), "all")).map(tripDto);
  if (ownership === "mine") return trips.filter((trip) => trip.leader?.email === emailOf(viewer.email));
  if (ownership === "others") return trips.filter((trip) => trip.leader?.email !== emailOf(viewer.email));
  return trips;
}

export async function lookupRegisteredUser(viewer, email) {
  if (!viewer?.email) throw accessError("AUTH_REQUIRED", "Bạn cần đăng nhập bằng Google");
  const normalized = emailOf(email);
  const [row] = await getSql()`SELECT email,COALESCE(display_name,name) AS display_name FROM users WHERE email=${normalized} LIMIT 1`;
  if (!row) throw accessError("USER_NOT_FOUND", "Email này chưa đăng ký trong hệ thống");
  return { email: row.email, displayName: row.display_name };
}

export async function assertTripMemberEmails(viewer, slug, emails) {
  const access = await requireTripAccess(viewer, slug, "manageMembers");
  const normalized = [...new Set((emails || []).map(emailOf).filter(Boolean))];
  const rows = normalized.length
    ? await getSql()`SELECT user_email FROM trip_participants WHERE trip_id=${access.trip.id} AND user_email=ANY(${normalized}::TEXT[])`
    : [];
  const found = new Set(rows.map((row) => row.user_email));
  const missing = normalized.filter((email) => !found.has(email));
  if (missing.length) {
    const error = accessError("TRIP_MEMBER_REQUIRED", "Chỉ có thể gửi lời rủ cho thành viên hiện tại của chuyến đi");
    error.emails = missing;
    throw error;
  }
  return access;
}

export async function createOwnedTrip(viewer, input) {
  if (!viewer?.email) throw accessError("AUTH_REQUIRED", "Bạn cần đăng nhập bằng Google");
  const leaderEmail = emailOf(viewer.email);
  const memberEmails = [...new Set((input.memberEmails || []).map(emailOf).filter((email) => email && email !== leaderEmail))];
  const sql = getSql();
  if (memberEmails.length) {
    const rows = await sql`SELECT email FROM users WHERE email=ANY(${memberEmails}::TEXT[])`;
    const found = new Set(rows.map((row) => row.email));
    const missing = memberEmails.filter((email) => !found.has(email));
    if (missing.length) {
      const error = accessError("TRIP_MEMBER_UNREGISTERED", "Một hoặc nhiều email chưa đăng ký trong hệ thống");
      error.emails = missing;
      throw error;
    }
  }
  const [createdRows] = await sql.transaction((tx) => [
    tx`INSERT INTO trips(slug,title,trip_date,end_date,timezone,location)
      VALUES(${input.slug},${input.title},${input.startDate},${input.endDate},${input.timezone},${input.location})
      RETURNING id,slug,title,TO_CHAR(trip_date,'YYYY-MM-DD') AS trip_date,TO_CHAR(end_date,'YYYY-MM-DD') AS end_date,timezone,location`,
    tx`INSERT INTO trip_participants(trip_id,user_email,role,added_by_email,joined_at,last_participated_at)
      SELECT trip.id,member.email,member.role,${leaderEmail},NOW(),NOW()
      FROM trips trip CROSS JOIN (SELECT ${leaderEmail}::TEXT AS email,'leader'::TEXT AS role
        UNION ALL SELECT UNNEST(${memberEmails}::TEXT[]),'member'::TEXT) member
      WHERE trip.slug=${input.slug}`,
    tx`INSERT INTO notifications(recipient_email,trip_id,event_type,actor_name,actor_image)
      SELECT member_email,trip.id,'trip_member_added',${viewer.name},${viewer.image || null}
      FROM trips trip CROSS JOIN UNNEST(${memberEmails}::TEXT[]) member_email WHERE trip.slug=${input.slug}`,
    tx`INSERT INTO trip_audit_events(trip_id,trip_slug,trip_title,actor_email,actor_name,actor_role,source,action,entity_type,after_value)
      SELECT id,slug,title,${leaderEmail},${viewer.displayName || viewer.name || leaderEmail},${viewer.isOwner ? "owner" : viewer.isAdmin ? "admin" : "member"},'web','trip.created','trip',
        jsonb_build_object('slug',slug,'title',title,'leaderEmail',${leaderEmail}::TEXT,'memberEmails',${memberEmails}::TEXT[])
      FROM trips WHERE slug=${input.slug}`,
  ], { isolationLevel: "Serializable" });
  const row = createdRows[0];
  return {
    slug: row.slug,
    title: row.title,
    startDate: String(row.trip_date),
    endDate: String(row.end_date),
    timezone: row.timezone,
    location: row.location,
    membershipRole: "leader",
  };
}

const memberDto = (row, revealEmail) => ({
  displayName: row.display_name,
  role: row.role,
  ...(revealEmail ? {
    email: row.user_email,
    joinedAt: new Date(row.joined_at).toISOString(),
    addedByEmail: row.added_by_email || null,
  } : {}),
});

export async function listTripMembers(viewer, slug) {
  const access = await requireTripAccess(viewer, slug);
  const rows = await getSql()`
    SELECT participant.user_email,participant.role,participant.joined_at,participant.added_by_email,
      COALESCE(user_row.display_name,user_row.name) AS display_name
    FROM trip_participants participant JOIN users user_row ON user_row.email=participant.user_email
    WHERE participant.trip_id=${access.trip.id}
    ORDER BY CASE participant.role WHEN 'leader' THEN 0 ELSE 1 END,LOWER(COALESCE(user_row.display_name,user_row.name)),participant.user_email
  `;
  const revealEmail = access.canManageMembers;
  return { members: rows.map((row) => memberDto(row, revealEmail)), access };
}

export async function addTripMember(viewer, slug, email) {
  const access = await requireTripAccess(viewer, slug, "manageMembers");
  const user = await lookupRegisteredUser(viewer, email);
  const actorEmail = emailOf(viewer.email);
  const rows = await getSql()`WITH inserted AS (
      INSERT INTO trip_participants(trip_id,user_email,role,added_by_email,joined_at,last_participated_at)
      VALUES(${access.trip.id},${user.email},'member',${actorEmail},NOW(),NOW())
      ON CONFLICT(trip_id,user_email) DO NOTHING RETURNING *
    ), notification AS (
      INSERT INTO notifications(recipient_email,trip_id,event_type,actor_name,actor_image)
      SELECT user_email,trip_id,'trip_member_added',${viewer.name},${viewer.image || null} FROM inserted RETURNING id
    ), audit AS (
      INSERT INTO trip_audit_events(trip_id,trip_slug,trip_title,actor_email,actor_name,actor_role,source,action,entity_type,entity_id,after_value)
      SELECT trip_id,${access.trip.slug},${access.trip.title},${actorEmail},${viewer.displayName || viewer.name || actorEmail},
        ${viewer.isOwner ? "owner" : viewer.isAdmin ? "admin" : "member"},'web','member.added','member',user_email,
        jsonb_build_object('email',user_email,'role','member') FROM inserted RETURNING id
    ) SELECT * FROM inserted`;
  if (!rows.length) throw accessError("TRIP_MEMBER_CONFLICT", "Người này đã ở trong chuyến đi");
  return { ...user, role: "member" };
}

export async function removeTripMember(viewer, slug, email) {
  const access = await requireTripAccess(viewer, slug, "manageMembers");
  const targetEmail = emailOf(email);
  const sql = getSql();
  const [target] = await sql`SELECT role FROM trip_participants WHERE trip_id=${access.trip.id} AND user_email=${targetEmail}`;
  if (!target) throw accessError("TRIP_MEMBER_NOT_FOUND", "Không tìm thấy thành viên trong chuyến đi");
  if (target.role === "leader") throw accessError("TRIP_LEADER_IMMUTABLE", "Hãy chuyển Leader trước khi xóa người này");
  const removed = await sql`WITH locked AS (SELECT id FROM trips WHERE id=${access.trip.id} FOR UPDATE), deleted AS (
      DELETE FROM trip_participants participant USING locked
      WHERE participant.trip_id=locked.id AND participant.user_email=${targetEmail} AND participant.role='member' RETURNING participant.*
    ), notification AS (
      INSERT INTO notifications(recipient_email,trip_id,event_type,actor_name,actor_image)
      SELECT user_email,trip_id,'trip_member_removed',${viewer.name},${viewer.image || null} FROM deleted RETURNING id
    ), audit AS (
      INSERT INTO trip_audit_events(trip_id,trip_slug,trip_title,actor_email,actor_name,actor_role,source,action,entity_type,entity_id,before_value)
      SELECT trip_id,${access.trip.slug},${access.trip.title},${emailOf(viewer.email)},${viewer.displayName || viewer.name || viewer.email},
        ${viewer.isOwner ? "owner" : viewer.isAdmin ? "admin" : "member"},'web','member.removed','member',user_email,
        jsonb_build_object('email',user_email,'role','member') FROM deleted RETURNING id
    ) SELECT * FROM deleted`;
  if (!removed.length) throw accessError("TRIP_LEADER_IMMUTABLE", "Hãy chuyển Leader trước khi xóa người này");
}

export async function transferTripLeadership(viewer, slug, email) {
  const access = await requireTripAccess(viewer, slug, "manageMembers");
  const targetEmail = emailOf(email);
  const sql = getSql();
  const [target] = await sql`SELECT role FROM trip_participants WHERE trip_id=${access.trip.id} AND user_email=${targetEmail}`;
  if (!target) throw accessError("TRIP_MEMBER_NOT_FOUND", "Leader mới phải là thành viên hiện tại");
  if (target.role === "leader") throw accessError("TRIP_MEMBER_CONFLICT", "Người này đã là Leader");
  const changed = await sql`WITH locked AS (SELECT id FROM trips WHERE id=${access.trip.id} FOR UPDATE), target AS (
      SELECT participant.user_email FROM trip_participants participant JOIN locked ON locked.id=participant.trip_id
      WHERE participant.user_email=${targetEmail} AND participant.role='member'
    ), previous AS (
      SELECT participant.user_email FROM trip_participants participant JOIN locked ON locked.id=participant.trip_id WHERE participant.role='leader'
    ), demoted AS (
      UPDATE trip_participants participant SET role='member' FROM target
      WHERE participant.trip_id=${access.trip.id} AND participant.role='leader' RETURNING participant.user_email
    ), promoted AS (
      UPDATE trip_participants participant SET role='leader',added_by_email=${emailOf(viewer.email)} FROM target
      WHERE participant.trip_id=${access.trip.id} AND participant.user_email=target.user_email AND EXISTS(SELECT 1 FROM demoted) RETURNING participant.*
    ), notification AS (
      INSERT INTO notifications(recipient_email,trip_id,event_type,actor_name,actor_image)
      SELECT user_email,trip_id,'trip_leader_received',${viewer.name},${viewer.image || null} FROM promoted RETURNING id
    ), audit AS (
      INSERT INTO trip_audit_events(trip_id,trip_slug,trip_title,actor_email,actor_name,actor_role,source,action,entity_type,entity_id,before_value,after_value)
      SELECT promoted.trip_id,${access.trip.slug},${access.trip.title},${emailOf(viewer.email)},${viewer.displayName || viewer.name || viewer.email},
        ${viewer.isOwner ? "owner" : viewer.isAdmin ? "admin" : "member"},'web','leader.transferred','membership',promoted.user_email,
        jsonb_build_object('leaderEmail',previous.user_email),jsonb_build_object('leaderEmail',promoted.user_email)
      FROM promoted CROSS JOIN previous RETURNING id
    ) SELECT * FROM promoted`;
  if (!changed.length) throw accessError("TRIP_MEMBER_CONFLICT", "Không thể chuyển Leader cho thành viên này");
}
