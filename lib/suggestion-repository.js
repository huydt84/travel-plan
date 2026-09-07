import "server-only";

import { getSql } from "./db";
import { resolveLocalAdminMode } from "./runtime-config.mjs";
import {
  canChangeSuggestionVisibility,
  canDeleteSuggestion,
  canManageSuggestion,
  canSetSuggestionStatus,
} from "./suggestion-policy.mjs";

const suggestionRecord = (row, viewer) => ({
  id: String(row.id),
  activityId: row.activity_id == null ? null : String(row.activity_id),
  kind: row.kind,
  body: row.body,
  status: row.status,
  hidden: row.hidden_at != null,
  canManage: canManageSuggestion(viewer, row),
  canDelete: canDeleteSuggestion(viewer, row),
  canChangeVisibility: canChangeSuggestionVisibility(viewer, row),
  author: {
    name: row.author_name,
    image: row.author_image,
    email: viewer?.isAdmin || viewer?.isOwner || viewer?.email === row.author_email ? row.author_email : null,
  },
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export async function listSuggestions(slug, viewer = null) {
  const sql = getSql();
  const rows = viewer?.isAdmin || viewer?.isOwner
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
          AND (s.status <> 'rejected' OR LOWER(s.author_email) = LOWER(${viewer?.email || ""}))
          AND (s.hidden_at IS NULL OR LOWER(s.author_email) = LOWER(${viewer?.email || ""}))
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

  const owner = notificationOwnerEmail(viewer);
  const [row] = await sql`
    WITH created AS (
      INSERT INTO suggestions (
        trip_id, activity_id, kind, body, author_email, author_name, author_image
      ) VALUES (
        ${tripId}, ${input.activityId}, ${input.kind}, ${input.body},
        ${viewer.email}, ${viewer.name}, ${viewer.image}
      )
      RETURNING *
    ), participant_user AS (
      INSERT INTO users (name, display_name, email, first_login, last_login, last_active_at)
      VALUES (${viewer.name}, ${viewer.name}, ${viewer.email}, NOW(), NOW(), NOW())
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name
      RETURNING email
    ), participant AS (
      INSERT INTO trip_participants (trip_id, user_email, joined_at, last_participated_at)
      SELECT created.trip_id, participant_user.email, NOW(), NOW()
      FROM created CROSS JOIN participant_user
      ON CONFLICT (trip_id, user_email) DO UPDATE SET
        last_participated_at = EXCLUDED.last_participated_at
      RETURNING user_email
    ), created_notifications AS (
      INSERT INTO notifications (
        recipient_email, trip_id, suggestion_id, event_type,
        actor_name, actor_image, status_value
      )
      SELECT
        trip_participant.user_email,
        created.trip_id,
        created.id,
        'contribution_created',
        created.author_name,
        created.author_image,
        NULL
      FROM created
      JOIN trip_participants trip_participant ON trip_participant.trip_id = created.trip_id
      WHERE trip_participant.user_email <> LOWER(${viewer.email})
        AND trip_participant.user_email <> ${owner}
      RETURNING id
    ), queued_email AS (
      INSERT INTO admin_notification_outbox (
        suggestion_id, recipient_email, author_name, contribution_kind,
        contribution_body, trip_slug, trip_title, activity_title
      )
      SELECT
        created.id,
        ${owner},
        created.author_name,
        created.kind,
        created.body,
        trip.slug,
        trip.title,
        activity.title
      FROM created
      JOIN trips trip ON trip.id = created.trip_id
      LEFT JOIN activities activity ON activity.id = created.activity_id
      WHERE ${Boolean(viewer.isOwner)} = FALSE
      ON CONFLICT (suggestion_id) DO NOTHING
      RETURNING id
    )
    SELECT created.*, (SELECT id FROM queued_email LIMIT 1) AS admin_outbox_id
    FROM created
  `;
  return {
    suggestion: suggestionRecord(row, viewer),
    adminOutboxId: row.admin_outbox_id == null ? null : String(row.admin_outbox_id),
  };
}

export async function updateSuggestionStatus(slug, suggestionId, status, viewer) {
  const sql = getSql();
  const target = await suggestionById(sql, slug, suggestionId);
  if (!canSetSuggestionStatus(viewer, target, status)) forbidden("Bạn không có quyền đổi trạng thái góp ý này");
  if (target.status === status) return suggestionRecord(target, viewer);
  const owner = notificationOwnerEmail(viewer);
  const rows = await sql`
    WITH updated AS (
      UPDATE suggestions suggestion
      SET status = ${status}, updated_at = NOW()
      FROM trips trip
      WHERE suggestion.trip_id = trip.id
        AND trip.slug = ${slug}
        AND suggestion.id = ${suggestionId}
        AND suggestion.status <> ${status}
      RETURNING suggestion.*
    ), created_notification AS (
      INSERT INTO notifications (
        recipient_email, trip_id, suggestion_id, event_type,
        actor_name, actor_image, status_value
      )
      SELECT
        updated.author_email,
        updated.trip_id,
        updated.id,
        'contribution_status_changed',
        ${viewer.name},
        ${viewer.image},
        ${status}
      FROM updated
      WHERE LOWER(updated.author_email) <> LOWER(${viewer.email})
        AND LOWER(updated.author_email) <> ${owner}
      RETURNING id
    )
    SELECT * FROM updated
  `;
  if (!rows.length) notFound("SUGGESTION_NOT_FOUND", `Suggestion not found: ${suggestionId}`);
  return suggestionRecord(rows[0], viewer);
}

export async function updateSuggestionVisibility(slug, suggestionId, hidden, viewer) {
  const sql = getSql();
  const target = await suggestionById(sql, slug, suggestionId);
  if (!canChangeSuggestionVisibility(viewer, target)) forbidden("Bạn không có quyền đổi hiển thị góp ý này");
  const currentlyHidden = target.hidden_at != null;
  if (currentlyHidden === hidden) return suggestionRecord(target, viewer);
  const rows = await sql`
    WITH updated AS (
      UPDATE suggestions suggestion
      SET
        hidden_at = CASE WHEN ${hidden} THEN NOW() ELSE NULL END,
        hidden_by_email = CASE WHEN ${hidden} THEN LOWER(${viewer.email}) ELSE NULL END,
        updated_at = NOW()
      FROM trips trip
      WHERE suggestion.trip_id = trip.id
        AND trip.slug = ${slug}
        AND suggestion.id = ${suggestionId}
        AND (suggestion.hidden_at IS NOT NULL) <> ${hidden}
      RETURNING suggestion.*
    ), created_notification AS (
      INSERT INTO notifications (
        recipient_email, trip_id, suggestion_id, event_type,
        actor_name, actor_image, status_value, visibility_value
      )
      SELECT
        updated.author_email,
        updated.trip_id,
        updated.id,
        'contribution_visibility_changed',
        ${viewer.name},
        ${viewer.image},
        NULL,
        ${hidden ? "hidden" : "visible"}
      FROM updated
      WHERE LOWER(updated.author_email) <> LOWER(${viewer.email})
      RETURNING id
    )
    SELECT * FROM updated
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

const notificationOwnerEmail = (viewer, env = process.env) => {
  if (viewer?.isOwner && viewer.email) return viewer.email.trim().toLowerCase();
  const configured = env.AUTH_OWNER_EMAIL?.trim().toLowerCase();
  if (configured) return configured;
  if (resolveLocalAdminMode(env).enabled) return "local-admin@localhost.invalid";
  throw new Error("AUTH_OWNER_EMAIL is missing from the process environment.");
};
