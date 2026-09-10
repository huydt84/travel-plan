import { createHash, randomUUID } from "node:crypto";
import { AssistantFault } from "../v1/errors.mjs";
import { assertCollectionSnapshot } from "./adapter.mjs";
import { CollectionImportError, GOOGLE_MAPS_PARSER_VERSION, createGoogleMapsCollectionAdapter } from "./google-maps-adapter.mjs";

const PREVIEW_LIFETIME_MS = 15 * 60 * 1000;
const defaultSql = async (...args) => (await import("../db.js")).getSql()(...args);
const defaultAdapter = () => createGoogleMapsCollectionAdapter();
const asId = (value, name = "id") => {
  if (!/^[1-9][0-9]*$/.test(String(value))) throw new AssistantFault("INVALID_INPUT", `${name} is invalid`, { status: 400 });
  return String(value);
};
const page = (offset = 0, limit = 100) => {
  const parsedOffset = Number(offset), parsedLimit = Number(limit);
  if (!Number.isInteger(parsedOffset) || parsedOffset < 0 || parsedOffset > 10000 || !Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200)
    throw new AssistantFault("INVALID_INPUT", "Pagination is invalid", { status: 400 });
  return { offset: parsedOffset, limit: parsedLimit };
};
const collectionRecord = (row) => ({
  id: String(row.id), name: row.display_name || row.source_title, sourceTitle: row.source_title,
  description: row.source_description, publicUrl: row.public_url, parserVersion: row.parser_version,
  revision: Number(row.revision), archived: Boolean(row.archived_at), lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at).toISOString() : null,
  activeCount: Number(row.active_count || 0), removedCount: Number(row.removed_count || 0), hiddenCount: Number(row.hidden_count || 0),
});
const itemRecord = (row) => ({
  id: String(row.place_id), position: Number(row.position), name: row.source_name, address: row.source_address,
  latitude: row.latitude, longitude: row.longitude, note: row.source_note, mapsUrl: row.maps_url,
  sourceRemovedAt: row.source_removed_at ? new Date(row.source_removed_at).toISOString() : null,
  hiddenAt: row.hidden_at ? new Date(row.hidden_at).toISOString() : null, externalIds: row.external_ids || [],
});

function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function same(left, right) {
  return left.position === right.position && left.name === right.name && (left.address || null) === (right.address || null)
    && (left.latitude ?? null) === (right.latitude ?? null) && (left.longitude ?? null) === (right.longitude ?? null)
    && (left.note || "") === (right.note || "") && left.mapsUrl === right.mapsUrl;
}

export function collectionFault(error) {
  if (error instanceof AssistantFault) return error;
  if (error instanceof CollectionImportError) return new AssistantFault(error.code, error.message, { status: error.status, details: error.details });
  const states = {
    PC404: ["COLLECTION_NOT_FOUND", "Collection or preview was not found", 404], PC403: ["PREVIEW_DIGEST_INVALID", "Preview confirmation is invalid", 403],
    PC410: ["PREVIEW_EXPIRED", "The preview expired. Check the list again.", 410], PC409: ["COLLECTION_CHANGED", "The collection changed. Check the list again.", 409],
    PC422: ["PLACE_IDENTITY_CONFLICT", "Conflicting stable place identifiers were found", 422],
  };
  const mapped = states[error?.code];
  return mapped ? new AssistantFault(mapped[0], mapped[1], { status: mapped[2] }) : new AssistantFault("COLLECTION_UNAVAILABLE", "Collection operation failed", { status: 503 });
}

