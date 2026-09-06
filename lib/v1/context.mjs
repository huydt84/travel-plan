import { AssistantFault, assertPilotActor } from "./errors.mjs";
import { contextRefsSchema, validateSchema } from "./schemas.mjs";
import { readTripSnapshot, compactSnapshot } from "./snapshot.mjs";

export const refKey = (ref) => `${ref.kind}:${ref.id}`;
export function canonicalRefs(refs = [], maxItems = 20) {
  validateSchema({ ...contextRefsSchema, maxItems }, refs);
  for (const ref of refs) {
    if (!(ref.kind === "place" ? /^google:[A-Za-z0-9_-]+$/.test(ref.id) : /^[1-9][0-9]*$/.test(ref.id)))
      throw new AssistantFault("INVALID_INPUT", "Mã ngữ cảnh không hợp lệ");
  }
  return [...new Map(refs.map(({ kind, id }) => [refKey({ kind, id }), { kind, id }])).values()].sort((a, b) => refKey(a).localeCompare(refKey(b)));
}
const defaultSql = async (...args) => (await import("../db.js")).getSql()(...args);
const unavailable = (ref) => ({ ref, label: "Ngữ cảnh không còn khả dụng", available: false });
const summary = (row) => ({ ref: { kind: row.kind, id: String(row.id) }, label: row.label,
  parent: { ref: { kind: "trip", id: String(row.trip_id) }, label: row.trip_title, slug: row.slug },
  href: `/?trip=${encodeURIComponent(row.slug)}${row.kind === "activity" ? `#${row.id}` : row.kind === "source" ? "#sources-title" : row.kind === "contribution" ? (row.content.activityId ? `#${row.content.activityId}` : "#trip-suggestions-title") : ""}`, available: true, revision: Number(row.revision), checkedAt: new Date().toISOString() });

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
      UNION ALL SELECT 'contribution',s.id,LEFT(s.body,100),t.id,t.title,t.slug,t.plan_revision,
        jsonb_build_object('kind',s.kind,'body',s.body,'status',s.status,'activityId',s.activity_id,'updatedAt',s.updated_at)
        FROM suggestions s JOIN trips t ON t.id=s.trip_id
    ) SELECT * FROM resources WHERE (${kind}::TEXT IS NULL OR kind=${kind})
      AND (${id}::TEXT IS NULL OR id::TEXT=${id}) AND (${tripId}::TEXT IS NULL OR trip_id::TEXT=${tripId})
      AND (${query}='' OR STRPOS(LOWER(label || ' ' || trip_title || ' ' || content::TEXT),LOWER(${query}))>0)
      ORDER BY kind,label,id LIMIT ${limit} OFFSET ${offset}`;
  const service = {
    async tripRef(actor, slug) {
      assertPilotActor(actor);
      const [row] = await sql`SELECT id FROM trips WHERE slug=${slug}`;
      if (!row) throw new AssistantFault("TRIP_NOT_FOUND", "Không tìm thấy chuyến đi", { status: 404 });
      return { kind: "trip", id: String(row.id) };
    },
    async search(actor, { query = "", kind = null, tripId = null, cursor = null } = {}, { signal } = {}) {
      assertPilotActor(actor);
      if (typeof query !== "string" || query.length > 300 || ![null,"trip","activity","source","contribution","place"].includes(kind)
        || (tripId !== null && !/^[1-9][0-9]*$/.test(tripId)) || (cursor !== null && !/^\d{1,6}$/.test(cursor)))
        throw new AssistantFault("INVALID_INPUT", "Bộ lọc ngữ cảnh không hợp lệ");
      if (kind === "place") {
        if (!query.trim()) return { items: [], nextCursor: null };
        if (!research) throw new AssistantFault("PROVIDER_CONFIG", "Tra cứu địa điểm chưa khả dụng", { status: 503 });
        const result = await research.searchPlaces({ query }, { signal });
        return { items: result.places.map((p) => ({ ref: { kind: "place", id: `google:${p.placeId.replace(/^places\//, "")}` }, label: p.name,
          href: p.googleMapsUrl, available: true, checkedAt: result.checkedAt })), nextCursor: null };
      }
      const found = await rows({ query, kind, tripId, offset: Number(cursor || 0) });
      return { items: found.slice(0,20).map(summary), nextCursor: found.length>20 ? String(Number(cursor || 0)+20) : null };
    },
    async read(actor, ref, { full = false, signal } = {}) {
      assertPilotActor(actor); canonicalRefs([ref]);
      if (ref.kind === "place") {
        if (!research) return unavailable(ref);
        const result = await research.getPlaceDetails({ placeId: ref.id.slice(7) }, { signal });
        return { ref, label: result.place.name, available: true, href: result.place.googleMapsUrl, checkedAt: result.checkedAt, content: result.place };
      }
      const [row] = await rows({ kind: ref.kind, id: ref.id, limit: 1 });
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
