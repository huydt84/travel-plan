import "server-only";

import { getSql } from "./db";
import { canDeleteSuggestion, canManageSuggestion, canSetSuggestionStatus } from "./suggestion-policy.mjs";

const suggestionRecord = (row, viewer) => ({
  id: String(row.id),
  activityId: row.activity_id == null ? null : String(row.activity_id),
  kind: row.kind,
  body: row.body,
  status: row.status,
  canManage: canManageSuggestion(viewer, row),
  canDelete: canDeleteSuggestion(viewer, row),
  author: {
    name: row.author_name,
    image: row.author_image,
    email: viewer?.isOwner || viewer?.email === row.author_email ? row.author_email : null,
  },
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export async function listSuggestions(slug, viewer = null) {
  const sql = getSql();
  const rows = viewer?.isOwner
    ? await sql`
        SELECT s.*
        FROM suggestions s
        JOIN trips t ON t.id = s.trip_id
        WHERE t.slug = ${slug}
        ORDER BY s.created_at DESC
      `
    : await sql`
        SELECT s.*
        FROM suggestions s
        JOIN trips t ON t.id = s.trip_id
        WHERE t.slug = ${slug}
          AND (s.status <> 'rejected' OR s.author_email = ${viewer?.email || ""})
        ORDER BY s.created_at DESC
      `;
  return rows.map((row) => suggestionRecord(row, viewer));
}

export async function createSuggestion(slug, input, viewer) {
  const sql = getSql();
  const trips = await sql`SELECT id FROM trips WHERE slug = ${slug} LIMIT 1`;
  if (!trips.length) notFound("TRIP_NOT_FOUND", `Trip not found: ${slug}`);
  const tripId = trips[0].id;

  if (input.activityId != null) {
    const activities = await sql`
      SELECT id FROM activities WHERE id = ${input.activityId} AND trip_id = ${tripId} LIMIT 1
    `;
    if (!activities.length) notFound("SCHEDULE_NOT_FOUND", `Schedule item not found: ${input.activityId}`);
  }

  const [row] = await sql`
    INSERT INTO suggestions (
      trip_id, activity_id, kind, body, author_email, author_name, author_image
    ) VALUES (
      ${tripId}, ${input.activityId}, ${input.kind}, ${input.body},
      ${viewer.email}, ${viewer.name}, ${viewer.image}
    )
    RETURNING *
  `;
  return suggestionRecord(row, viewer);
}

export async function updateSuggestionStatus(slug, suggestionId, status, viewer) {
  const sql = getSql();
  const target = await suggestionById(sql, slug, suggestionId);
  if (!canSetSuggestionStatus(viewer, target, status)) forbidden("Bạn không có quyền đổi trạng thái góp ý này");
  const rows = await sql`
    UPDATE suggestions s
    SET status = ${status}, updated_at = NOW()
    FROM trips t
    WHERE s.trip_id = t.id AND t.slug = ${slug} AND s.id = ${suggestionId}
    RETURNING s.*
  `;
  if (!rows.length) notFound("SUGGESTION_NOT_FOUND", `Suggestion not found: ${suggestionId}`);
  return suggestionRecord(rows[0], viewer);
}

export async function deleteSuggestion(slug, suggestionId, viewer) {
  const sql = getSql();
  const target = await suggestionById(sql, slug, suggestionId);
  if (!canDeleteSuggestion(viewer, target)) forbidden("Bạn không có quyền xoá góp ý này");
  const rows = await sql`
    DELETE FROM suggestions s
    USING trips t
    WHERE s.trip_id = t.id AND t.slug = ${slug} AND s.id = ${suggestionId}
    RETURNING s.id
  `;
  if (!rows.length) notFound("SUGGESTION_NOT_FOUND", `Suggestion not found: ${suggestionId}`);
}

const notFound = (code, message) => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const suggestionById = async (sql, slug, suggestionId) => {
  const rows = await sql`
    SELECT s.*
    FROM suggestions s
    JOIN trips t ON t.id = s.trip_id
    WHERE t.slug = ${slug} AND s.id = ${suggestionId}
    LIMIT 1
  `;
  if (!rows.length) notFound("SUGGESTION_NOT_FOUND", `Suggestion not found: ${suggestionId}`);
  return rows[0];
};

const forbidden = (message) => {
  const error = new Error(message);
  error.code = "SUGGESTION_FORBIDDEN";
  throw error;
};
