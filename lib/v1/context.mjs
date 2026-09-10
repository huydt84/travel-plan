import { AssistantFault, assertPilotActor } from "./errors.mjs";
import { contextRefsSchema, validateSchema } from "./schemas.mjs";
import { readTripSnapshot, compactSnapshot } from "./snapshot.mjs";

export const refKey = (ref) => `${ref.kind}:${ref.id}`;
export function canonicalRefs(refs = [], maxItems = 20) {
  validateSchema({ ...contextRefsSchema, maxItems }, refs);
  for (const ref of refs) {
    if (!(ref.kind === "place" ? /^(?:google:[A-Za-z0-9_-]+|saved:[1-9][0-9]*|library:[1-9][0-9]*)$/.test(ref.id) : /^[1-9][0-9]*$/.test(ref.id)))
      throw new AssistantFault("INVALID_INPUT", "Mã ngữ cảnh không hợp lệ");
  }
  return [...new Map(refs.map(({ kind, id }) => [refKey({ kind, id }), { kind, id }])).values()].sort((a, b) => refKey(a).localeCompare(refKey(b)));
}
const defaultSql = async (...args) => (await import("../db.js")).getSql()(...args);
const unavailable = (ref) => ({ ref, label: "Ngữ cảnh không còn khả dụng", available: false });
const summary = (row) => ({ ref: { kind: row.kind, id: row.kind === "place" ? `saved:${row.id}` : String(row.id) }, label: row.label,
  parent: { ref: { kind: "trip", id: String(row.trip_id) }, label: row.trip_title, slug: row.slug },
  href: `/?trip=${encodeURIComponent(row.slug)}${row.kind === "activity" ? `#${row.id}` : row.kind === "place" ? `#place-${row.id}` : row.kind === "source" ? "#sources-title" : row.kind === "contribution" ? (row.content.activityId ? `#${row.content.activityId}` : "#trip-suggestions-title") : ""}`, available: true, revision: Number(row.revision), checkedAt: new Date().toISOString() });
const collectionSummary = (row) => ({ ref: { kind: "collection", id: String(row.id) }, label: row.label,
  href: `/admin/collections?collection=${row.id}`, available: true, revision: Number(row.revision), checkedAt: new Date().toISOString() });
const librarySummary = (row) => ({ ref: { kind: "place", id: `library:${row.id}` }, label: row.label,
  parent: { ref: { kind: "collection", id: String(row.collection_id) }, label: row.collection_title }, href: row.maps_url,
  available: true, revision: Number(row.revision), checkedAt: new Date().toISOString() });

// Search and reads share typed resource queries and the pilot authorization boundary.
// Only explicit public planning fields enter content; never SELECT user records.
export function createContextService({ sql = defaultSql, research = null, readSnapshot = readTripSnapshot, maxChars = 24000 } = {}) {
  const rows = async ({ query = "", kind = null, tripId = null, id = null, offset = 0, limit = 21 } = {}) => sql`
    WITH resources AS (
      SELECT 'trip' AS kind,t.id,t.title AS label,t.id AS trip_id,t.title AS trip_title,t.slug,t.plan_revision AS revision,
        jsonb_build_object('startDate',t.trip_date,'endDate',t.end_date,'timezone',t.timezone,'location',t.location) AS content FROM trips t
      UNION ALL SELECT 'activity',a.id,a.title,t.id,t.title,t.slug,t.plan_revision,
        jsonb_build_object('key',a.item_key,'detail',a.detail,'startDate',a.start_date,'endDate',a.end_date,'start',a.start_time,'end',a.end_time,'timezone',t.timezone)
        FROM activities a JOIN trips t ON t.id=a.trip_id
      UNION ALL SELECT 'source',s.id,s.title,t.id,t.title,t.slug,t.plan_revision,
        jsonb_build_object('number',s.source_number,'url',s.url,'host',s.host) FROM sources s JOIN trips t ON t.id=s.trip_id
      UNION ALL SELECT 'place',p.id,p.name,t.id,t.title,t.slug,t.plan_revision,
        jsonb_build_object('name',p.name,'address',p.address,'latitude',p.latitude,'longitude',p.longitude,'website',p.website,'googlePlaceId',p.google_place_id,'notes',p.notes) FROM saved_places p JOIN trips t ON t.id=p.trip_id
      UNION ALL SELECT 'contribution',s.id,LEFT(s.body,100),t.id,t.title,t.slug,t.plan_revision,
        jsonb_build_object('kind',s.kind,'body',s.body,'status',s.status,'activityId',s.activity_id,'updatedAt',s.updated_at)
        FROM suggestions s JOIN trips t ON t.id=s.trip_id
    ) SELECT * FROM resources WHERE (${kind}::TEXT IS NULL OR kind=${kind})
      AND (${id}::TEXT IS NULL OR id::TEXT=${id}) AND (${tripId}::TEXT IS NULL OR trip_id::TEXT=${tripId})
      AND (${query}='' OR STRPOS(LOWER(label || ' ' || trip_title || ' ' || content::TEXT),LOWER(${query}))>0)
      ORDER BY kind,label,id LIMIT ${limit} OFFSET ${offset}`;
  const collections = async ({ query = "", id = null, offset = 0, limit = 21 } = {}) => sql`
    SELECT c.id,COALESCE(c.display_name,c.source_title) label,c.revision,
      jsonb_build_object('title',c.source_title,'description',c.source_description,'activeCount',COUNT(i.place_id) FILTER(WHERE i.source_removed_at IS NULL AND i.hidden_at IS NULL),'parserVersion',c.parser_version) content
    FROM place_collections c LEFT JOIN place_collection_items i ON i.collection_id=c.id
    WHERE c.archived_at IS NULL AND (${id}::TEXT IS NULL OR c.id::TEXT=${id})
      AND (${query}='' OR STRPOS(LOWER(COALESCE(c.display_name,c.source_title) || ' ' || COALESCE(c.source_description,'')),LOWER(${query}))>0)
    GROUP BY c.id ORDER BY label,c.id LIMIT ${limit} OFFSET ${offset}`;
  const library = async ({ query = "", id = null, offset = 0, limit = 21 } = {}) => sql`
    SELECT DISTINCT ON (p.id) p.id,i.source_name label,i.collection_id,COALESCE(c.display_name,c.source_title) collection_title,
      c.revision,i.maps_url,jsonb_build_object('name',i.source_name,'address',i.source_address,'latitude',i.latitude,'longitude',i.longitude,
        'note',i.source_note,'mapsUrl',i.maps_url,'externalIds',COALESCE((SELECT jsonb_agg(jsonb_build_object('provider',e.provider,'kind',e.kind,'value',e.value) ORDER BY e.kind) FROM place_external_ids e WHERE e.place_id=p.id),'[]'::JSONB)) content
    FROM place_library_entries p JOIN place_collection_items i ON i.place_id=p.id JOIN place_collections c ON c.id=i.collection_id
    WHERE c.archived_at IS NULL AND i.source_removed_at IS NULL AND i.hidden_at IS NULL AND (${id}::TEXT IS NULL OR p.id::TEXT=${id})
      AND (${query}='' OR STRPOS(LOWER(i.source_name || ' ' || COALESCE(i.source_address,'') || ' ' || COALESCE(i.source_note,'') || ' ' || COALESCE(c.display_name,c.source_title)),LOWER(${query}))>0)
    ORDER BY p.id,c.updated_at DESC,i.updated_at DESC LIMIT ${limit} OFFSET ${offset}`;
  const service = {
    async tripRef(actor, slug) {
      assertPilotActor(actor);
      const [row] = await sql`SELECT id FROM trips WHERE slug=${slug}`;
      if (!row) throw new AssistantFault("TRIP_NOT_FOUND", "Không tìm thấy chuyến đi", { status: 404 });
      return { kind: "trip", id: String(row.id) };
    },
    async search(actor, { query = "", kind = null, tripId = null, cursor = null } = {}, { signal } = {}) {
      assertPilotActor(actor);
      if (typeof query !== "string" || query.length > 300 || ![null,"trip","activity","source","contribution","place","collection","google_place"].includes(kind)
        || (tripId !== null && !/^[1-9][0-9]*$/.test(tripId)) || (cursor !== null && (!/^\d{1,6}$/.test(cursor) || Number(cursor) > 10000)))
        throw new AssistantFault("INVALID_INPUT", "Bộ lọc ngữ cảnh không hợp lệ");
      if (kind === "google_place") {
        if (!query.trim()) return { items: [], nextCursor: null };
        if (!research) throw new AssistantFault("PROVIDER_CONFIG", "Tra cứu địa điểm chưa khả dụng", { status: 503 });
        const result = await research.searchPlaces({ query }, { signal });
        return { items: result.places.map((p) => ({ ref: { kind: "place", id: `google:${p.placeId.replace(/^places\//, "")}` }, label: p.name,
          href: p.googleMapsUrl, available: true, checkedAt: result.checkedAt })), nextCursor: null };
      }
      const offset = Number(cursor || 0), limit = offset + 21;
      const [tripRows, collectionRows, libraryRows] = await Promise.all([
        kind === "collection" ? [] : rows({ query, kind, tripId, offset: 0, limit }),
        !tripId && (kind === null || kind === "collection") ? collections({ query, offset: 0, limit }) : [],
        !tripId && (kind === null || kind === "place") ? library({ query, offset: 0, limit }) : [],
      ]);
      const found = [...tripRows.map(summary), ...collectionRows.map(collectionSummary), ...libraryRows.map(librarySummary)]
        .sort((a,b) => `${a.ref.kind}:${a.label}:${a.ref.id}`.localeCompare(`${b.ref.kind}:${b.label}:${b.ref.id}`));
      const page = found.slice(offset, offset+20);
      return { items: page, nextCursor: found.length > offset+20 ? String(offset+20) : null };
    },
    async read(actor, ref, { full = false, signal } = {}) {
      assertPilotActor(actor); canonicalRefs([ref]);
      if (ref.kind === "place" && ref.id.startsWith("google:")) {
        if (!research) return unavailable(ref);
        const result = await research.getPlaceDetails({ placeId: ref.id.slice(7) }, { signal });
        return { ref, label: result.place.name, available: true, href: result.place.googleMapsUrl, checkedAt: result.checkedAt, content: result.place };
      }
      if (ref.kind === "collection") {
        const [row] = await collections({ id: ref.id, limit: 1 });
        if (!row) return unavailable(ref);
        const placeRows = await sql`SELECT i.place_id id,i.source_name name,i.source_address address,i.latitude,i.longitude,i.source_note note,i.maps_url "mapsUrl",i.position
          FROM place_collection_items i JOIN place_collections c ON c.id=i.collection_id
          WHERE i.collection_id=${ref.id} AND c.archived_at IS NULL AND i.source_removed_at IS NULL AND i.hidden_at IS NULL ORDER BY i.position LIMIT 101`;
        const value = { ...collectionSummary(row), content: { ...row.content, places: placeRows.slice(0,100), returnedCount: Math.min(placeRows.length,100),
          truncated: placeRows.length > 100, nextCursor: placeRows.length > 100 ? "100" : null } };
        return value;
      }
      if (ref.kind === "place" && ref.id.startsWith("library:")) {
        const [row] = await library({ id: ref.id.slice(8), limit: 1 });
        return row ? { ...librarySummary(row), content: row.content } : unavailable(ref);
      }
      const [row] = await rows({ kind: ref.kind, id: ref.kind === "place" ? ref.id.slice(6) : ref.id, limit: 1 });
      if (!row) return unavailable(ref);
      const value = { ...summary(row), content: row.content };
      if (full && ref.kind === "trip") { const snapshot = await readSnapshot(row.slug); value.content = compactSnapshot(snapshot); value.revision = snapshot.revision; }
      const serialized = JSON.stringify(value.content);
      if (serialized.length > maxChars) { value.content = { excerpt: serialized.slice(0, maxChars), omitted: true }; value.truncated = true; }
      return value;
    },
    async assemble(actor, refs, options) {
      const canonical = canonicalRefs(refs, 40);
      const omitted = (ref) => ({ ...unavailable(ref), omitted: true });
      // Reserve a descriptor for every reference before allocating content.
      let remaining = maxChars - JSON.stringify(canonical.map(omitted)).length;
      const result = [];
      for (const ref of canonical) {
        let item;
        try { item = await service.read(actor, ref, options); }
        catch (error) {
          if (options?.signal?.aborted || ["PILOT_FORBIDDEN", "INVALID_INPUT"].includes(error.code)) throw error;
          item = { ...unavailable(ref), retryable: true };
        }
        const descriptor = { ...omitted(ref), available: item.available };
        const extra = JSON.stringify(item).length - JSON.stringify(descriptor).length;
        if (extra > remaining) result.push(descriptor);
        else { result.push(item); remaining -= extra; }
      }
      return result;
    },
    async targetSnapshot(actor, ref) {
      if (ref?.kind !== "trip") throw new AssistantFault("INVALID_INPUT", "Hãy chọn chuyến đi cần sửa");
      const target = await service.read(actor, ref);
      if (!target.available) throw new AssistantFault("TRIP_NOT_FOUND", "Chuyến đi cần sửa không còn khả dụng", { status: 404 });
      return readSnapshot(target.parent.slug);
    },
  };
  return service;
}