export function createPlaceCollectionRepository({ sql = defaultSql, adapter = defaultAdapter() } = {}) {
  const collectionRows = (where = null) => sql`
    SELECT c.*,COUNT(i.place_id) FILTER(WHERE i.source_removed_at IS NULL AND i.hidden_at IS NULL)::INTEGER active_count,
      COUNT(i.place_id) FILTER(WHERE i.source_removed_at IS NOT NULL)::INTEGER removed_count,
      COUNT(i.place_id) FILTER(WHERE i.hidden_at IS NOT NULL)::INTEGER hidden_count
    FROM place_collections c LEFT JOIN place_collection_items i ON i.collection_id=c.id
    WHERE (${where}::TEXT IS NULL OR c.id::TEXT=${where}) GROUP BY c.id ORDER BY c.archived_at NULLS FIRST,c.updated_at DESC`;

  return {
    async list() { return (await collectionRows()).map(collectionRecord); },
    async get(id, { offset = 0, limit = 100, includeRemoved = true } = {}) {
      id = asId(id, "collectionId");
      ({ offset, limit } = page(offset, limit));
      const [rows, items] = await Promise.all([
        collectionRows(id),
        sql`SELECT i.*,COALESCE(jsonb_agg(jsonb_build_object('kind',e.kind,'value',e.value) ORDER BY e.kind) FILTER(WHERE e.kind IS NOT NULL),'[]') external_ids
          FROM place_collection_items i LEFT JOIN place_external_ids e ON e.place_id=i.place_id AND e.provider='google_maps'
          WHERE i.collection_id=${id} AND (${includeRemoved} OR i.source_removed_at IS NULL)
          GROUP BY i.collection_id,i.place_id ORDER BY i.source_removed_at NULLS FIRST,i.position LIMIT ${limit} OFFSET ${offset}`,
      ]);
      if (!rows.length) throw new AssistantFault("COLLECTION_NOT_FOUND", "Collection was not found", { status: 404 });
      return { ...collectionRecord(rows[0]), items: items.map(itemRecord), nextCursor: items.length === limit ? String(offset + limit) : null };
    },
    async createPreview({ actor, url = null, collectionId = null, signal } = {}) {
      if (Boolean(url) === Boolean(collectionId)) throw new AssistantFault("INVALID_INPUT", "Provide exactly one of url or collectionId", { status: 400 });
      let current = null;
      if (collectionId) {
        collectionId = asId(collectionId, "collectionId");
        [current] = await sql`SELECT * FROM place_collections WHERE id=${collectionId}`;
        if (!current) throw new AssistantFault("COLLECTION_NOT_FOUND", "Collection was not found", { status: 404 });
        url = current.source_url;
      }
      const started = Date.now(); let snapshot;
      try { snapshot = assertCollectionSnapshot(await adapter.fetchSnapshot(url, { signal })); }
      catch (error) {
        const code = String(error?.code || "COLLECTION_UNAVAILABLE").slice(0,80);
        await sql`INSERT INTO place_collection_sync_attempts(collection_id,actor_email,parser_version,status,error_code,duration_ms)
          VALUES(${current?.id || null},${actor.email},${GOOGLE_MAPS_PARSER_VERSION},'failed',${code},${Math.max(0,Date.now()-started)})`;
        throw error;
      }
      if (!current) [current] = await sql`SELECT * FROM place_collections WHERE provider=${snapshot.provider} AND external_list_id=${snapshot.externalId}`;
      if (current && (current.provider !== snapshot.provider || current.external_list_id !== snapshot.externalId))
        throw new AssistantFault("COLLECTION_SOURCE_MISMATCH", "The URL points to a different Google Maps list", { status: 409 });

      const flatIds = snapshot.items.flatMap((item) => item.externalIds.map((external) => ({ ...external, itemPosition: item.position })));
      const matches = flatIds.length ? await sql`WITH wanted AS (SELECT value FROM jsonb_array_elements(${JSON.stringify(flatIds)}::JSONB))
        SELECT wanted.value->>'kind' kind,wanted.value->>'value' value,wanted.value->>'itemPosition' position,e.place_id::TEXT
        FROM wanted LEFT JOIN place_external_ids e ON e.provider=${snapshot.provider} AND e.kind=wanted.value->>'kind' AND e.value=wanted.value->>'value'` : [];
      const matchedByPosition = new Map();
      for (const match of matches) if (match.place_id) {
        const values = matchedByPosition.get(Number(match.position)) || new Set(); values.add(String(match.place_id)); matchedByPosition.set(Number(match.position), values);
      }
      for (const values of matchedByPosition.values()) if (values.size > 1)
        throw new AssistantFault("PLACE_IDENTITY_CONFLICT", "Conflicting stable place identifiers were found", { status: 422 });

      const existing = current ? await sql`SELECT i.* FROM place_collection_items i WHERE i.collection_id=${current.id}` : [];
      const existingByPlace = new Map(existing.map((item) => [String(item.place_id), item]));
      const seen = new Set(); const counts = { added: 0, updated: 0, restored: 0, removed: 0, unchanged: 0 };
      const items = snapshot.items.map((item) => {
        const placeId = [...(matchedByPosition.get(item.position) || [])][0] || null;
        const prior = placeId ? existingByPlace.get(placeId) : null;
        if (placeId) seen.add(placeId);
        const comparable = prior ? { position: Number(prior.position), name: prior.source_name, address: prior.source_address,
          latitude: prior.latitude, longitude: prior.longitude, note: prior.source_note, mapsUrl: prior.maps_url } : null;
        const change = !prior ? "added" : prior.source_removed_at ? "restored" : same(item, comparable) ? "unchanged" : "updated";
        counts[change] += 1; return { ...item, change };
      });
      const removedItems = [];
      for (const prior of existing) if (!prior.source_removed_at && !seen.has(String(prior.place_id))) {
        counts.removed += 1;
        removedItems.push({ id: String(prior.place_id), position: Number(prior.position), name: prior.source_name, address: prior.source_address,
          latitude: prior.latitude, longitude: prior.longitude, note: prior.source_note, mapsUrl: prior.maps_url,
          sourceCreatedAt: prior.source_created_at, sourceUpdatedAt: prior.source_updated_at, externalIds: [], change: "removed" });
      }
      const safeSnapshot = { ...snapshot, sourceUrl: undefined, items, previewItems: [...items, ...removedItems] };
      const previewId = randomUUID(), previewDigest = digest(safeSnapshot), expiresAt = new Date(Date.now() + PREVIEW_LIFETIME_MS);
      await sql`INSERT INTO place_collection_sync_previews(id,actor_email,collection_id,base_revision,provider,external_list_id,source_url,public_url,
        source_title,source_description,parser_version,snapshot,change_summary,digest,expires_at)
        VALUES(${previewId}::UUID,${actor.email},${current?.id || null},${current?.revision || null},${snapshot.provider},${snapshot.externalId},${url},${snapshot.publicUrl},
          ${snapshot.title},${snapshot.description},${snapshot.parserVersion},${JSON.stringify(safeSnapshot)}::JSONB,
          ${JSON.stringify({ ...counts, total: items.length, warnings: snapshot.warnings, durationMs: Date.now()-started })}::JSONB,${previewDigest},${expiresAt})`;
      return this.getPreview(previewId, actor.email);
    },
    async getPreview(id, actorEmail, { offset = 0, limit = 100, change = null } = {}) {
      ({ offset, limit } = page(offset, limit));
      if (change !== null && !["added","updated","restored","removed","unchanged"].includes(change))
        throw new AssistantFault("INVALID_INPUT", "Preview change filter is invalid", { status: 400 });
      const [row] = await sql`SELECT * FROM place_collection_sync_previews WHERE id=${id}::UUID AND actor_email=${actorEmail}`;
      if (!row) throw new AssistantFault("PREVIEW_NOT_FOUND", "Preview was not found", { status: 404 });
      const allItems = row.snapshot?.previewItems || row.snapshot?.items || [];
      const filtered = change ? allItems.filter((item) => item.change === change) : allItems;
      return { id: String(row.id), collectionId: row.collection_id ? String(row.collection_id) : null, title: row.source_title,
        description: row.source_description, publicUrl: row.public_url, parserVersion: row.parser_version, digest: row.digest,
        summary: row.change_summary, expiresAt: new Date(row.expires_at).toISOString(), applied: Boolean(row.applied_at), receipt: row.receipt,
        items: filtered.slice(offset, offset+limit), nextCursor: filtered.length > offset+limit ? String(offset+limit) : null };
    },
    async applyPreview(id, actorEmail, approvedDigest) {
      const [row] = await sql`SELECT apply_place_collection_preview(${id}::UUID,${actorEmail},${approvedDigest}) result`;
      return row.result;
    },
    async update(id, { displayName, archived } = {}) {
      id = asId(id, "collectionId");
      if (displayName === undefined && archived === undefined) throw new AssistantFault("INVALID_INPUT", "No collection change was provided", { status: 400 });
      if (displayName !== undefined && displayName !== null && (typeof displayName !== "string" || displayName.trim().length > 160))
        throw new AssistantFault("INVALID_INPUT", "Collection name must be at most 160 characters", { status: 400 });
      const [row] = await sql`UPDATE place_collections SET display_name=CASE WHEN ${displayName !== undefined} THEN ${displayName?.trim() || null} ELSE display_name END,
        archived_at=CASE WHEN ${archived === true} THEN NOW() WHEN ${archived === false} THEN NULL ELSE archived_at END,revision=revision+1,updated_at=NOW()
        WHERE id=${id} RETURNING id`;
      if (!row) throw new AssistantFault("COLLECTION_NOT_FOUND", "Collection was not found", { status: 404 });
      return this.get(id);
    },
    async setPlaceHidden(collectionId, placeId, hidden) {
      collectionId=asId(collectionId,"collectionId"); placeId=asId(placeId,"placeId");
      if (typeof hidden !== "boolean") throw new AssistantFault("INVALID_INPUT", "hidden must be a boolean", { status: 400 });
      const [row] = await sql`UPDATE place_collection_items SET hidden_at=CASE WHEN ${hidden} THEN NOW() ELSE NULL END,updated_at=NOW()
        WHERE collection_id=${collectionId} AND place_id=${placeId} RETURNING place_id`;
      if (!row) throw new AssistantFault("COLLECTION_PLACE_NOT_FOUND", "Collection place was not found", { status: 404 });
      await sql`UPDATE place_collections SET revision=revision+1,updated_at=NOW() WHERE id=${collectionId}`;
      return this.get(collectionId);
    },
  };
}
