import { validateBatch } from "./batch-schema.mjs";
import { AssistantFault } from "./errors.mjs";
import { reserveItemKey } from "../schedule-keys.mjs";
import { sourceDetailsFromUrl } from "../source-fields.mjs";
import { validateActivityInterval, isIsoDate, compareActivityDateTime, activityInstants } from "../trip-dates.mjs";
import { nextBackboneActivity, validateBranchTimeline } from "../schedule-branching.mjs";

const fault = (message) => { throw new AssistantFault("BATCH_INVALID", message, { status: 400 }); };
const key = (ref) => ref.id ? `id:${ref.id}` : `draft:${ref.draftId}`;
const copy = (value) => structuredClone(value);
const fields = {
  trip: ["slug", "title", "startDate", "endDate", "timezone", "location"],
  source: ["title", "host", "url", "number"],
  place: ["name", "address", "latitude", "longitude", "website", "googlePlaceId", "notes"],
  activity: ["key", "startDate", "start", "endDate", "end", "displayEnd", "type", "icon", "title", "detail", "sources", "place", "branchId"],
};
const visible = (kind, value) => Object.fromEntries(fields[kind].map((field) => [field, value[field] ?? null]));
const clean = (value) => Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));

// Pure compilation against revision-fenced snapshots. No domain writes here.
export function compileBatch(args, snapshots, evidence = []) {
  validateBatch(args);
  const drafts = new Map(), resources = new Map(), trips = new Map(), revisions = {}, changed = new Set();
  for (const snapshot of snapshots) {
    const tripKey = `id:${snapshot.tripId}`;
    trips.set(tripKey, { ...copy(snapshot), trip: clean(snapshot.trip), activities: [snapshot.backbone, ...snapshot.branchGroups.flatMap((g) => g.branches.map((b) => b.itinerary))].flat().map((a) => ({ ...copy(a), sources: (a.refs || []).map((n) => ({ id: String(snapshot.sources.find((s) => s.number === n)?.id) })), place: a.placeId ? { id: String(a.placeId) } : null })) });
    revisions[snapshot.tripId] = snapshot.revision;
    resources.set(`trip:${tripKey}`, { tripKey, value: trips.get(tripKey).trip });
    for (const [kind, values] of [["activity", trips.get(tripKey).activities], ["source", snapshot.sources], ["place", snapshot.places || []]])
      for (const value of values) resources.set(`${kind}:id:${value.id}`, { tripKey, value: copy(value) });
  }
  for (const op of args.operations) if (op.draftId) {
    if (drafts.has(op.draftId)) fault(`Mã tạm bị trùng: ${op.draftId}`);
    drafts.set(op.draftId, op);
  }
  const ordered = [], visited = new Set(), visiting = new Set();
  const visit = (op) => {
    if (visited.has(op)) return;
    if (visiting.has(op)) fault("Các mã tạm tham chiếu vòng tròn");
    visiting.add(op);
    const value = op.value || op.set;
    for (const ref of [op.trip, value.place, ...(value.sources || [])].filter(Boolean)) if (ref.draftId) {
      const dependency = drafts.get(ref.draftId);
      if (!dependency) fault(`Không tìm thấy mã tạm: ${ref.draftId}`);
      visit(dependency);
    }
    visiting.delete(op); visited.add(op); ordered.push(op);
  };
  const inputTargets = new Set();
  for (const op of args.operations) {
    const target = `${op.kind.split(".")[0]}:${key(op.target || { draftId: op.draftId })}`;
    if (inputTargets.has(target)) fault("Mỗi tài nguyên chỉ được thay đổi một lần trong nhóm.");
    inputTargets.add(target); visit(op);
  }
  const normalized = [], changes = [];
  const resolve = (kind, ref, tripKey = null) => {
    const resource = resources.get(`${kind}:${key(ref)}`);
    if (!resource || (tripKey && resource.tripKey !== tripKey)) fault(`Không tìm thấy ${kind} trong chuyến đi đã chọn`);
    return resource;
  };
  for (const op of ordered) {
    const [kind, action] = op.kind.split(".");
    const ref = action === "create" ? { draftId: op.draftId } : op.target;
    const resourceKey = `${kind}:${key(ref)}`;
    if (changed.has(resourceKey)) fault("Mỗi tài nguyên chỉ được thay đổi một lần trong nhóm. Hãy gộp các trường cần sửa.");
    changed.add(resourceKey);
    const tripKey = kind === "trip" ? key(ref) : resolve("trip", op.trip).tripKey;
    const previous = action === "update" ? resolve(kind, ref, tripKey).value : null;
    const value = { ...(previous || {}), ...clean(op.value || op.set) };
    if (kind === "trip") {
      if (!isIsoDate(value.startDate) || !isIsoDate(value.endDate) || value.endDate < value.startDate) fault("Ngày chuyến đi không hợp lệ");
      try { new Intl.DateTimeFormat("vi-VN", { timeZone: value.timezone }); } catch { fault("Múi giờ không hợp lệ"); }
      if (action === "create") trips.set(tripKey, { trip: value, activities: [], sources: [], places: [], branchGroups: [] });
      else trips.get(tripKey).trip = value;
    }
    const trip = trips.get(tripKey);
    if (kind === "source") {
      const details = sourceDetailsFromUrl(value.url);
      if (!details) fault("URL nguồn phải dùng http hoặc https");
      if ((action === "create" || value.url !== previous.url) && ![...evidence, ...snapshots.flatMap((s) => s.sources)].some((e) => e.url === details.url)) fault("Hãy tra cứu URL nguồn trước khi lưu");
      Object.assign(value, details);
      value.number = previous?.number || Math.max(0, ...trip.sources.map((s) => s.number)) + 1;
      if (action === "create") trip.sources.push(value);
    }
    if (kind === "place") {
      Object.assign(value, { latitude: value.latitude ?? null, longitude: value.longitude ?? null, website: value.website || null, googlePlaceId: value.googlePlaceId || null, notes: value.notes || "" });
      if ((value.latitude === null) !== (value.longitude === null)) fault("Tọa độ cần cả vĩ độ và kinh độ");
      if (value.website && !sourceDetailsFromUrl(value.website)) fault("Website phải dùng http hoặc https");
    }
    if (kind === "activity") {
      if (action === "create") {
        value.key = reserveItemKey(value.title, new Set(trip.activities.map((a) => a.key)));
        value.branchId ??= null; value.displayEnd ??= null; value.detail ??= ""; value.sources ??= []; value.place ??= null;
        if (value.branchId && !trip.branchGroups.some((g) => g.branches.some((b) => String(b.id) === value.branchId))) fault("Nhánh không thuộc chuyến đi");
      }
      for (const source of value.sources || []) resolve("source", source, tripKey);
      if (value.place) resolve("place", value.place, tripKey);
      if (action === "create") trip.activities.push(value);
      else trip.activities[trip.activities.findIndex((a) => String(a.id) === ref.id)] = value;
    }
    resources.set(resourceKey, { tripKey, value });
    normalized.push({ kind: op.kind, ref, trip: kind === "trip" ? ref : op.trip, value: visible(kind, value) });
    changes.push({ kind: op.kind, title: value.title || value.name, targetKey: resourceKey, tripKey, before: previous ? visible(kind, previous) : null, after: visible(kind, value) });
  }
  for (const trip of trips.values()) {
    try {
      for (const a of trip.activities) { validateActivityInterval(a, { trip: trip.trip }); activityInstants(a, trip.trip.timezone); }
      const backbone = trip.activities.filter((a) => a.branchId == null).sort(compareActivityDateTime);
      validateBranchTimeline({ anchor: null, rejoin: null, itinerary: backbone });
      for (const group of trip.branchGroups) for (const branch of group.branches) validateBranchTimeline({
        anchor: group.anchorActivityId == null ? null : backbone.find((a) => String(a.id) === String(group.anchorActivityId)),
        rejoin: nextBackboneActivity(backbone, group.anchorActivityId),
        itinerary: trip.activities.filter((a) => String(a.branchId) === String(branch.id)).sort(compareActivityDateTime),
      });
    } catch (error) { fault(error.message); }
  }
  for (const change of changes) {
    const trip = trips.get(change.tripKey).trip;
    change.tripTitle = trip.title; change.tripSlug = trip.slug;
    for (const value of [change.before, change.after].filter(Boolean)) {
      if (value.sources) value.sources = value.sources.map((ref) => resolve("source", ref, change.tripKey).value.title);
      if (value.place) value.place = resolve("place", value.place, change.tripKey).value.name;
    }
  }
  const groups = [...new Set(changes.map((c) => c.tripKey))].map((tripKey) => ({ tripKey, title: trips.get(tripKey).trip.title, slug: trips.get(tripKey).trip.slug }));
  const nouns = { trip: "chuyến đi", activity: "hoạt động", source: "nguồn", place: "địa điểm" };
  const counts = new Map();
  for (const change of changes) counts.set(change.kind, (counts.get(change.kind) || 0) + 1);
  const summary = [...counts].map(([kind, count]) => {
    const [resource, action] = kind.split(".");
    return `${action === "update" ? "Cập nhật" : resource === "place" ? "Lưu" : resource === "trip" ? "Tạo" : "Thêm"} ${count} ${nouns[resource]}`;
  }).join(", ");
  return { operations: normalized, revisions, preview: { summary, groups, changes, warnings: [] } };
}

export async function prepareBatch({ args, actor, contextService, evidence = [] }) {
  validateBatch(args);
  const ids = [...new Set(args.operations.flatMap((op) => op.kind === "trip.update" ? [op.target.id] : op.trip?.id ? [op.trip.id] : []))];
  const snapshots = await Promise.all(ids.map((id) => contextService.targetSnapshot(actor, { kind: "trip", id })));
  return compileBatch(args, snapshots, evidence);
}
