import "server-only";

import { getSql } from "./db";

const safeActor = (actor = {}, source = "web") => ({
  email: String(actor.email || "system").trim().toLowerCase(),
  name: String(actor.displayName || actor.name || actor.email || "System").trim(),
  role: actor.isOwner ? "owner" : actor.isAdmin ? "admin" : String(actor.role || "member"),
  source,
});

export function appendTripAudit(sql, { trip, actor, source = "web", action, entityType, entityId = null, before = null, after = null }) {
  const identity = safeActor(actor, source);
  return sql`
    INSERT INTO trip_audit_events (
      trip_id,trip_slug,trip_title,actor_email,actor_name,actor_role,source,
      action,entity_type,entity_id,before_value,after_value
    ) VALUES (
      ${trip.id ?? null},${trip.slug},${trip.title},${identity.email},${identity.name},${identity.role},${identity.source},
      ${action},${entityType},${entityId == null ? null : String(entityId)},${before == null ? null : JSON.stringify(before)}::JSONB,
      ${after == null ? null : JSON.stringify(after)}::JSONB
    )
  `;
}

export async function recordTripAudit(slug, actor, details) {
  const sql = getSql();
  const [trip] = await sql`SELECT id,slug,title FROM trips WHERE slug=${slug} LIMIT 1`;
  if (!trip) return;
  await appendTripAudit(sql, { trip, actor, ...details });
}

export async function listTripAudit(slug, { cursor = null, limit = 30 } = {}) {
  const pageSize = Math.min(Math.max(Number(limit) || 30, 1), 50);
  const beforeId = cursor && /^\d+$/.test(String(cursor)) ? String(cursor) : null;
  const rows = await getSql()`
    SELECT id,trip_slug,trip_title,actor_email,actor_name,actor_role,source,action,
      entity_type,entity_id,before_value,after_value,created_at
    FROM trip_audit_events
    WHERE trip_slug=${slug} AND (${beforeId}::BIGINT IS NULL OR id<${beforeId}::BIGINT)
    ORDER BY id DESC LIMIT ${pageSize + 1}
  `;
  const page = rows.slice(0, pageSize);
  return {
    events: page.map((row) => ({
      id: String(row.id),
      trip: { slug: row.trip_slug, title: row.trip_title },
      actor: { email: row.actor_email, name: row.actor_name, role: row.actor_role },
      source: row.source,
      action: row.action,
      entity: { type: row.entity_type, id: row.entity_id },
      before: row.before_value,
      after: row.after_value,
      createdAt: new Date(row.created_at).toISOString(),
    })),
    nextCursor: rows.length > pageSize ? String(page.at(-1).id) : null,
  };
}
