import { AssistantFault } from "./errors.mjs";

const addKeys = (items, keyById) => items.map((item) => ({
  ...item,
  key: keyById.get(String(item.id)) || `activity-${item.id}`,
}));

export async function readTripSnapshot(slug, { sql = null, attempts = 2, readItinerary = null } = {}) {
  sql ||= (await import("../db.js")).getSql();
  readItinerary ||= (await import("../itinerary-repository.js")).getItinerary;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const beforeRows = await sql`
      SELECT id, plan_revision
      FROM trips
      WHERE slug = ${slug}
      LIMIT 1
    `;
    if (!beforeRows.length) throw new AssistantFault("TRIP_NOT_FOUND", "Không tìm thấy chuyến đi", { status: 404 });

    const [plan, keyRows, sourceRows, placeRows] = await Promise.all([
      readItinerary(slug),
      sql`
        SELECT activity.id, activity.item_key, activity.branch_id, activity.place_id
        FROM activities activity
        JOIN trips trip ON trip.id = activity.trip_id
        WHERE trip.slug = ${slug}
      `,
      sql`SELECT id, source_number FROM sources WHERE trip_id=${beforeRows[0].id}`,
      sql`SELECT id::TEXT, name, address, latitude, longitude, website, google_place_id AS "googlePlaceId", notes FROM saved_places WHERE trip_id=${beforeRows[0].id} ORDER BY id`,
    ]);
    const afterRows = await sql`SELECT plan_revision FROM trips WHERE id = ${beforeRows[0].id}`;

    if (String(beforeRows[0].plan_revision) !== String(afterRows[0]?.plan_revision)) continue;
    plan.sources = plan.sources.map((source) => ({ ...source, id: String(sourceRows.find((row) => Number(row.source_number) === source.number)?.id) }));
    const enrich = (items) => items.map((item) => ({ ...item, placeId: keyRows.find((row) => String(row.id) === String(item.id))?.place_id ? String(keyRows.find((row) => String(row.id) === String(item.id)).place_id) : null }));
    plan.backbone = enrich(plan.backbone); plan.itinerary = enrich(plan.itinerary);
    for (const group of plan.branchGroups) for (const branch of group.branches) branch.itinerary = enrich(branch.itinerary);
    const keyById = new Map(keyRows.map((row) => [String(row.id), row.item_key]));
    const branchGroups = plan.branchGroups.map((group) => ({
      ...group,
      branches: group.branches.map((branch) => ({
        ...branch,
        itinerary: addKeys(branch.itinerary, keyById),
      })),
    }));
    const backbone = addKeys(plan.backbone, keyById);

    return {
      tripId: String(beforeRows[0].id),
      revision: Number(afterRows[0]?.plan_revision || beforeRows[0].plan_revision || 0),
      trip: plan.trip,
      sources: plan.sources,
      places: placeRows,
      backbone,
      branchGroups,
      itinerary: addKeys(plan.itinerary, keyById),
    };
  }
  throw new AssistantFault("PLAN_BUSY", "Lịch vừa thay đổi; vui lòng thử lại", { status: 409, retryable: true });
}

export async function listAssistantTrips() {
  return (await import("../itinerary-repository.js")).listTrips();
}

export function publicSnapshot(snapshot) {
  return {
    revision: snapshot.revision,
    trip: snapshot.trip,
    sources: snapshot.sources,
    places: snapshot.places || [],
    backbone: snapshot.backbone,
    branchGroups: snapshot.branchGroups,
    itinerary: snapshot.itinerary,
  };
}

export function compactSnapshot(snapshot) {
  return {
    trip: snapshot.trip,
    revision: snapshot.revision,
    sources: snapshot.sources.map(({ id, number, title, host, url }) => ({ id, number, title, host, url })),
    places: snapshot.places || [],
    backbone: snapshot.backbone.map(compactActivity),
    branches: snapshot.branchGroups.map((group) => ({
      key: group.key,
      title: group.title,
      anchorActivityKey: group.anchorActivityId == null
        ? null
        : snapshot.backbone.find((item) => item.id === group.anchorActivityId)?.key || null,
      selectedBranchId: group.selectedBranchId,
      branches: group.branches.map((branch) => ({
        key: branch.key,
        label: branch.label,
        condition: branch.condition,
        selected: branch.id === group.selectedBranchId,
        itinerary: branch.itinerary.map(compactActivity),
      })),
    })),
  };
}

const compactActivity = ({ id, placeId, key, startDate, start, endDate, end, displayEnd, type, icon, title, detail, refs, branchId }) => ({
  id, placeId, key, startDate, start, endDate, end, displayEnd, type, icon, title, detail, refs, branchId,
});
